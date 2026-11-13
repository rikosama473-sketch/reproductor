// Independent, dependency-free implementation of the documented MusiCNN
// log-mel input transform used by the Discogs-EffNet ONNX model.
// It does not import, bundle, or copy Essentia code.

export const EFFNET_SAMPLE_RATE = 16000;
export const MUSICNN_FRAME_SIZE = 512;
export const MUSICNN_HOP_SIZE = 256;
export const MUSICNN_MEL_BANDS = 96;
export const EFFNET_PATCH_SIZE = 128;
export const EFFNET_PATCH_HOP_SIZE = 62;

const FFT_SIZE = MUSICNN_FRAME_SIZE;
const SPECTRUM_BINS = FFT_SIZE / 2 + 1;
const BIN_HZ = EFFNET_SAMPLE_RATE / FFT_SIZE;
const MEL_LOW_HZ = 0;
const MEL_HIGH_HZ = EFFNET_SAMPLE_RATE / 2;
const MEL_SCALE_FACTOR = 10000;
const MEL_SHIFT = 1;

function hzToSlaneyMel(hz) {
  const linearSlope = 3 / 200;
  const minLogHz = 1000;
  const minLogMel = minLogHz * linearSlope;
  const logStep = Math.log(6.4) / 27;
  return hz < minLogHz
    ? hz * linearSlope
    : minLogMel + Math.log(hz / minLogHz) / logStep;
}

function slaneyMelToHz(mel) {
  const linearSlope = 3 / 200;
  const minLogHz = 1000;
  const minLogMel = minLogHz * linearSlope;
  const logStep = Math.log(6.4) / 27;
  return mel < minLogMel
    ? mel / linearSlope
    : minLogHz * Math.exp((mel - minLogMel) * logStep);
}

function buildMelFilterBank() {
  const lowMel = hzToSlaneyMel(MEL_LOW_HZ);
  const highMel = hzToSlaneyMel(MEL_HIGH_HZ);
  const edges = new Float64Array(MUSICNN_MEL_BANDS + 2);

  for (let index = 0; index < edges.length; index++) {
    const mel = lowMel + (highMel - lowMel) * index / (edges.length - 1);
    edges[index] = slaneyMelToHz(mel);
  }

  const filters = [];
  for (let band = 0; band < MUSICNN_MEL_BANDS; band++) {
    const left = edges[band];
    const center = edges[band + 1];
    const right = edges[band + 2];
    const leftWidth = center - left;
    const rightWidth = right - center;
    const triangleArea = (leftWidth + rightWidth) / 2;
    if (!(leftWidth > 0 && rightWidth > 0 && triangleArea > 0)) {
      throw new Error("Invalid Slaney mel filter geometry.");
    }

    const weights = new Float64Array(SPECTRUM_BINS);
    const firstBin = Math.max(0, Math.ceil(left / BIN_HZ));
    const lastBin = Math.min(SPECTRUM_BINS - 1, Math.floor(right / BIN_HZ));
    for (let bin = firstBin; bin <= lastBin; bin++) {
      const frequency = bin * BIN_HZ;
      const triangle = frequency < center
        ? (frequency - left) / leftWidth
        : (right - frequency) / rightWidth;
      weights[bin] = Math.max(0, triangle) / triangleArea;
    }
    filters.push(weights);
  }
  return filters;
}

const MEL_FILTERS = buildMelFilterBank();
const HANN_WINDOW = Float64Array.from(
  { length: MUSICNN_FRAME_SIZE },
  (_, index) => 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (MUSICNN_FRAME_SIZE - 1))
);

function fftPowerSpectrum(frame) {
  const real = new Float64Array(FFT_SIZE);
  const imaginary = new Float64Array(FFT_SIZE);
  for (let index = 0; index < FFT_SIZE; index++) {
    real[index] = frame[index] * HANN_WINDOW[index];
  }

  // In-place radix-2 Cooley-Tukey FFT; only non-negative bins are consumed.
  let reversed = 0;
  for (let index = 1; index < FFT_SIZE; index++) {
    let bit = FFT_SIZE >> 1;
    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }

  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const angle = -2 * Math.PI / size;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    const half = size >> 1;
    for (let start = 0; start < FFT_SIZE; start += size) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let offset = 0; offset < half; offset++) {
        const even = start + offset;
        const odd = even + half;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        const evenReal = real[even];
        const evenImaginary = imaginary[even];

        real[even] = evenReal + oddReal;
        imaginary[even] = evenImaginary + oddImaginary;
        real[odd] = evenReal - oddReal;
        imaginary[odd] = evenImaginary - oddImaginary;

        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }

  const power = new Float64Array(SPECTRUM_BINS);
  for (let bin = 0; bin < SPECTRUM_BINS; bin++) {
    power[bin] = real[bin] * real[bin] + imaginary[bin] * imaginary[bin];
  }
  return power;
}

