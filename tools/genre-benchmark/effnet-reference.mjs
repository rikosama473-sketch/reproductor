export const EFFNET_REFERENCE_CONFIG = Object.freeze({
  sampleRateHz: 16000,
  channels: 1,
  frameSize: 512,
  hopSize: 256,
  melBands: 96,
  startFromZero: false,
  validFrameThresholdRatio: 0,
  window: "hann",
  windowNormalized: false,
  spectrumType: "power",
  melScale: "slaney",
  melNormalization: "unit_tri",
  melScaleFactor: 10000,
  melShift: 1,
  compression: "log10"
});

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_REFERENCE_FRAMES = 200000;

export function validateEffnetReference(reference) {
  const errors = [];
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
    return ["El documento de referencia debe ser un objeto JSON."];
  }
  if (reference.schemaVersion !== 1) errors.push("schemaVersion debe ser 1.");

  const source = reference.source;
  if (!source || typeof source !== "object" ||
      source.engine !== "Essentia" ||
      source.algorithm !== "TensorflowInputMusiCNN" ||
      typeof source.version !== "string" || !source.version.trim()) {
    errors.push("source debe identificar Essentia, TensorflowInputMusiCNN y su versión.");
  }

  const audio = reference.audio;
  if (!audio || typeof audio !== "object" ||
      !SHA256_PATTERN.test(audio.sha256 || "")) {
    errors.push("audio.sha256 debe contener el SHA-256 hexadecimal del WAV comparado.");
  } else {
    if (audio.sampleRateHz !== EFFNET_REFERENCE_CONFIG.sampleRateHz) {
      errors.push("audio.sampleRateHz debe ser 16000.");
    }
    if (audio.channels !== EFFNET_REFERENCE_CONFIG.channels) {
      errors.push("audio.channels debe ser 1.");
    }
    if (audio.sampleFormat !== "PCM16") {
      errors.push("audio.sampleFormat debe ser PCM16.");
    }
  }

  const config = reference.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    errors.push("config debe describir los parámetros del extractor.");
  } else {
    for (const [key, expected] of Object.entries(EFFNET_REFERENCE_CONFIG)) {
      if (config[key] !== expected) {
        errors.push("config." + key + " debe ser " + JSON.stringify(expected) + ".");
      }
    }
  }

  if (!Array.isArray(reference.frames) || reference.frames.length === 0) {
    errors.push("frames debe contener al menos un frame de 96 bandas.");
  } else {
    if (reference.frames.length > MAX_REFERENCE_FRAMES) {
      errors.push("frames supera el máximo de " + MAX_REFERENCE_FRAMES + " frames.");
    }
    for (let frameIndex = 0; frameIndex < reference.frames.length; frameIndex++) {
      const frame = reference.frames[frameIndex];
      if (!Array.isArray(frame) || frame.length !== EFFNET_REFERENCE_CONFIG.melBands) {
        errors.push("frames[" + frameIndex + "] debe contener exactamente 96 valores.");
        continue;
      }
      for (let bandIndex = 0; bandIndex < frame.length; bandIndex++) {
        if (!Number.isFinite(frame[bandIndex])) {
          errors.push("frames[" + frameIndex + "][" + bandIndex + "] debe ser finito.");
          break;
        }
      }
      if (errors.length > 20) {
        errors.push("Se omitieron errores adicionales de frames.");
        break;
      }
    }
  }
  return errors;
}

