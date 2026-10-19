const SPOTIFY_TYPES = new Set(["track", "album", "playlist", "artist", "show", "episode"]);
const SPOTIFY_LABELS = Object.freeze({
  track: "Canción", album: "Álbum", playlist: "Lista de reproducción",
  artist: "Artista", show: "Podcast", episode: "Episodio"
});

export function parseSpotifyShareLink(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  let type = "";
  let id = "";
  let canonicalUrl = "";
  const uriMatch = raw.match(/^spotify:(track|album|playlist|artist|show|episode):([A-Za-z0-9]{10,64})$/i);
  if (uriMatch) {
    type = uriMatch[1].toLowerCase();
    id = uriMatch[2];
    canonicalUrl = "https://open.spotify.com/" + type + "/" + id;
  } else {
    let parsed;
    try { parsed = new URL(raw); } catch { return null; }
    if (parsed.protocol !== "https:" || !["open.spotify.com", "www.open.spotify.com"].includes(parsed.hostname.toLowerCase()) ||
        parsed.username || parsed.password || parsed.port) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    while (parts.length && (/^intl-[a-z]{2}$/i.test(parts[0]) || parts[0].toLowerCase() === "embed")) parts.shift();
    if (parts.length < 2) return null;
    type = String(parts[0]).toLowerCase();
    id = String(parts[1]);
    if (!SPOTIFY_TYPES.has(type) || !/^[A-Za-z0-9]{10,64}$/.test(id)) return null;
    canonicalUrl = "https://open.spotify.com/" + type + "/" + id;
  }
  if (!SPOTIFY_TYPES.has(type) || !/^[A-Za-z0-9]{10,64}$/.test(id)) return null;
  return Object.freeze({
    type, id, uri: "spotify:" + type + ":" + id, canonicalUrl,
    embedUrl: "https://open.spotify.com/embed/" + type + "/" + id + "?utm_source=generator&theme=0",
    label: "Spotify · " + SPOTIFY_LABELS[type],
    entityLabel: SPOTIFY_LABELS[type]
  });
}

export const RADIO_BROWSER_MIRRORS = Object.freeze([
  "https://de1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
  "https://at1.api.radio-browser.info"
]);
const RADIO_FILTERS = new Set(["name", "tag", "country", "language"]);

export function buildRadioBrowserSearchUrl(query, filter = "name", mirror = RADIO_BROWSER_MIRRORS[0]) {
  const text = String(query ?? "").trim();
  if (!text) throw new TypeError("Ingresá un nombre, género, país o idioma.");
  if (!RADIO_FILTERS.has(filter)) throw new TypeError("Filtro de búsqueda de radios no válido.");
  if (!RADIO_BROWSER_MIRRORS.includes(mirror)) throw new TypeError("Servidor de Radio Browser no permitido.");
  const url = new URL("/json/stations/search", mirror);
  url.searchParams.set(filter, text.slice(0, 90));
  url.searchParams.set("limit", "24");
  url.searchParams.set("hidebroken", "true");
  url.searchParams.set("order", "clickcount");
  url.searchParams.set("reverse", "true");
  return url.href;
}

function safeHttpUrl(value, requireHttps = false) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (!["http:", "https:"].includes(url.protocol) || (requireHttps && url.protocol !== "https:") ||
        url.username || url.password || !url.hostname || url.hostname.includes(" ")) return "";
    return url.href;
  } catch { return ""; }
}

export function normalizeRadioStation(item) {
  if (!item || typeof item !== "object") return null;
  const stationuuid = String(item.stationuuid ?? "").trim();
  const name = String(item.name ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
  if (!/^[A-Za-z0-9-]{3,80}$/.test(stationuuid) || !name) return null;
  const streamUrl = [item.url_resolved, item.url]
    .map(value => safeHttpUrl(value, true))
    .find(value => value && !/\.m3u8(?:$|[?#])/i.test(new URL(value).pathname)) || "";
  const homepage = safeHttpUrl(item.homepage);
  const language = String(item.language ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const country = String(item.country ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  const tags = String(item.tags ?? "").split(",").map(tag => tag.trim()).filter(Boolean).slice(0, 5).join(", ");
  const codec = String(item.codec ?? "").trim().slice(0, 30);
  const bitrate = Math.max(0, Number(item.bitrate) || 0);
  return Object.freeze({
    stationuuid, name, url: streamUrl, homepage, country, language, tags, codec, bitrate,
    votes: Math.max(0, Number(item.votes) || 0)
  });
}

export function radioStationClickUrl(stationuuid, mirror = RADIO_BROWSER_MIRRORS[0]) {
  if (!RADIO_BROWSER_MIRRORS.includes(mirror)) throw new TypeError("Servidor de Radio Browser no permitido.");
  const id = String(stationuuid ?? "").trim();
  if (!/^[A-Za-z0-9-]{3,80}$/.test(id)) throw new TypeError("Identificador de emisora no válido.");
  return mirror + "/json/url/" + encodeURIComponent(id);
}

export async function searchRadioBrowser(query, filter = "name", {
  signal,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("Este navegador no ofrece fetch para buscar radios.");
  let lastError = null;
  for (const mirror of RADIO_BROWSER_MIRRORS) {
    if (signal?.aborted) throw new DOMException("Búsqueda cancelada", "AbortError");
    try {
      const response = await fetchImpl(buildRadioBrowserSearchUrl(query, filter, mirror), {
        method: "GET", mode: "cors", credentials: "omit", cache: "no-store", signal,
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error("Radio Browser respondió " + response.status + ".");
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("Radio Browser devolvió un formato inesperado.");
      return { stations: data.map(normalizeRadioStation).filter(Boolean), received: data.length, mirror };
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      lastError = error;
    }
  }
  throw new Error(lastError?.message || "No se pudo conectar con Radio Browser. Probá otra búsqueda más tarde.");
}