function createCenteredFrame(samples, centerSample) {
  const frame = new Float64Array(MUSICNN_FRAME_SIZE);
  const start = centerSample - MUSICNN_FRAME_SIZE / 2;
  for (let index = 0; index < MUSICNN_FRAME_SIZE; index++) {
    const sourceIndex = start + index;
    if (sourceIndex >= 0 && sourceIndex < samples.length) {
      frame[index] = samples[sourceIndex];
    }
  }
  return frame;
}

function validateSamples(samples) {
  if (!(samples instanceof Float32Array) && !(samples instanceof Float64Array)) {
    throw new TypeError("EffNet preprocessing expects a mono Float32Array or Float64Array at 16 kHz.");
  }
  for (let index = 0; index < samples.length; index++) {
    if (!Number.isFinite(samples[index])) {
      throw new TypeError("Audio samples must all be finite numbers.");
    }
  }
}

export function extractMusiCNNMelFrames(samples) {
  validateSamples(samples);
  if (samples.length === 0) return [];

  // Essentia's default FrameCutter starts with a frame centered at sample 0,
  // advances 256 samples, zero-pads frame edges, and stops before a center
  // reaches or passes the end of the signal.
  const frameCount = Math.ceil(samples.length / MUSICNN_HOP_SIZE);
  const frames = new Array(frameCount);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const center = frameIndex * MUSICNN_HOP_SIZE;
    const spectrumPower = fftPowerSpectrum(createCenteredFrame(samples, center));
    const mel = new Float32Array(MUSICNN_MEL_BANDS);

    for (let band = 0; band < MUSICNN_MEL_BANDS; band++) {
      const weights = MEL_FILTERS[band];
      let energy = 0;
      for (let bin = 0; bin < SPECTRUM_BINS; bin++) {
        energy += spectrumPower[bin] * weights[bin];
      }
      mel[band] = Math.log10(MEL_SHIFT + MEL_SCALE_FACTOR * energy);
    }
    frames[frameIndex] = mel;
  }
  return frames;
}

export function buildEffnetPatchTensor(
  melFrames,
  { patchSize = EFFNET_PATCH_SIZE, patchHopSize = EFFNET_PATCH_HOP_SIZE } = {}
) {
  if (!Array.isArray(melFrames)) throw new TypeError("melFrames must be an array.");
  if (!Number.isInteger(patchSize) || patchSize !== EFFNET_PATCH_SIZE) {
    throw new RangeError("Discogs-EffNet requires patchSize=128.");
  }
  if (!Number.isInteger(patchHopSize) || patchHopSize < 1) {
    throw new RangeError("patchHopSize must be a positive integer.");
  }
  for (const frame of melFrames) {
    if (!(frame instanceof Float32Array) || frame.length !== MUSICNN_MEL_BANDS) {
      throw new TypeError("Every mel frame must contain exactly 96 Float32 values.");
    }
  }

  const patchCount = melFrames.length < patchSize
    ? 0
    : 1 + Math.floor((melFrames.length - patchSize) / patchHopSize);
  const data = new Float32Array(patchCount * patchSize * MUSICNN_MEL_BANDS);
  const valuesPerPatch = patchSize * MUSICNN_MEL_BANDS;

  for (let patch = 0; patch < patchCount; patch++) {
    const firstFrame = patch * patchHopSize;
    const patchOffset = patch * valuesPerPatch;
    for (let frame = 0; frame < patchSize; frame++) {
      data.set(melFrames[firstFrame + frame], patchOffset + frame * MUSICNN_MEL_BANDS);
    }
  }

  return {
    data,
    dims: [patchCount, patchSize, MUSICNN_MEL_BANDS],
    patchCount,
    melFrameCount: melFrames.length,
    discardedTailFrames: patchCount
      ? melFrames.length - ((patchCount - 1) * patchHopSize + patchSize)
      : melFrames.length
  };
}

export function preprocessEffnetAudio(samples, options) {
  const melFrames = extractMusiCNNMelFrames(samples);
  const tensor = buildEffnetPatchTensor(melFrames, options);
  return { ...tensor, melFrames };
}
