import assert from "node:assert/strict";
import {
  parseSpotifyShareLink, buildRadioBrowserSearchUrl, normalizeRadioStation,
  radioStationClickUrl, searchRadioBrowser, RADIO_BROWSER_MIRRORS,
  buildInvidiousYoutubeSearchUrl, normalizeInvidiousYoutubeResult,
  searchInvidiousYoutube, INVIDIOUS_SEARCH_INSTANCES,
  YOUTUBE_MODE_STORAGE_KEY, readYoutubeModeEnabled, persistYoutubeModeEnabled,
  NETWORK_MODE_STORAGE_KEY, readNetworkModeEnabled, persistNetworkModeEnabled, networkModeCanUseInternet,
  SAVED_RADIO_STATIONS_SETTING_KEY, isRadioStationTrack, normalizeSavedRadioStations,
  migrateRadioStationsFromTracks, upsertSavedRadioStation, removeSavedRadioStation
} from "../src/online-services.js";
import { readFile } from "node:fs/promises";

const id = "0Lr4kGOYn9l83EjuK6cZFQ";
assert.equal(parseSpotifyShareLink("https://open.spotify.com/track/" + id + "?si=example")?.type, "track");
assert.equal(parseSpotifyShareLink("spotify:playlist:" + id)?.type, "playlist");
assert.equal(parseSpotifyShareLink("https://open.spotify.com/intl-es/episode/" + id)?.type, "episode");
assert.equal(parseSpotifyShareLink("https://open.spotify.com/embed/album/" + id)?.type, "album");
assert.equal(parseSpotifyShareLink("https://open.spotify.com/track/" + id)?.embedUrl,
  "https://open.spotify.com/embed/track/" + id + "?utm_source=generator&theme=0");
for (const bad of [
  "", "not a URL", "javascript:alert(1)", "https://evil.example/track/" + id,
  "http://open.spotify.com/track/" + id, "https://open.spotify.com/track/not-valid",
  "https://user:pass@open.spotify.com/track/" + id, "https://open.spotify.com.evil.example/track/" + id
]) assert.equal(parseSpotifyShareLink(bad), null, "Invalid Spotify link should be rejected: " + bad);

const searchUrl = new URL(buildRadioBrowserSearchUrl("ambient", "tag"));
assert.equal(searchUrl.hostname, "de1.api.radio-browser.info");
assert.equal(searchUrl.pathname, "/json/stations/search");
assert.equal(searchUrl.searchParams.get("tag"), "ambient");
assert.equal(searchUrl.searchParams.get("hidebroken"), "true");
assert.equal(searchUrl.searchParams.get("limit"), "24");
assert.throws(() => buildRadioBrowserSearchUrl("rock", "anything"));
assert.throws(() => buildRadioBrowserSearchUrl("rock", "tag", "https://attacker.example"));

const station = normalizeRadioStation({
  stationuuid: "b51b29c7-3f44-4b29-a8e1-fbb4f738ed8e", name: " Radio Café  ",
  url_resolved: "https://stream.example/radio.mp3", url: "http://stream.example/radio.mp3",
  homepage: "https://radio.example", country: "Argentina", language: "Spanish",
  tags: "jazz, café, smooth", codec: "MP3", bitrate: "128", votes: "42"
});
assert.ok(station);
assert.equal(station.name, "Radio Café");
assert.equal(station.url, "https://stream.example/radio.mp3");
assert.equal(station.country, "Argentina");
assert.equal(station.bitrate, 128);

assert.equal(SAVED_RADIO_STATIONS_SETTING_KEY, "ritmo.saved-radio-stations.v1");
assert.equal(isRadioStationTrack({ kind: "url", radioStationUuid: station.stationuuid }), true);
assert.equal(isRadioStationTrack({ kind: "url", sourceProvider: "Radio Browser" }), true);
assert.equal(isRadioStationTrack({ kind: "file", radioStationUuid: station.stationuuid }), false,
  "A local audio file must never be classified as a radio station.");
assert.equal(isRadioStationTrack({ kind: "url", sourceProvider: "Internet Archive" }), false,
  "Other streaming catalogue entries must not be mistaken for Radio Browser stations.");

