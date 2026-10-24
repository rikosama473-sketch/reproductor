package com.rikosama473.ritmo;

import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;

import java.io.File;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;

@CapacitorPlugin(name = "RitmoPlayback")
public class RitmoPlaybackPlugin extends Plugin {
    private ListenableFuture<MediaController> controllerFuture;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private synchronized ListenableFuture<MediaController> controllerFuture() {
        if (controllerFuture == null) {
            SessionToken token = new SessionToken(
                getContext(),
                new ComponentName(getContext(), RitmoPlaybackService.class)
            );
            controllerFuture = new MediaController.Builder(getContext(), token).buildAsync();
        }
        return controllerFuture;
    }

    private void discardControllerFuture(ListenableFuture<MediaController> future) {
        boolean shouldRelease;
        synchronized (this) {
            shouldRelease = controllerFuture == future;
            if (shouldRelease) controllerFuture = null;
        }
        // Only the code that still owns this future may release/reset it. This
        // prevents concurrent failed calls from clearing a newer controller.
        if (shouldRelease) MediaController.releaseFuture(future);
    }

    private interface ControllerAction {
        void run(MediaController controller);
    }

    private void withController(PluginCall call, ControllerAction action) {
        final ListenableFuture<MediaController> future;
        try { future = controllerFuture(); }
        catch (Exception error) {
            call.reject("No se pudo conectar con el reproductor Android.", error);
            return;
        }
        future.addListener(() -> mainHandler.post(() -> {
            final MediaController controller;
            try {
                controller = future.get();
            } catch (Exception error) {
                // A failed buildAsync() future is terminal. Clear it so a later
                // tap can establish a fresh connection instead of failing forever.
                discardControllerFuture(future);
                call.reject("No se pudo conectar con el reproductor Android. Volvé a intentar.", error);
                return;
            }
            try {
                action.run(controller);
            } catch (Exception error) {
                call.reject("Falló el motor de reproducción Android: " +
                    (error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()), error);
            }
        }), Runnable::run);
    }

    @Override
    protected void handleOnDestroy() {
        final ListenableFuture<MediaController> future;
        synchronized (this) {
            future = controllerFuture;
            controllerFuture = null;
        }
        // Releasing the controller unbinds this bridge from MediaSessionService;
        // it deliberately does not stop the service's player or background audio.
        if (future != null) MediaController.releaseFuture(future);
        super.handleOnDestroy();
    }

    @PluginMethod
    public void play(PluginCall call) {
        String rawUri = call.getString("uri");
        String rawPath = call.getString("path");
        Uri mediaUri;
        if (rawUri != null && !rawUri.trim().isEmpty()) {
            mediaUri = Uri.parse(rawUri);
        } else if (rawPath != null && !rawPath.trim().isEmpty()) {
            File audioFile = new File(rawPath);
            if (!audioFile.isFile() || !audioFile.canRead()) {
                call.reject("La copia local del audio ya no está disponible. Se intentará usar la copia guardada en la biblioteca.");
                return;
            }
            mediaUri = Uri.fromFile(audioFile);
        } else {
            call.reject("No se recibió una URI o ruta local de audio para reproducir.");
            return;
        }
        String title = call.getString("title");
        String artist = call.getString("artist");
        String album = call.getString("album");
        Long requestedPosition = call.getLong("positionMs");
        Boolean requestedAutoplay = call.getBoolean("autoplay");
        Double requestedSpeed = call.getDouble("speed");
        Double requestedVolume = call.getDouble("volume");
        Boolean requestedEqualizer = call.getBoolean("equalizerEnabled");
        Integer requestedBass = call.getInt("bass");
        Integer requestedMid = call.getInt("mid");
        Integer requestedTreble = call.getInt("treble");
        long positionMs = Math.max(0L, requestedPosition == null ? 0L : requestedPosition);
        float playbackSpeed = (float)Math.max(0.5d, Math.min(2d, requestedSpeed == null ? 1d : requestedSpeed.doubleValue()));
        boolean autoplay = requestedAutoplay == null || requestedAutoplay;
        boolean equalizerEnabled = requestedEqualizer != null && requestedEqualizer;
        int bass = clampEq(requestedBass == null ? 0 : requestedBass);
        int mid = clampEq(requestedMid == null ? 0 : requestedMid);
        int treble = clampEq(requestedTreble == null ? 0 : requestedTreble);
        MediaMetadata metadata = new MediaMetadata.Builder()
            .setTitle(title == null || title.trim().isEmpty() ? "Audio sin título" : title)
            .setArtist(artist == null || artist.trim().isEmpty() ? "Artista desconocido" : artist)
            .setAlbumTitle(album == null ? "" : album)
            .build();
        MediaItem item = new MediaItem.Builder()
            .setMediaId(rawUri == null || rawUri.trim().isEmpty() ? mediaUri.toString() : rawUri)
            .setUri(mediaUri)
            .setMediaMetadata(metadata)
            .build();
        withController(call, controller -> {
            RitmoPlaybackService.configureEqualizer(equalizerEnabled, bass, mid, treble);
            if (requestedVolume != null) controller.setVolume((float)Math.max(0d, Math.min(1d, requestedVolume.doubleValue())));
            controller.setPlaybackParameters(new PlaybackParameters(playbackSpeed));
            controller.setMediaItem(item, positionMs);
            controller.prepare();
            if (autoplay) controller.play();
            else controller.pause();
            call.resolve(playerState(controller));
        });
    }

