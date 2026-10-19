import assert from "node:assert/strict";
import {
  parseSpotifyShareLink, buildRadioBrowserSearchUrl, normalizeRadioStation,
  radioStationClickUrl, searchRadioBrowser, RADIO_BROWSER_MIRRORS
} from "../src/online-services.js";

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
