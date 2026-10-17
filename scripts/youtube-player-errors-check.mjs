import assert from "node:assert/strict";
import { readableYoutubePlayerError } from "../src/youtube-player-errors.js";

const cases = new Map([
  [2, /identificador o un parámetro del video no es válido/i],
  [5, /reproductor HTML5/i],
  [100, /eliminado o marcado como privado/i],
  [101, /no permite reproducirlo en reproductores insertados/i],
  [150, /no permite reproducirlo en reproductores insertados/i],
  [153, /Referer.*identificación equivalente/i]
]);

for (const [code, expected] of cases) {
  assert.match(readableYoutubePlayerError(code), expected, "YouTube error " + code + " should have an actionable explanation");
  assert.match(readableYoutubePlayerError(String(code)), expected, "String error codes should be handled too");
}
assert.match(readableYoutubePlayerError(999), /código 999/i, "Unrecognized numeric errors should still show their code");
assert.match(readableYoutubePlayerError("invalid"), /código desconocido/i, "Unrecognized non-numeric errors should stay readable");
console.log("YouTube player error tests passed: documented codes 2, 5, 100, 101, 150, 153, and safe fallback.");
