import { AUDIO_GENRE_MODEL_ID, AUDIO_GENRE_MODEL_REVISION } from "./music-genre-classifier.js";

let busy = false;

function postProgress(message) {
  self.postMessage({ type: "progress", message });
}

self.addEventListener("message", async event => {
  if (busy || event.data?.type !== "classify") return;
  busy = true;
  try {
    const samples = event.data.samples instanceof Float32Array
      ? event.data.samples
      : new Float32Array(event.data.samples || []);
    if (samples.length < 16000 * 3) throw new Error("La muestra de audio es demasiado corta.");

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
    postProgress("Analizando una muestra central de hasta 12 segundos en este dispositivo…");
    const predictions = await classifier(samples, { top_k: 10 });
    self.postMessage({
      type: "result",
      predictions: Array.isArray(predictions)
        ? predictions.map(item => ({ label: item?.label, score: item?.score }))
        : []
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: String(error?.message || "No se pudo cargar el modelo acústico. Requiere conexión la primera vez.")
    });
  } finally {
    busy = false;
  }
});
