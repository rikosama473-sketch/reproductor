/**
 * Merge numeric media properties from Android scans without erasing previously
 * known values when a provider returns zero, null, NaN, or another unusable value.
 * discoveredDivisor converts fresh provider units (MediaStore duration is ms)
 * into the units already stored by Ritmo (duration is seconds).
 */
export function preserveKnownScanNumber(existingValue, discoveredValue, discoveredDivisor = 1) {
  const rawDivisor = Number(discoveredDivisor);
  const divisor = Number.isFinite(rawDivisor) && rawDivisor > 0 ? rawDivisor : 1;
  const discovered = Number(discoveredValue);
  if (Number.isFinite(discovered) && discovered > 0) return discovered / divisor;

  const existing = Number(existingValue);
  return Number.isFinite(existing) && existing > 0 ? existing : 0;
}