    @PluginMethod
    public void setEqualizer(PluginCall call) {
        Boolean requestedEnabled = call.getBoolean("enabled");
        Integer requestedBass = call.getInt("bass");
        Integer requestedMid = call.getInt("mid");
        Integer requestedTreble = call.getInt("treble");
        boolean enabled = requestedEnabled != null && requestedEnabled;
        int bass = clampEq(requestedBass == null ? 0 : requestedBass);
        int mid = clampEq(requestedMid == null ? 0 : requestedMid);
        int treble = clampEq(requestedTreble == null ? 0 : requestedTreble);
        withController(call, controller -> {
            RitmoPlaybackService.configureEqualizer(enabled, bass, mid, treble);
            JSObject result = new JSObject();
            result.put("enabled", enabled);
            result.put("supported", RitmoPlaybackService.isNativeEqualizerSupported());
            call.resolve(result);
        });
    }

    private static int clampEq(int value) {
        return Math.max(-12, Math.min(12, value));
    }

    @PluginMethod
    public void pause(PluginCall call) {
        withController(call, controller -> { controller.pause(); call.resolve(playerState(controller)); });
    }

    @PluginMethod
    public void resume(PluginCall call) {
        withController(call, controller -> { controller.play(); call.resolve(playerState(controller)); });
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        Long position = call.getLong("positionMs");
        long target = Math.max(0L, position == null ? 0L : position);
        withController(call, controller -> { controller.seekTo(target); call.resolve(playerState(controller)); });
    }

    @PluginMethod
    public void setPlaybackSpeed(PluginCall call) {
        Double requestedSpeed = call.getDouble("speed");
        float speed = (float)Math.max(0.5d, Math.min(2d, requestedSpeed == null ? 1d : requestedSpeed.doubleValue()));
        withController(call, controller -> {
            controller.setPlaybackParameters(new PlaybackParameters(speed));
            call.resolve(playerState(controller));
        });
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Double volume = call.getDouble("volume");
        float target = (float)Math.max(0d, Math.min(1d, volume == null ? 1d : volume.doubleValue()));
        withController(call, controller -> { controller.setVolume(target); call.resolve(playerState(controller)); });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        withController(call, controller -> call.resolve(playerState(controller)));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        withController(call, controller -> {
            controller.stop();
            controller.clearMediaItems();
            call.resolve(playerState(controller));
        });
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String rawUrl = call.getString("url");
        if (rawUrl == null || rawUrl.trim().isEmpty() || rawUrl.length() > 2048) {
            call.reject("El enlace externo está vacío o es demasiado largo.");
            return;
        }
        final Uri uri;
        try {
            uri = Uri.parse(rawUrl.trim());
        } catch (Exception error) {
            call.reject("No se pudo interpretar el enlace externo.", error);
            return;
        }
        if (!isAllowedExternalMediaUri(uri)) {
            call.reject("Enlace rechazado: Ritmo solo abre búsquedas y videos HTTPS admitidos de YouTube o búsquedas HTTPS de Spotify.");
            return;
        }
        if (getActivity() == null) {
            call.reject("Android no tiene una ventana activa para abrir el enlace.");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            getActivity().startActivity(intent);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (ActivityNotFoundException | SecurityException error) {
            call.reject("No se encontró una aplicación para abrir este enlace. Comprobá que YouTube o un navegador estén instalados.", error);
        }
    }

    private static boolean isAllowedExternalMediaUri(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme()) ||
            uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) {
            return false;
        }
        String host = uri.getHost();
        String path = uri.getPath();
        if (host == null || path == null) return false;
        host = host.toLowerCase(java.util.Locale.ROOT);
        if ("youtube.com".equals(host) || "www.youtube.com".equals(host)) {
            return "/watch".equals(path) || "/results".equals(path);
        }
        if ("open.spotify.com".equals(host)) {
            return "/search".equals(path) || path.startsWith("/search/");
        }
        return false;
    }

    private JSObject playerState(Player player) {
        JSObject result = new JSObject();
        result.put("isPlaying", player.isPlaying());
        result.put("playbackState", playbackStateName(player.getPlaybackState()));
        result.put("positionMs", Math.max(0L, player.getCurrentPosition()));
        long duration = player.getDuration();
        result.put("durationMs", duration > 0L && duration != C.TIME_UNSET ? duration : 0L);
        MediaItem current = player.getCurrentMediaItem();
        result.put("uri", current != null && current.localConfiguration != null
            ? current.localConfiguration.uri.toString() : "");
        if (player.getPlayerError() != null) {
            String message = player.getPlayerError().getMessage();
            result.put("error", message == null ? "Formato incompatible o archivo inaccesible." : message);
        } else result.put("error", "");
        result.put("equalizerEnabled", RitmoPlaybackService.isNativeEqualizerEnabled());
        result.put("equalizerSupported", RitmoPlaybackService.isNativeEqualizerSupported());
        return result;
    }

    private String playbackStateName(int state) {
        if (state == Player.STATE_BUFFERING) return "buffering";
        if (state == Player.STATE_READY) return "ready";
        if (state == Player.STATE_ENDED) return "ended";
        return "idle";
    }
}
