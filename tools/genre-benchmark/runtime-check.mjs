import { env, pipeline } from "@huggingface/transformers";

if (typeof pipeline !== "function") {
  throw new Error("Transformers.js no exportó pipeline().");
}
if (!env || !env.backends?.onnx) {
  throw new Error("Transformers.js no expuso la configuración ONNX.");
}
console.log("Genre benchmark runtime import passed (Transformers.js " + (env.version || "3.7.2") + ").");
