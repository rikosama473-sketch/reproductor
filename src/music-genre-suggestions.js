const ITUNES_SEARCH_ENDPOINT = "https://itunes.apple.com/search";
const MAX_QUERY_LENGTH = 180;
const MAX_RESULTS = 8;
const JSONP_TIMEOUT_MS = 12000;
let jsonpRequestSequence = 0;

function cleanText(value, maxLength = 300) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function searchKey(value) {
  return cleanText(value, MAX_QUERY_LENGTH).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenOverlap(left, right) {
  const a = new Set(searchKey(left).split(" ").filter(token => token.length > 1));
  const b = new Set(searchKey(right).split(" ").filter(token => token.length > 1));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return (2 * shared) / (a.size + b.size);
}

function matchScore(candidate, expected) {
  const wanted = searchKey(expected);
  const actual = searchKey(candidate);
  if (!wanted || !actual) return 0;
  if (actual === wanted) return 1;
  if (actual.length >= 4 && (actual.includes(wanted) || wanted.includes(actual))) return 0.88;
  return tokenOverlap(actual, wanted);
}

function normalizeAppleMusicUrl(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    if (!["music.apple.com", "itunes.apple.com"].includes(url.hostname.toLowerCase())) return "";
    return url.href;
  } catch {
    return "";
  }
}

/**
 * This isolated frame handles Apple's documented JSONP callback path.
 * It has scripts enabled, but deliberately lacks allow-same-origin, forms,
 * popups and top-navigation permissions. Apple-controlled script cannot read
 * the Ritmo document or its IndexedDB state.
 */
export function buildSandboxedItunesJsonpDocument() {
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>Ritmo catalog request</title></head><body><script>',
    '(function () {',
    '  "use strict";',
    '  var callbackName = "__ritmo_itunes_callback";',
    '  window.addEventListener("message", function (event) {',
    '    if (event.source !== parent || !event.data || event.data.type !== "ritmo-itunes-search") return;',
    '    var request = event.data;',
    '    var url;',
    '    try {',
    '      url = new URL(request.url);',
    '      if (url.origin !== "https://itunes.apple.com" || url.pathname !== "/search" ||',
    '          !url.searchParams.get("term") || url.searchParams.get("entity") !== "song" ||',
    '          url.searchParams.get("limit") !== "8" || !/^[A-Z]{2}$/.test(url.searchParams.get("country") || "")) {',
    '        throw new Error("URL no permitida");',
    '      }',
    '      url.search = new URLSearchParams({',
    '        term: url.searchParams.get("term"),',
    '        entity: "song",',
    '        limit: "8",',
    '        country: url.searchParams.get("country")',
    '      }).toString();',
    '      url.searchParams.set("callback", callbackName);',
    '    } catch (error) {',
    '      parent.postMessage({ type: "ritmo-itunes-result", id: request.id, error: "La consulta al catálogo no es válida." }, "*");',
    '      return;',
    '    }',
    '    var finished = false;',
    '    function finish(message) {',
    '      if (finished) return;',
    '      finished = true;',
    '      parent.postMessage(message, "*");',
    '      try { delete window[callbackName]; } catch (_) {}',
    '    }',
    '    window[callbackName] = function (payload) {',
    '      finish({ type: "ritmo-itunes-result", id: request.id, payload: payload });',
    '    };',
    '    var script = document.createElement("script");',
    '    script.async = true;',
    '    script.src = url.href;',
    '    script.onerror = function () {',
    '      finish({ type: "ritmo-itunes-result", id: request.id, error: "No se pudo cargar el catálogo de Apple." });',
    '    };',
    '    document.head.appendChild(script);',
    '  });',
    '}());',
    '</script></body></html>'
  ].join("\n");
}

/**
 * Use a new opaque-origin sandbox for JSONP, rather than executing a
 * third-party callback in the main Ritmo window. This fallback is needed by
 * browsers that block cross-origin fetch() to the iTunes search endpoint.
 */
