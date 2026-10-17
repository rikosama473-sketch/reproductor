package com.rikosama473.ritmo;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PluginMethod;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(
    name = "RitmoMusicLibrary",
    permissions = {
        @Permission(alias = "audio", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
        @Permission(alias = "legacyAudio", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class RitmoMusicLibraryPlugin extends Plugin {
    private String audioPermissionAlias() {
        return Build.VERSION.SDK_INT >= 33 ? "audio" : "legacyAudio";
    }

    private boolean hasAudioPermission() {
        return getPermissionState(audioPermissionAlias()) == PermissionState.GRANTED;
    }

    @PluginMethod
    public void requestAudioPermission(PluginCall call) {
        String alias = audioPermissionAlias();
        if (getPermissionState(alias) == PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        requestPermissionForAlias(alias, call, "audioPermissionResult");
    }

    @PermissionCallback
    private void audioPermissionResult(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasAudioPermission());
        call.resolve(result);
    }

    @PluginMethod
    public void listAudio(PluginCall call) {
        if (!hasAudioPermission()) {
            call.reject("Android todavía no concedió permiso para consultar los archivos de audio.");
            return;
        }

        String query = call.getString("query");
        if (query == null) query = "";
        String selection = null;
        String[] selectionArgs = null;
        if (!query.trim().isEmpty()) {
            String pattern = "%" + query.trim() + "%";
            selection = "(" + MediaStore.Audio.Media.TITLE + " LIKE ? OR "
                + MediaStore.Audio.Media.ARTIST + " LIKE ? OR "
                + MediaStore.Audio.Media.DISPLAY_NAME + " LIKE ? OR "
                + MediaStore.Audio.Media.ALBUM + " LIKE ?)";
            selectionArgs = new String[] { pattern, pattern, pattern, pattern };
        }

        String[] projection = {
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.MIME_TYPE,
            MediaStore.Audio.Media.DATE_MODIFIED
        };
        JSArray files = new JSArray();
        ContentResolver resolver = getContext().getContentResolver();
        try (Cursor cursor = resolver.query(
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
            projection, selection, selectionArgs,
            MediaStore.Audio.Media.TITLE + " COLLATE NOCASE ASC"
        )) {
            if (cursor != null) {
                int idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                int titleCol = cursor.getColumnIndex(MediaStore.Audio.Media.TITLE);
                int artistCol = cursor.getColumnIndex(MediaStore.Audio.Media.ARTIST);
                int albumCol = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM);
                int durationCol = cursor.getColumnIndex(MediaStore.Audio.Media.DURATION);
                int sizeCol = cursor.getColumnIndex(MediaStore.Audio.Media.SIZE);
                int nameCol = cursor.getColumnIndex(MediaStore.Audio.Media.DISPLAY_NAME);
                int mimeCol = cursor.getColumnIndex(MediaStore.Audio.Media.MIME_TYPE);
                int modifiedCol = cursor.getColumnIndex(MediaStore.Audio.Media.DATE_MODIFIED);
                while (cursor.moveToNext()) {
                    long mediaId = cursor.getLong(idCol);
                    String name = columnString(cursor, nameCol);
                    if (name == null || name.trim().isEmpty()) name = "audio-" + mediaId;
                    String title = columnString(cursor, titleCol);
                    if (title == null || title.trim().isEmpty()) title = stripExtension(name);
                    String artist = columnString(cursor, artistCol);
                    String album = columnString(cursor, albumCol);
                    String mime = columnString(cursor, mimeCol);
                    Uri uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, mediaId);
                    JSObject item = new JSObject();
                    item.put("id", String.valueOf(mediaId));
                    item.put("uri", uri.toString());
                    item.put("name", name);
                    item.put("title", title);
                    item.put("artist", artist == null || artist.trim().isEmpty() || "<unknown>".equalsIgnoreCase(artist) ? "Artista desconocido" : artist);
                    item.put("album", album == null || "<unknown>".equalsIgnoreCase(album) ? "" : album);
                    item.put("duration", columnLong(cursor, durationCol));
                    item.put("size", columnLong(cursor, sizeCol));
                    item.put("mimeType", mime == null ? guessMimeType(name) : mime);
                    item.put("lastModified", columnLong(cursor, modifiedCol) * 1000L);
                    files.put(item);
                }
            }
            JSObject result = new JSObject();
            result.put("files", files);
            call.resolve(result);
        } catch (SecurityException error) {
            call.reject("Android denegó el acceso a la biblioteca de audio. Autorizá Música y audio en Ajustes.", error);
        } catch (Exception error) {
            call.reject("No se pudo consultar la biblioteca de audio de Android.", error);
        }
    }

    @PluginMethod
    public void pickAudioFiles(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("audio/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "audioPickerResult");
    }

    @ActivityCallback
    private void audioPickerResult(PluginCall call, ActivityResult result) {
        if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject empty = new JSObject();
            empty.put("files", new JSArray());
            empty.put("cancelled", true);
            call.resolve(empty);
            return;
        }

        Intent data = result.getData();
        List<Uri> uris = new ArrayList<>();
        ClipData clip = data.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null) uris.add(uri);
            }
        } else if (data.getData() != null) {
            uris.add(data.getData());
        }

        JSArray files = new JSArray();
        ContentResolver resolver = getContext().getContentResolver();
        for (Uri uri : uris) {
            try {
                resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored) {
                // Some document providers grant temporary access only; resolve/copy immediately.
            }
            files.put(describePickedUri(uri, resolver));
        }
        JSObject response = new JSObject();
        response.put("files", files);
        response.put("cancelled", false);
        call.resolve(response);
    }

    private JSObject describePickedUri(Uri uri, ContentResolver resolver) {
        String name = uri.getLastPathSegment() == null ? "audio" : uri.getLastPathSegment();
        long size = 0;
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (nameColumn >= 0 && cursor.getString(nameColumn) != null) name = cursor.getString(nameColumn);
                if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) size = cursor.getLong(sizeColumn);
            }
        } catch (Exception ignored) {}
        String mime = resolver.getType(uri);
        JSObject file = new JSObject();
        file.put("id", uri.toString());
        file.put("uri", uri.toString());
        file.put("name", name);
        file.put("title", stripExtension(name));
        file.put("artist", "Artista desconocido");
        file.put("album", "");
        file.put("duration", 0);
        file.put("size", size);
        file.put("mimeType", mime == null ? guessMimeType(name) : mime);
        file.put("lastModified", System.currentTimeMillis());
        return file;
    }

    @PluginMethod
    public void resolveAudioPath(PluginCall call) {
        String rawUri = call.getString("uri");
        String name = call.getString("name");
        if (rawUri == null || rawUri.trim().isEmpty()) {
            call.reject("Android no recibió una URI de audio válida.");
            return;
        }
        Uri uri = Uri.parse(rawUri);
        final String filename = name == null || name.trim().isEmpty() ? "audio" : name;
        Thread worker = new Thread(() -> {
            try {
                String path = findReadableFilesystemPath(uri);
                if (path == null) path = copyToPrivateCache(uri, filename);
                JSObject result = new JSObject();
                result.put("path", path);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("No se pudo leer el audio seleccionado. Probá importarlo desde otra carpeta o proveedor.", error);
            }
        }, "RitmoResolveAudio");
        worker.start();
    }

    private String findReadableFilesystemPath(Uri uri) {
        if ("file".equalsIgnoreCase(uri.getScheme())) {
            String path = uri.getPath();
            if (path != null && new File(path).isFile()) return path;
        }
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { MediaStore.MediaColumns.DATA }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(MediaStore.MediaColumns.DATA);
                if (index >= 0 && !cursor.isNull(index)) {
                    String path = cursor.getString(index);
                    if (path != null && new File(path).isFile()) return path;
                }
            }
        } catch (Exception ignored) {
            // Document providers often do not expose a filesystem path; private-cache copy is the fallback.
        }
        return null;
    }

    private String copyToPrivateCache(Uri uri, String originalName) throws Exception {
        File folder = new File(getContext().getCacheDir(), "ritmo-audio");
        if (!folder.exists() && !folder.mkdirs()) throw new IllegalStateException("No se pudo crear la caché de audio.");
        String safeName = originalName.replaceAll("[^A-Za-z0-9._-]", "_");
        if (safeName.isEmpty()) safeName = "audio";
        String key = Integer.toUnsignedString(uri.toString().hashCode());
        File output = new File(folder, key + "-" + safeName);
        if (output.isFile() && output.length() > 0) return output.getAbsolutePath();
        File temporary = new File(folder, key + ".tmp");
        try (InputStream input = getContext().getContentResolver().openInputStream(uri);
             FileOutputStream stream = new FileOutputStream(temporary)) {
            if (input == null) throw new IllegalStateException("El proveedor no pudo abrir el audio.");
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) stream.write(buffer, 0, count);
            stream.getFD().sync();
        } catch (Exception error) {
            temporary.delete();
            throw error;
        }
        if (output.exists() && !output.delete()) {
            temporary.delete();
            throw new IllegalStateException("No se pudo actualizar el archivo temporal de audio.");
        }
        if (!temporary.renameTo(output)) {
            try (FileInputStream input = new FileInputStream(temporary);
                 FileOutputStream stream = new FileOutputStream(output)) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) stream.write(buffer, 0, count);
            } finally {
                temporary.delete();
            }
        }
        return output.getAbsolutePath();
    }

    private static String columnString(Cursor cursor, int column) {
        return column < 0 || cursor.isNull(column) ? null : cursor.getString(column);
    }

    private static long columnLong(Cursor cursor, int column) {
        return column < 0 || cursor.isNull(column) ? 0 : cursor.getLong(column);
    }

    private static String stripExtension(String filename) {
        int lastDot = filename.lastIndexOf('.');
        return lastDot > 0 ? filename.substring(0, lastDot) : filename;
    }

    private static String guessMimeType(String filename) {
        int dot = filename.lastIndexOf('.');
        if (dot >= 0 && dot + 1 < filename.length()) {
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(filename.substring(dot + 1).toLowerCase());
            if (mime != null) return mime;
        }
        return "application/octet-stream";
    }
}
