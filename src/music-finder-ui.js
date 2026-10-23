import {
  MUSIC_RECOGNITION_RECORDING_MS,
  readMusicRecognitionToken,
  persistMusicRecognitionToken,
  clearMusicRecognitionToken,
  buildMusicSearchSources,
  normalizeMusicRecognitionResult
} from "./music-recognition.js";

const MAX_RECOGNITION_CLIP_BYTES = 2 * 1024 * 1024;

export function createMusicFinderController({
  $, escapeHTML, toast, getTracks, getTrack, isLocal, playTrack,
  requireInternetMode, networkModeIsAvailable
}) {
  let recorder = null;
  let stream = null;
  let timer = null;
  let requestId = 0;
  let requestController = null;
  let bound = false;

  function tokenStatus(message = "") {
    const status = $("#music-recognition-token-status");
    if (!status) return;
    status.textContent = message || (readMusicRecognitionToken()
      ? "Hay un token guardado en este navegador. No se mostrará en pantalla; podés borrarlo cuando quieras."
      : "Sin token guardado. La búsqueda por texto y la biblioteca local funcionan sin token.");
  }

  function renderSourceLinks(sources, extraClass = "") {
    return (sources || []).map(item =>
      '<a class="music-source-link ' + escapeHTML(extraClass) + '" data-network-only="true" href="' + escapeHTML(item.url) +
      '" target="_blank" rel="noopener noreferrer"><strong>' + escapeHTML(item.label) + '</strong><span>↗</span></a>'
    ).join("");
  }

  function renderSearch(rawQuery) {
    const query = String(rawQuery || "").trim().slice(0, 180);
    const root = $("#music-finder-search-results");
    const status = $("#music-finder-search-status");
    if (!root || !status) return;
    if (!query) {
      root.replaceChildren();
      status.textContent = "Escribí un título o artista. La búsqueda de la biblioteca funciona sin conexión.";
      return;
    }
    const key = query.toLocaleLowerCase();
    const tracks = (getTracks() || []).filter(track =>
      [track.title, track.artist, track.album, track.name, track.sourcePath]
        .filter(Boolean).join(" ").toLocaleLowerCase().includes(key)
    ).slice(0, 8);
    const localCards = tracks.map(track => {
      const local = isLocal(track);
      const locked = !local && !networkModeIsAvailable();
      return '<article class="music-local-match"><div class="music-local-match-art">♫</div><div class="music-local-match-copy"><strong>' +
        escapeHTML(track.title || track.name || "Audio sin título") + '</strong><small>' +
        escapeHTML(track.artist || "Artista desconocido") + ' · ' + escapeHTML(local ? "Archivo local" : (locked ? "🔒 Fuente online bloqueada" : "Fuente online")) +
        '</small></div><button type="button" class="button button-soft" data-music-finder-play="' + escapeHTML(track.id) +
        '">▶ Escuchar</button></article>';
    }).join("");
    const sources = renderSourceLinks(buildMusicSearchSources(query));
    root.innerHTML = '<section class="music-search-group"><h3>Tu biblioteca <span>' + tracks.length + '</span></h3>' +
      (localCards || '<p class="music-empty-note">No encontré una coincidencia local. Los archivos que todavía no importaste no se pueden identificar desde tu biblioteca.</p>') +
      '</section><section class="music-search-group music-external-searches"><h3>Buscar en otras fuentes</h3><p>Estos enlaces abren resultados de cada servicio; no certifican que la edición sea la original.</p><div class="music-source-grid">' +
      sources + '</div></section>';
    status.textContent = tracks.length
      ? "Encontré " + tracks.length + " coincidencia(s) en tu biblioteca. Las fuentes externas se abren por separado."
      : (networkModeIsAvailable() ? "No hay coincidencias locales. Probá las búsquedas externas de abajo." : "No hay coincidencias locales. Modo sin conexión: solo se puede buscar en la biblioteca guardada.");
  }

  function renderRecognition(song) {
    const root = $("#music-recognition-result");
    if (!root) return;
    if (!song) {
      root.innerHTML = '<div class="music-no-match"><strong>No se reconoció una canción.</strong><p>Probá de nuevo en un ambiente menos ruidoso o buscá por título/artista. No se inventó un resultado.</p></div>';
      return;
    }
    const artwork = song.artworkUrl
      ? '<img class="music-recognition-artwork" src="' + escapeHTML(song.artworkUrl) + '" alt="" loading="lazy" decoding="async">'
      : '<div class="music-recognition-artwork music-recognition-artwork-placeholder" aria-hidden="true">♫</div>';
    const details = [
      song.album ? "Álbum: " + song.album : "",
      song.releaseDate ? "Lanzamiento: " + song.releaseDate : "",
      song.label ? "Sello: " + song.label : "",
      song.timecode ? "Fragmento detectado: " + song.timecode : "",
      song.isrc ? "ISRC: " + song.isrc : ""
    ].filter(Boolean);
    const directLinks = renderSourceLinks(song.sources);
    const searchLinks = renderSourceLinks(song.searchSources);
    const preview = song.previewUrl
      ? '<div class="music-preview-wrap"><span>Vista previa oficial disponible</span><audio controls preload="none" src="' + escapeHTML(song.previewUrl) + '"></audio></div>'
      : "";
    root.innerHTML = '<article class="music-recognized-song"><div class="music-recognized-main">' + artwork +
      '<div class="music-recognized-copy"><span class="music-recognized-label">COINCIDENCIA POR HUELLA DE AUDIO</span><h3>' + escapeHTML(song.title) +
      '</h3><p class="music-recognized-artist">' + escapeHTML(song.artist) + '</p>' +
      (details.length ? '<ul class="music-recognized-details">' + details.map(item => '<li>' + escapeHTML(item) + '</li>').join("") + '</ul>' : "") +
      '</div></div>' + preview +
      (directLinks ? '<section class="music-recognized-sources"><h4>Fuentes de esta grabación</h4><div class="music-source-grid">' + directLinks + '</div></section>' : "") +
      '<section class="music-recognized-sources"><h4>Comparar otras ediciones</h4><p>Comprobá versiones, covers y lanzamientos alternativos en los catálogos.</p><div class="music-source-grid">' + searchLinks + '</div></section>' +
      '<p class="music-match-caveat">El reconocimiento identifica una grabación coincidente; no garantiza que sea la primera edición ni la versión original del tema. Comprobá álbum, sello y fuente.</p></article>';
  }

  async function submitClip(blob, token, currentRequestId) {
    if (!(blob instanceof Blob) || !blob.size) {
      $("#music-recognition-status").textContent = "No se capturó audio válido. Revisá el permiso del micrófono e intentá otra vez.";
      return;
    }
    if (blob.size > MAX_RECOGNITION_CLIP_BYTES) {
      $("#music-recognition-status").textContent = "El fragmento grabado supera 2 MB; no se envió. Probá de nuevo con otro navegador.";
      return;
    }
    if (!networkModeIsAvailable()) {
      $("#music-recognition-status").textContent = "La identificación necesita conexión y Modo Internet.";
      return;
    }
    const controller = new AbortController();
    requestController = controller;
    const data = new FormData();
    data.append("api_token", token);
    data.append("file", blob, "ritmo-audio-clip." + (blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm"));
    data.append("return", "apple_music,spotify,deezer,musicbrainz");
    data.append("market", "ar");
    $("#music-recognition-status").textContent = "Consultando AudD… El fragmento se envía al servicio para buscar coincidencias.";
    try {
      const response = await fetch("https://api.audd.io/", {
        method: "POST", body: data, signal: controller.signal,
        mode: "cors", credentials: "omit", cache: "no-store"
      });
      if (currentRequestId !== requestId) return;
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error("AudD respondió con el estado HTTP " + response.status + ".");
      const song = normalizeMusicRecognitionResult(payload);
      if (currentRequestId !== requestId) return;
      renderRecognition(song);
      $("#music-recognition-status").textContent = song
        ? "Coincidencia recibida. Las fuentes directas proceden de los metadatos del servicio; los enlaces de búsqueda sirven para contrastar otras ediciones."
        : "AudD procesó el fragmento, pero no encontró una coincidencia utilizable.";
    } catch (error) {
      if (currentRequestId !== requestId || error?.name === "AbortError") return;
      $("#music-recognition-status").textContent = error?.message || "No se completó la identificación. Comprobá token, conexión y límite de uso.";
    } finally {
      if (requestController === controller) requestController = null;
      if (currentRequestId === requestId) $("#music-recognition-start").disabled = !networkModeIsAvailable();
    }
  }

  function cancelCapture(message = "Grabación cancelada.") {
    requestId++;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    const controller = requestController;
    requestController = null;
    try { controller?.abort(); } catch {}
    const currentRecorder = recorder;
    recorder = null;
    if (currentRecorder && currentRecorder.state !== "inactive") {
      try { currentRecorder.stop(); } catch {}
    }
    if (stream) {
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch {}
      }
      stream = null;
    }
    const start = $("#music-recognition-start");
    if (start) start.disabled = !networkModeIsAvailable();
    $("#music-recognition-stop").hidden = true;
    $("#music-recognition-progress").hidden = true;
    $("#music-recognition-countdown").textContent = "8 s de audio como máximo";
    if (message) $("#music-recognition-status").textContent = message;
  }

  async function startCapture() {
    if (!requireInternetMode("identificar una canción")) {
      $("#music-recognition-status").textContent = "La identificación por audio necesita Modo Internet y conexión disponible.";
      return;
    }
    if (!$("#music-recognition-consent").checked) {
      $("#music-recognition-status").textContent = "Marcá primero la autorización: se enviará a AudD un fragmento de hasta 8 segundos.";
      return;
    }
    const token = readMusicRecognitionToken();
    if (!token) {
      $("#music-recognition-settings").open = true;
      $("#music-recognition-status").textContent = "Primero pegá y guardá tu token personal de AudD en «Configurar el servicio de reconocimiento».";
      $("#music-recognition-token").focus();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      $("#music-recognition-status").textContent = "Este navegador no ofrece grabación por micrófono. Usá HTTPS o localhost y un navegador compatible; la búsqueda por texto sigue disponible.";
      return;
    }

    // Consent applies to one capture; require a fresh explicit choice each time.
    $("#music-recognition-consent").checked = false;
    cancelCapture("");
    const currentRequestId = ++requestId;
    $("#music-recognition-result").replaceChildren();
    $("#music-recognition-start").disabled = true;
    $("#music-recognition-stop").hidden = false;
    $("#music-recognition-progress").hidden = false;
    $("#music-recognition-progress").value = 0;
    $("#music-recognition-status").textContent = "Solicitando permiso de micrófono…";
    let acquiredStream;
    try {
      acquiredStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false
      });
      if (currentRequestId !== requestId || !networkModeIsAvailable()) {
        acquiredStream.getTracks().forEach(track => track.stop());
        return;
      }
      stream = acquiredStream;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
        .find(type => MediaRecorder.isTypeSupported?.(type)) || "";
      const activeRecorder = mimeType ? new MediaRecorder(acquiredStream, { mimeType }) : new MediaRecorder(acquiredStream);
      const chunks = [];
      recorder = activeRecorder;
      let elapsedSeconds = 0;
      activeRecorder.addEventListener("dataavailable", event => {
        if (event.data?.size) chunks.push(event.data);
      });
      activeRecorder.addEventListener("error", () => {
        if (currentRequestId === requestId) cancelCapture("Falló la grabación. Revisá el permiso de micrófono e intentá otra vez.");
      }, { once: true });
      activeRecorder.addEventListener("stop", () => {
        for (const track of acquiredStream.getTracks()) {
          try { track.stop(); } catch {}
        }
        if (stream === acquiredStream) stream = null;
        if (recorder === activeRecorder) recorder = null;
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
        $("#music-recognition-stop").hidden = true;
        $("#music-recognition-progress").hidden = true;
        if (currentRequestId !== requestId || !networkModeIsAvailable()) return;
        const clip = new Blob(chunks, { type: activeRecorder.mimeType || "audio/webm" });
        void submitClip(clip, token, currentRequestId);
      }, { once: true });
      activeRecorder.start(250);
      $("#music-recognition-status").textContent = "Escuchando el ambiente. Evitá hablar durante la captura.";
      $("#music-recognition-countdown").textContent = "0 / 8 segundos";
      timer = window.setInterval(() => {
        if (currentRequestId !== requestId || activeRecorder.state !== "recording") return;
        elapsedSeconds = Math.min(8, elapsedSeconds + 1);
        $("#music-recognition-progress").value = elapsedSeconds;
        $("#music-recognition-countdown").textContent = elapsedSeconds + " / 8 segundos";
        if (elapsedSeconds >= Math.ceil(MUSIC_RECOGNITION_RECORDING_MS / 1000)) {
          clearInterval(timer);
          timer = null;
          try { activeRecorder.stop(); }
          catch (error) { cancelCapture(error?.message || "No se pudo terminar la grabación."); }
        }
      }, 1000);
    } catch (error) {
      if (acquiredStream) acquiredStream.getTracks().forEach(track => track.stop());
      if (currentRequestId === requestId) {
        recorder = null;
        stream = null;
        $("#music-recognition-start").disabled = !networkModeIsAvailable();
        $("#music-recognition-stop").hidden = true;
        $("#music-recognition-progress").hidden = true;
        $("#music-recognition-status").textContent = error?.name === "NotAllowedError"
          ? "El micrófono fue denegado. Concedé permiso en el navegador y volvé a intentarlo."
          : (error?.message || "No se pudo abrir el micrófono.");
      }
    }
  }

  function syncNetworkState(locked) {
    if (locked && (recorder?.state === "recording" || requestController)) {
      cancelCapture("La identificación se canceló porque se perdió la conexión o se activó el modo sin conexión.");
    }
    const note = $("#music-recognition-network-note");
    if (note) note.hidden = !locked;
    const start = $("#music-recognition-start");
    if (start) start.disabled = Boolean(locked || recorder?.state === "recording");
    const finder = $("#finder-view");
    if (finder) finder.classList.toggle("music-finder-network-locked", Boolean(locked));
  }

  function bindEvents() {
    if (bound) return;
    bound = true;
    $("#music-finder-search-form").addEventListener("submit", event => {
      event.preventDefault();
      renderSearch($("#music-finder-query").value);
    });
    $("#music-finder-search-results").addEventListener("click", event => {
      const button = event.target.closest("[data-music-finder-play]");
      if (button) {
        const track = getTrack(button.dataset.musicFinderPlay);
        if (track) void playTrack(track.id);
      }
    });
    $("#music-recognition-save-token").addEventListener("click", () => {
      const input = $("#music-recognition-token");
      if (!persistMusicRecognitionToken(input.value)) {
        $("#music-recognition-token-status").textContent = "Pegá un token válido antes de guardarlo. Si el almacenamiento está bloqueado, no se puede persistir.";
        input.focus();
        return;
      }
      input.value = "";
      tokenStatus("Token guardado solo en este navegador. El micrófono y el envío siguen requiriendo tu autorización.");
      toast("Token de reconocimiento guardado en este dispositivo.");
    });
    $("#music-recognition-clear-token").addEventListener("click", () => {
      clearMusicRecognitionToken();
      $("#music-recognition-token").value = "";
      tokenStatus("Token borrado de este navegador.");
      cancelCapture("Se borró el token guardado.");
    });
    $("#music-recognition-start").addEventListener("click", () => { void startCapture(); });
    $("#music-recognition-stop").addEventListener("click", () => {
      cancelCapture("Grabación cancelada. No se enviará el fragmento.");
    });
    document.addEventListener("click", event => {
      if (networkModeIsAvailable()) return;
      const link = event.target.closest("[data-network-only='true']");
      if (!link) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toast("🔒 Esta fuente necesita Modo Internet y conexión.");
    }, true);
    tokenStatus();
  }

  return {
    bindEvents,
    cancelCapture,
    renderSearch,
    syncNetworkState,
    tokenStatus
  };
}
