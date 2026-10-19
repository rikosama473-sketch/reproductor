package com.rikosama473.ritmo;

import android.media.audiofx.Equalizer;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

public class RitmoPlaybackService extends MediaSessionService {
    private static volatile RitmoPlaybackService activeInstance;
    private static volatile boolean equalizerRequested;
    private static volatile int requestedBass;
    private static volatile int requestedMid;
    private static volatile int requestedTreble;
    private static volatile boolean equalizerSupported = true;

    private ExoPlayer player;
    private MediaSession mediaSession;
    private Equalizer nativeEqualizer;
    private int currentAudioSessionId = C.AUDIO_SESSION_ID_UNSET;
    private int effectAudioSessionId = C.AUDIO_SESSION_ID_UNSET;

    @Override
    public void onCreate() {
        super.onCreate();
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build();
        player = new ExoPlayer.Builder(this)
            .setAudioAttributes(attributes, true)
            .setHandleAudioBecomingNoisy(true)
            .build();
        activeInstance = this;
        player.addListener(new Player.Listener() {
            @Override
            @UnstableApi
            public void onAudioSessionIdChanged(int audioSessionId) {
                currentAudioSessionId = audioSessionId;
                applyNativeEqualizer();
            }
        });
        mediaSession = new MediaSession.Builder(this, player).build();
    }

    public static void configureEqualizer(boolean enabled, int bass, int mid, int treble) {
        equalizerRequested = enabled;
        requestedBass = clamp(bass);
        requestedMid = clamp(mid);
        requestedTreble = clamp(treble);
        if (!enabled) equalizerSupported = true;
        RitmoPlaybackService service = activeInstance;
        if (service != null) {
            if (enabled) equalizerSupported = true;
            service.applyNativeEqualizer();
        }
    }

    public static boolean isNativeEqualizerEnabled() { return equalizerRequested; }
    public static boolean isNativeEqualizerSupported() { return equalizerSupported; }

    private static int clamp(int value) {
        return Math.max(-12, Math.min(12, value));
    }

    private synchronized void applyNativeEqualizer() {
        if (!equalizerRequested || currentAudioSessionId <= 0) {
            releaseNativeEqualizer();
            return;
        }
        try {
            if (nativeEqualizer == null || effectAudioSessionId != currentAudioSessionId) {
                releaseNativeEqualizer();
                nativeEqualizer = new Equalizer(0, currentAudioSessionId);
                effectAudioSessionId = currentAudioSessionId;
            }
            short[] range = nativeEqualizer.getBandLevelRange();
            short bands = nativeEqualizer.getNumberOfBands();
            if (range == null || range.length < 2 || bands < 1) {
                throw new IllegalStateException("El dispositivo no ofrece bandas de ecualización compatibles.");
            }
            for (short band = 0; band < bands; band++) {
                int centerHz = nativeEqualizer.getCenterFreq(band) / 1000;
                int gainDb = centerHz < 250 ? requestedBass : centerHz < 4000 ? requestedMid : requestedTreble;
                int milliBel = Math.max(range[0], Math.min(range[1], gainDb * 100));
                nativeEqualizer.setBandLevel(band, (short) milliBel);
            }
            nativeEqualizer.setEnabled(true);
            equalizerSupported = true;
        } catch (Exception error) {
            equalizerSupported = false;
            releaseNativeEqualizer();
        }
    }

    private synchronized void releaseNativeEqualizer() {
        if (nativeEqualizer != null) {
            try { nativeEqualizer.setEnabled(false); } catch (Exception ignored) {}
            try { nativeEqualizer.release(); } catch (Exception ignored) {}
        }
        nativeEqualizer = null;
        effectAudioSessionId = C.AUDIO_SESSION_ID_UNSET;
    }

    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    @Override
    public void onDestroy() {
        releaseNativeEqualizer();
        if (activeInstance == this) activeInstance = null;
        // Release the session before its underlying player so controllers receive
        // a clean disconnect while the player is still in a valid lifecycle state.
        if (mediaSession != null) { mediaSession.release(); mediaSession = null; }
        if (player != null) { player.release(); player = null; }
        super.onDestroy();
    }
}