export function searchItunesViaSandboxedJsonp(url, { signal, timeoutMs = JSONP_TIMEOUT_MS } = {}) {
  if (typeof document === "undefined" || typeof window === "undefined" || !document.body) {
    return Promise.reject(new Error("Este entorno no permite la consulta aislada al catálogo. Abrí Ritmo en su navegador o aplicación de escritorio."));
  }
  if (signal?.aborted) return Promise.reject(new DOMException("La búsqueda fue cancelada.", "AbortError"));
  let parsed;
  try {
    parsed = new URL(url);
    if (parsed.origin !== "https://itunes.apple.com" || parsed.pathname !== "/search" ||
        !parsed.searchParams.get("term") || parsed.searchParams.get("entity") !== "song" ||
        parsed.searchParams.get("limit") !== String(MAX_RESULTS)) {
      throw new Error("URL no permitida");
    }
  } catch {
    return Promise.reject(new Error("La consulta al catálogo no es válida."));
  }

  return new Promise((resolve, reject) => {
    const id = "ritmo-genre-" + (++jsonpRequestSequence);
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("title", "Consulta aislada del catálogo musical");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:absolute;width:0;height:0;border:0;left:-10000px;top:0;visibility:hidden";
    let timeoutHandle = null;
    let settled = false;

    const cleanup = () => {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      window.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      frame.remove();
    };
    const settle = (error, payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(payload);
    };
    const onMessage = event => {
      if (event.source !== frame.contentWindow || event.data?.type !== "ritmo-itunes-result" || event.data.id !== id) return;
      if (typeof event.data.error === "string") settle(new Error(event.data.error));
      else settle(null, event.data.payload);
    };
    const onAbort = () => settle(new DOMException("La búsqueda fue cancelada.", "AbortError"));

    window.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
    timeoutHandle = setTimeout(() => settle(new Error("El catálogo tardó demasiado en responder. Revisá la conexión e intentá de nuevo.")), Math.max(1000, Math.min(30000, Number(timeoutMs) || JSONP_TIMEOUT_MS)));
    frame.addEventListener("load", () => {
      if (settled) return;
      frame.contentWindow?.postMessage({ type: "ritmo-itunes-search", id, url: parsed.href }, "*");
    }, { once: true });
    frame.srcdoc = buildSandboxedItunesJsonpDocument();
    document.body.appendChild(frame);
  });
}

/**
 * Build one bounded, explicit catalog search. This does not upload audio and
 * does not infer genre from sound; it searches Apple/iTunes text metadata.
 */
export function buildItunesGenreSearchUrl(title, artist, country = "AR") {
  const safeTitle = cleanText(title, 120);
  const safeArtist = cleanText(artist, 120);
  if (!safeTitle) throw new TypeError("Hace falta el título de la canción para buscar el género.");
  const term = [safeArtist, safeTitle].filter(Boolean).join(" ").slice(0, MAX_QUERY_LENGTH);
  const url = new URL(ITUNES_SEARCH_ENDPOINT);
  url.searchParams.set("term", term);
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", String(MAX_RESULTS));
  url.searchParams.set("country", /^[A-Z]{2}$/i.test(country) ? country.toUpperCase() : "AR");
  return url.href;
}

/**
 * Parse catalog results into user-confirmable genre suggestions.
 * Bad title/artist matches are discarded instead of silently mis-tagging a track.
 */
export function normalizeItunesGenreSuggestions(payload, expected = {}, limit = 5) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.results)) return [];
  const wantedTitle = cleanText(expected.title, 120);
  const wantedArtist = cleanText(expected.artist, 120);
  if (!wantedTitle) return [];
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(8, limit)) : 5;
  const suggestions = [];
  for (const result of payload.results.slice(0, 50)) {
    if (!result || typeof result !== "object") continue;
    const title = cleanText(result.trackName, 180);
    const artist = cleanText(result.artistName, 180);
    const genre = cleanText(result.primaryGenreName, 100);
    if (!title || !artist || !genre) continue;
    const titleScore = matchScore(title, wantedTitle);
    const artistScore = wantedArtist ? matchScore(artist, wantedArtist) : 0.65;
    // Avoid accepting a shared-word/incorrect-cover match on title alone.
    if (titleScore < 0.55 || (wantedArtist && artistScore < 0.45)) continue;
    const confidence = Math.round((titleScore * 0.68 + artistScore * 0.32) * 100);
    const sourceUrl = normalizeAppleMusicUrl(result.trackViewUrl);
    const key = searchKey(genre);
    if (suggestions.some(item => searchKey(item.genre) === key)) continue;
    suggestions.push({
      title,
      artist,
      genre,
      confidence,
      sourceUrl,
      source: "Catálogo Apple/iTunes",
      trackId: Number.isSafeInteger(result.trackId) && result.trackId > 0 ? result.trackId : null
    });
  }
  suggestions.sort((a, b) => b.confidence - a.confidence || a.genre.localeCompare(b.genre, "es"));
  return suggestions.slice(0, safeLimit);
}

/** Search the metadata catalog only when explicitly called by the user. */
export async function searchItunesGenreSuggestions({
  title, artist, country = "AR", fetchImpl = globalThis.fetch,
  jsonpImpl = searchItunesViaSandboxedJsonp, signal
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Este entorno no puede consultar el catálogo musical.");
  const url = buildItunesGenreSearchUrl(title, artist, country);
  let payload;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      ...(signal ? { signal } : {})
    });
    if (!response?.ok) throw new Error("El catálogo musical respondió con el estado HTTP " + Number(response?.status || 0) + ".");
    payload = await response.json();
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw error;
    if (error instanceof TypeError || error?.name === "TypeError") {
      payload = await jsonpImpl(url, { signal });
    } else {
      throw error;
    }
  }
  return normalizeItunesGenreSuggestions(payload, { title, artist });
}
