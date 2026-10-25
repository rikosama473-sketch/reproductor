import assert from "node:assert/strict";
import { preserveKnownScanNumber } from "../src/native-track-scan.js";

// New positive provider values refresh the saved value.
assert.equal(preserveKnownScanNumber(180, 240000, 1000), 240,
  "A valid MediaStore duration should be converted from milliseconds and replace the old duration.");
assert.equal(preserveKnownScanNumber(1024, 4096), 4096,
  "A valid discovered file size should replace the older size.");
assert.equal(preserveKnownScanNumber(100, 200), 200,
  "A fresh modification timestamp should replace the previous timestamp.");

// Missing or unusable provider values must not erase values already learned by playback or prior scans.
for (const missing of [0, null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, ""]) {
  assert.equal(preserveKnownScanNumber(241, missing, 1000), 241,
    "Unknown duration metadata should preserve a known duration.");
  assert.equal(preserveKnownScanNumber(8192, missing), 8192,
    "Unknown file size should preserve the previous size.");
  assert.equal(preserveKnownScanNumber(1761000000000, missing), 1761000000000,
    "Unknown modification date should preserve the previous date.");
}

// A new track with no prior metadata remains an explicit unknown rather than inventing a value.
assert.equal(preserveKnownScanNumber(0, 0, 1000), 0);
assert.equal(preserveKnownScanNumber(undefined, Number.NaN), 0);
assert.equal(preserveKnownScanNumber(10, 300000, 1000), 300,
  "Only discovered values use the source divisor; saved values are already normalized.");

console.log("Android scan metric tests passed: update known values, retain previous metrics on provider gaps, normalize duration units and keep unknowns at zero.");