export function compareEffnetMelFrames(actualFrames, referenceFrames, {
  absoluteTolerance = 1e-3,
  relativeTolerance = 1e-3
} = {}) {
  if (!Array.isArray(actualFrames) || !Array.isArray(referenceFrames)) {
    throw new TypeError("Los frames locales y de referencia deben ser arrays.");
  }
  if (!Number.isFinite(absoluteTolerance) || absoluteTolerance < 0 ||
      !Number.isFinite(relativeTolerance) || relativeTolerance < 0) {
    throw new RangeError("Las tolerancias absoluta y relativa deben ser números no negativos.");
  }
  if (actualFrames.length !== referenceFrames.length) {
    return {
      passed: false,
      reason: "frame-count-mismatch",
      actualFrameCount: actualFrames.length,
      referenceFrameCount: referenceFrames.length,
      comparedValueCount: 0,
      withinToleranceCount: 0,
      outsideToleranceCount: null,
      maxAbsoluteError: null,
      meanAbsoluteError: null,
      rootMeanSquareError: null,
      pearsonCorrelation: null,
      withinToleranceRate: 0,
      worstValue: null,
      worstBands: []
    };
  }
  if (actualFrames.length === 0) throw new RangeError("No hay frames para comparar.");

  let count = 0;
  let withinToleranceCount = 0;
  let maxAbsoluteError = -1;
  let sumAbsoluteError = 0;
  let sumSquaredError = 0;
  let sumActual = 0;
  let sumReference = 0;
  let sumActualSquared = 0;
  let sumReferenceSquared = 0;
  let sumProducts = 0;
  const bandStats = Array.from({ length: EFFNET_REFERENCE_CONFIG.melBands }, () => ({
    absoluteErrorSum: 0,
    comparedValueCount: 0,
    maxAbsoluteError: 0
  }));
  let worstValue = null;

  for (let frameIndex = 0; frameIndex < actualFrames.length; frameIndex++) {
    const actual = actualFrames[frameIndex];
    const reference = referenceFrames[frameIndex];
    if ((!ArrayBuffer.isView(actual) && !Array.isArray(actual)) ||
        (!ArrayBuffer.isView(reference) && !Array.isArray(reference)) ||
        actual.length !== EFFNET_REFERENCE_CONFIG.melBands ||
        reference.length !== EFFNET_REFERENCE_CONFIG.melBands) {
      throw new TypeError("Cada frame local y de referencia debe contener 96 valores.");
    }

    for (let bandIndex = 0; bandIndex < EFFNET_REFERENCE_CONFIG.melBands; bandIndex++) {
      const actualValue = actual[bandIndex];
      const referenceValue = reference[bandIndex];
      if (!Number.isFinite(actualValue) || !Number.isFinite(referenceValue)) {
        throw new TypeError("Las matrices de mel no pueden contener NaN ni infinitos.");
      }

      const absoluteError = Math.abs(actualValue - referenceValue);
      const allowedError = absoluteTolerance + relativeTolerance * Math.abs(referenceValue);
      if (absoluteError <= allowedError) withinToleranceCount++;
      sumAbsoluteError += absoluteError;
      sumSquaredError += absoluteError * absoluteError;
      sumActual += actualValue;
      sumReference += referenceValue;
      sumActualSquared += actualValue * actualValue;
      sumReferenceSquared += referenceValue * referenceValue;
      sumProducts += actualValue * referenceValue;
      count++;

      const band = bandStats[bandIndex];
      band.absoluteErrorSum += absoluteError;
      band.comparedValueCount++;
      band.maxAbsoluteError = Math.max(band.maxAbsoluteError, absoluteError);

      if (absoluteError > maxAbsoluteError) {
        maxAbsoluteError = absoluteError;
        worstValue = {
          frameIndex,
          bandIndex,
          actual: actualValue,
          reference: referenceValue,
          absoluteError,
          allowedError
        };
      }
    }
  }

  const meanAbsoluteError = sumAbsoluteError / count;
  const rootMeanSquareError = Math.sqrt(sumSquaredError / count);
  const covariance = sumProducts - sumActual * sumReference / count;
  const actualVariance = sumActualSquared - sumActual * sumActual / count;
  const referenceVariance = sumReferenceSquared - sumReference * sumReference / count;
  const correlationDenominator = Math.sqrt(Math.max(0, actualVariance) * Math.max(0, referenceVariance));
  const pearsonCorrelation = correlationDenominator > 0
    ? covariance / correlationDenominator
    : null;
  const withinToleranceRate = withinToleranceCount / count;
  const worstBands = bandStats.map((band, bandIndex) => ({
    bandIndex,
    meanAbsoluteError: band.absoluteErrorSum / band.comparedValueCount,
    maxAbsoluteError: band.maxAbsoluteError
  })).sort((left, right) => right.meanAbsoluteError - left.meanAbsoluteError)
    .slice(0, 10);

  return {
    passed: withinToleranceCount === count,
    reason: withinToleranceCount === count ? null : "tolerance-exceeded",
    actualFrameCount: actualFrames.length,
    referenceFrameCount: referenceFrames.length,
    comparedValueCount: count,
    withinToleranceCount,
    outsideToleranceCount: count - withinToleranceCount,
    maxAbsoluteError,
    meanAbsoluteError,
    rootMeanSquareError,
    pearsonCorrelation,
    withinToleranceRate,
    worstValue,
    worstBands
  };
}