const savedCollection = normalizeSavedRadioStations([
  station,
  station,
  { ...station, stationuuid: "different-radio-id" },
  { stationuuid: "not-valid", name: "Bad", url: "https://stream.example/radio.mp3" },
  { ...station, url: "http://stream.example/insecure.mp3", stationuuid: "radio-without-https" }
]);
assert.equal(savedCollection.length, 1, "Saved stations should deduplicate by stream URL and reject invalid/HTTP streams.");
assert.equal(savedCollection[0].stationuuid, station.stationuuid);
const migrated = migrateRadioStationsFromTracks(savedCollection, [
  { id: "legacy-radio-1", kind: "url", url: station.url, title: station.name, radioStationUuid: station.stationuuid, sourceProvider: "Radio Browser" },
  { id: "song-url", kind: "url", url: "https://media.example/track.mp3", title: "Other stream", sourceProvider: "Internet Archive" },
  { id: "local-song", kind: "file", title: "Local song" }
]);
assert.deepEqual(migrated.legacyTrackIds, ["legacy-radio-1"]);
assert.equal(migrated.stations.length, 1, "Migrating a legacy radio must not duplicate its saved station.");
const anotherStation = { ...station, stationuuid: "eeced67f-a234-4cda-a5df-3c9791c1d3b7", name: "Radio Dos", url: "https://stream.example/dos.mp3" };
const upserted = upsertSavedRadioStation(savedCollection, anotherStation);
assert.equal(upserted.length, 2);
assert.equal(upserted[0].stationuuid, anotherStation.stationuuid, "Newly saved stations should be visible first.");
assert.equal(removeSavedRadioStation(upserted, station.stationuuid).length, 1);
assert.equal(removeSavedRadioStation(upserted, "missing").length, 2);

