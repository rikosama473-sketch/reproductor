import {
  AUDIO_GENRE_MODEL_ID,
  AUDIO_GENRE_MODEL_REVISION,
  AUDIO_GENRE_MAX_SEGMENTS
} from "./music-genre-classifier.js";

let busy = false;

function postProgress(message) {
  self.postMessage({ type: "progress", message });
}

self.addEventListener("message", async event => {
  if (busy || event.data?.type !== "classify") return;
  busy = true;
  try {
    const rawSamples = event.data.samples;
    const samples = rawSamples instanceof Float32Array ? [rawSamples] : rawSamples;
    if (!Array.isArray(samples) || !samples.length || samples.length > AUDIO_GENRE_MAX_SEGMENTS ||
        samples.some(segment => !(segment instanceof Float32Array) || segment.length < 16000 * 3)) {
      throw new Error("Los fragmentos de audio no tienen un formato compatible.");
    }

    postProgress("Cargando el motor acústico local; en el primer uso descarga unos 24 MB.");
    // Pin a known Transformers.js release and model revision. Inference runs in
    // this worker with WebAssembly on CPU; the music samples are never uploaded.
    const { pipeline, env } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2");
    env.useBrowserCache = true;
    env.allowRemoteModels = true;
    env.allowLocalModels = false;
    if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 2;

    const classifier = await pipeline("audio-classification", AUDIO_GENRE_MODEL_ID, {
      revision: AUDIO_GENRE_MODEL_REVISION,
      dtype: "q8",
      progress_callback: detail => {
        if (detail?.status === "progress" && Number.isFinite(detail.progress)) {
          const filename = String(detail.file || "").split("/").pop() || "modelo";
          postProgress("Descargando " + filename + " (" + Math.round(detail.progress) + " %).");
        } else if (detail?.status === "done") {
          postProgress("Modelo descargado; preparando el análisis de audio…");
        }
      }
    });

    const segmentPredictions = [];
    for (let index = 0; index < samples.length; index++) {
      postProgress("Analizando fragmento " + (index + 1) + " de " + samples.length + " localmente…");
      const predictions = await classifier(samples[index], { top_k: 10 });
      if (!Array.isArray(predictions) || !predictions.length) {
        throw new Error("El modelo no devolvió resultados para uno de los fragmentos.");
      }
      segmentPredictions.push(predictions.map(item => ({
        label: item?.label,
        score: item?.score
      })));
    }

    self.postMessage({ type: "result", segmentPredictions });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: String(error?.message || "No se pudo cargar el modelo acústico. Requiere conexión la primera vez.")
    });
  } finally {
    busy = false;
  }
});
