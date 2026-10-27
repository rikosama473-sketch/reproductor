const ITUNES_SEARCH_ENDPOINT = "https://itunes.apple.com/search";
const MAX_QUERY_LENGTH = 180;
const MAX_RESULTS = 8;

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
export async function searchItunesGenreSuggestions({ title, artist, country = "AR", fetchImpl = globalThis.fetch, signal } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Este entorno no puede consultar el catálogo musical.");
  const url = buildItunesGenreSearchUrl(title, artist, country);
  const response = await fetchImpl(url, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    ...(signal ? { signal } : {})
  });
  if (!response?.ok) throw new Error("El catálogo musical respondió con un error HTTP " + Number(response?.status || 0) + ".");
  const payload = await response.json();
  return normalizeItunesGenreSuggestions(payload, { title, artist });
}