assert.equal(normalizeRadioStation({ stationuuid: "abc-123", name: "No TLS", url_resolved: "http://stream.example/live" }).url, "");
assert.equal(normalizeRadioStation({ stationuuid: "abc-123", name: "HLS", url_resolved: "https://stream.example/live.m3u8" }).url, "");
assert.equal(normalizeRadioStation({ stationuuid: "abc-123", name: "Unsafe", url_resolved: "https://user:pass@stream.example/live" }).url, "");
assert.equal(normalizeRadioStation({ stationuuid: "!", name: "Bad identity", url_resolved: "https://stream.example/live" }), null);
assert.match(radioStationClickUrl(station.stationuuid), /^https:\/\/de1\.api\.radio-browser\.info\/json\/url\//);
assert.equal(RADIO_BROWSER_MIRRORS.length, 3);

let calls = 0;
const result = await searchRadioBrowser("ambient", "tag", {
  fetchImpl: async () => {
    calls++;
    if (calls === 1) throw new Error("mirror offline");
    return {
      ok: true, status: 200,
      json: async () => [{
        stationuuid: station.stationuuid, name: station.name, url_resolved: station.url,
        homepage: station.homepage, country: station.country, language: station.language, codec: station.codec
      }]
    };
  }
});
assert.equal(calls, 2, "Search should fail over to another public mirror");
assert.equal(result.stations.length, 1);
assert.equal(result.mirror, RADIO_BROWSER_MIRRORS[1]);
console.log("Online services checks passed: safe Spotify embeds, HTTPS radio streams, mirror fallback and malformed input rejection.");


const invidiousUrl = new URL(buildInvidiousYoutubeSearchUrl("  lofi   música ", INVIDIOUS_SEARCH_INSTANCES[0]));
assert.equal(invidiousUrl.hostname, new URL(INVIDIOUS_SEARCH_INSTANCES[0]).hostname);
assert.equal(invidiousUrl.pathname, "/api/v1/search");
assert.equal(invidiousUrl.searchParams.get("q"), "lofi música");
assert.equal(invidiousUrl.searchParams.get("type"), "video");
assert.throws(() => buildInvidiousYoutubeSearchUrl("   "));
assert.throws(() => buildInvidiousYoutubeSearchUrl("jazz", "https://untrusted.example"));

const communityVideo = normalizeInvidiousYoutubeResult({
  type: "video",
  videoId: "dQw4w9WgXcQ",
  title: "  Prueba   musical ",
  author: "Artista Demo",
  description: "Descripción de prueba"
});
assert.equal(communityVideo?.id.videoId, "dQw4w9WgXcQ");
assert.equal(communityVideo?.snippet.title, "Prueba musical");
assert.equal(communityVideo?.snippet.channelTitle, "Artista Demo");
assert.equal(communityVideo?.snippet.thumbnails.medium.url, "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg");
assert.equal(communityVideo?.ritmoStatusVerified, false, "Community results must never masquerade as official embed-status verification");
assert.equal(communityVideo?.ritmoEmbeddable, false, "Unverified community results must open in YouTube instead of embedding");
assert.equal(normalizeInvidiousYoutubeResult({ type: "playlist", videoId: "dQw4w9WgXcQ", title: "No" }), null);
assert.equal(normalizeInvidiousYoutubeResult({ type: "video", videoId: "invalid", title: "No" }), null);
assert.equal(INVIDIOUS_SEARCH_INSTANCES.length, 4);
assert.ok(INVIDIOUS_SEARCH_INSTANCES.every(instance => instance.startsWith("https://")));
assert.ok(INVIDIOUS_SEARCH_INSTANCES.every(instance => !instance.includes("f5.si")),
  "Only currently listed public instances are allowed; unlisted instances are not trusted");
assert.ok(INVIDIOUS_SEARCH_INSTANCES.every(instance =>
  ["yt.chocolatemoo53.com", "invidious.nerdvpn.de", "invidious.tiekoetter.com", "inv.nadeko.net"].includes(new URL(instance).hostname)
), "Instance allowlist must match Invidious' current public directory");

const local = new Map();
const fakeStorage = {
  getItem: key => local.has(key) ? local.get(key) : null,
  setItem: (key, value) => local.set(key, String(value)),
  removeItem: key => local.delete(key)
};
assert.equal(YOUTUBE_MODE_STORAGE_KEY, "ritmo.youtube-enabled.v1");
assert.equal(readYoutubeModeEnabled(fakeStorage), false, "YouTube must be opt-in by default");
assert.equal(persistYoutubeModeEnabled(true, fakeStorage), true);
assert.equal(readYoutubeModeEnabled(fakeStorage), true, "Explicit opt-in should persist");
assert.equal(persistYoutubeModeEnabled(false, fakeStorage), true);
assert.equal(readYoutubeModeEnabled(fakeStorage), false, "Turning YouTube off should persist");
assert.equal(readYoutubeModeEnabled({ getItem: () => { throw new Error("blocked"); } }), false);
assert.equal(persistYoutubeModeEnabled(true, { setItem: () => { throw new Error("blocked"); } }), false);

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
assert.match(appSource, /youtubeSearchAbortController\?\.abort\(\)/);
assert.match(appSource, /frame\.src = "about:blank"/, "Disabling YouTube must unload its iframe");
assert.match(appSource, /setYoutubeModeEnabled\(false\)/, "The off action must stop the embedded player");
assert.match(appSource, /function fallbackToOfficialYoutubeSearch\(query, message\)/, "Failed keyless search must have an explicit official YouTube fallback");
assert.match(appSource, /nativePlugin\?\.openExternal[\s\S]*?openExternal\(youtubeSearchURL\(query\)\)/, "Android should route to official YouTube automatically when community search fails");
assert.match(appSource, /Tocá «Abrir búsqueda en YouTube» para continuar; no hace falta una clave API/, "Web fallback must be clear and keyless");
const youtubePlayStart = appSource.indexOf("function playYoutubeVideo(");
assert.ok(youtubePlayStart >= 0);
const youtubePlaySource = appSource.slice(youtubePlayStart, youtubePlayStart + 2600);
assert.ok(youtubePlaySource.indexOf('wrap.hidden = false') < youtubePlaySource.indexOf('frame.src = embedURL'),
  "The official player must be visible before autoplay loads");
const mediaSessionStart = appSource.indexOf("function updateMediaSession()");
const mediaSessionEnd = appSource.indexOf("function setupMediaSession()", mediaSessionStart);
const mediaSessionSource = appSource.slice(mediaSessionStart, mediaSessionEnd);
assert.match(mediaSessionSource, /if \(youtubeSession\)[\s\S]*?clearMediaSession\(navigator\.mediaSession, state\);[\s\S]*?return;/,
  "Ritmo must not provide system background controls for embedded YouTube");
assert.match(pageSource, /id="youtube-mode-toggle"/, "The consent toggle must be visible in the UI");
assert.match(pageSource, /id="youtube-network-status"/, "Network and data-use warning must be visible");
assert.match(pageSource, /Ritmo no ofrece reproducción de este video en segundo plano/);

let communityCalls = 0;
const communityResult = await searchInvidiousYoutube("ambient music", {
  timeoutMs: 900,
  fetchImpl: async requestUrl => {
    communityCalls++;
    if (communityCalls === 1) return { ok: false, status: 503 };
    assert.equal(new URL(requestUrl).hostname, new URL(INVIDIOUS_SEARCH_INSTANCES[1]).hostname);
    assert.match(new URL(requestUrl).pathname, /^\/api\/v1\/search$/);
    return {
      ok: true,
      status: 200,
      json: async () => [
        { type: "video", videoId: "dQw4w9WgXcQ", title: "Ambient track", author: "Demo" },
        { type: "channel", authorId: "channel1", author: "Ignore this non-video result" },
        { type: "video", videoId: "bad-id", title: "Malformed" }
      ]
    };
  }
});
assert.equal(communityCalls, 2, "Community search should retry another documented instance after a failure");
assert.equal(communityResult.instance, INVIDIOUS_SEARCH_INSTANCES[1]);
assert.equal(communityResult.items.length, 1, "Only well-formed video results should be returned");
assert.equal(communityResult.items[0].snippet.title, "Ambient track");

// A 200 response with zero usable videos must not prevent trying the next mirror.
let emptyMirrorCalls = 0;
const afterEmptyMirror = await searchInvidiousYoutube("ambient with mirror failover", {
  timeoutMs: 900,
  fetchImpl: async requestUrl => {
    const host = new URL(requestUrl).hostname;
    emptyMirrorCalls++;
    if (emptyMirrorCalls === 1) {
      assert.equal(host, new URL(INVIDIOUS_SEARCH_INSTANCES[0]).hostname);
      return { ok: true, status: 200, json: async () => [] };
    }
    assert.equal(host, new URL(INVIDIOUS_SEARCH_INSTANCES[1]).hostname);
    return { ok: true, status: 200, json: async () => [
      { type: "video", videoId: "dQw4w9WgXcQ", title: "Found after empty mirror", author: "Demo" }
    ] };
  }
});
assert.equal(emptyMirrorCalls, 2, "An empty 200 response should fail over before being treated as no results");
assert.equal(afterEmptyMirror.instance, INVIDIOUS_SEARCH_INSTANCES[1]);
assert.equal(afterEmptyMirror.items[0].snippet.title, "Found after empty mirror");

const communityAbort = new AbortController();
communityAbort.abort();
await assert.rejects(
  searchInvidiousYoutube("cancelled", { signal: communityAbort.signal, fetchImpl: async () => { throw new Error("must not call fetch"); } }),
  error => error?.name === "AbortError"
);
console.log("Keyless YouTube community search checks passed: host allowlist, schema normalization, mirror failover on errors/empty responses, official fallback and cancellation.");

const networkStorage = {
  value: null,
  getItem(key) { assert.equal(key, NETWORK_MODE_STORAGE_KEY); return this.value; },
  setItem(key, value) { assert.equal(key, NETWORK_MODE_STORAGE_KEY); this.value = value; }
};
assert.equal(readNetworkModeEnabled(networkStorage), true, "Internet mode remains the backwards-compatible default");
assert.equal(persistNetworkModeEnabled(false, networkStorage), true);
assert.equal(networkStorage.value, "offline");
assert.equal(readNetworkModeEnabled(networkStorage), false, "Offline mode must persist between launches");
assert.equal(networkModeCanUseInternet(false, true), false, "App offline mode must lock network features even when the device is connected");
assert.equal(networkModeCanUseInternet(true, false), false, "Network-dependent features must lock when the device has no connection");
assert.equal(networkModeCanUseInternet(true, true), true, "Network-dependent features unlock only when mode and connectivity permit them");
assert.equal(readNetworkModeEnabled({ getItem() { throw new Error("blocked storage"); } }), true, "Storage errors must fall back without crashing");
assert.equal(persistNetworkModeEnabled(false, { setItem() { throw new Error("blocked storage"); } }), false, "A blocked storage write must be reported");

