// Controls output level for both the native and Web Audio playback engines.
// Safari versions have shipped with HTMLMediaElement.volume ineffective for
// media elements connected to an AudioContext, so the processed path uses GainNode.
export function createAudioOutputVolumeController({
  defaultAudio,
  equalizedAudio,
  getAudioGraph,
  getAudioContext
}) {
  function setVolume(value) {
    const requested = Number(value);
    const volume = Number.isFinite(requested) ? Math.min(1, Math.max(0, requested)) : 0;
    defaultAudio.volume = volume;

    const graph = getAudioGraph();
    const context = getAudioContext();
    if (graph?.outputGain?.gain && context) {
      // Avoid multiplying the slider level twice in browsers which do honor
      // HTMLMediaElement.volume after createMediaElementSource().
      equalizedAudio.volume = 1;
      const gain = graph.outputGain.gain;
      if (typeof gain.setTargetAtTime === "function") {
        gain.setTargetAtTime(volume, context.currentTime, 0.015);
      } else {
        gain.value = volume;
      }
    } else {
      equalizedAudio.volume = volume;
    }

    return volume;
  }

  return { setVolume };
}
