package com.rikosama473.ritmo;

import android.Manifest;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.media.MediaMetadataRetriever;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import android.util.Base64;

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
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(
    name = "RitmoMusicLibrary",
    permissions = {
        @Permission(alias = "audio", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
        @Permission(alias = "legacyAudio", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class RitmoMusicLibraryPlugin extends Plugin {
    private static final int MAX_MEDIASTORE_RESULTS = 10000;
    private static final int MAX_TREE_FOLDERS_DISCOVERED = 50000;
    private static final int MAX_TREE_DOCUMENTS_SCANNED = 100000;
    // Leave room for the 64-character SHA-256 key and separator in the cache filename.
    private static final int MAX_AUDIO_CACHE_NAME_CHARS = 120;
    private static final int MAX_ARTWORK_RAW_BYTES = 8 * 1024 * 1024;
    private static final int MAX_ARTWORK_OUTPUT_BYTES = 512 * 1024;
    private static final int MAX_ARTWORK_DIMENSION = 4096;
    private static final long MAX_ARTWORK_PIXELS = 8_388_608L;
    private static final int MAX_ARTWORK_DECODE_DIMENSION = 1024;
    private static final long MAX_ARTWORK_DECODE_PIXELS = 1_048_576L;
    private static final long AUDIO_CACHE_ORPHAN_GRACE_MS = 60L * 60L * 1000L;

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
        boolean truncated = false;
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
                    if (files.length() >= MAX_MEDIASTORE_RESULTS) {
                        truncated = true;
                        break;
                    }
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
            result.put("truncated", truncated);
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
            boolean persisted = false;
            try {
                resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                persisted = true;
            } catch (Exception ignored) {
                // Some document providers grant temporary access only; resolve/copy immediately.
            }
            JSObject file = describePickedUri(uri, resolver);
            file.put("persisted", persisted);
            files.put(file);
        }
        JSObject response = new JSObject();
        response.put("files", files);
        response.put("cancelled", false);
        call.resolve(response);
    }

    private static String safeMimeType(ContentResolver resolver, Uri uri, String filename) {
        String mime = null;
        try {
            mime = resolver.getType(uri);
        } catch (Exception ignored) {
            // Some document providers throw while describing a readable URI.
            // Keep the import alive and infer a useful type from the filename.
        }
        return mime == null || mime.trim().isEmpty() ? guessMimeType(filename) : mime;
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
        String mime = safeMimeType(resolver, uri, name);
        JSObject file = new JSObject();
        file.put("id", uri.toString());
        file.put("uri", uri.toString());
        file.put("name", name);
        file.put("title", stripExtension(name));
        file.put("artist", "Artista desconocido");
        file.put("album", "");
        file.put("duration", 0);
        file.put("size", size);
        file.put("mimeType", mime);
        file.put("lastModified", System.currentTimeMillis());
        return file;
    }

    @PluginMethod
    public void pickAudioFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "audioFolderPickerResult");
    }

    @ActivityCallback
    private void audioFolderPickerResult(PluginCall call, ActivityResult result) {
        if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject empty = new JSObject();
            empty.put("treeUri", "");
            empty.put("cancelled", true);
            call.resolve(empty);
            return;
        }
        Uri treeUri = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception error) {
            call.reject("Android no permitió conservar el acceso a esa carpeta. Elegí otra ubicación.", error);
            return;
        }
        JSObject response = new JSObject();
        response.put("treeUri", treeUri.toString());
        response.put("cancelled", false);
        call.resolve(response);
    }

    @PluginMethod
    public void listAudioFromTree(PluginCall call) {
        String rawTreeUri = call.getString("treeUri");
        if (rawTreeUri == null || rawTreeUri.trim().isEmpty()) {
            call.reject("No se recibió una carpeta de música válida.");
            return;
        }
        Uri treeUri = Uri.parse(rawTreeUri);
        JSArray files = new JSArray();
        Set<String> visited = new HashSet<>();
        ArrayDeque<TreeFolder> pending = new ArrayDeque<>();
        try {
            String rootDocumentId = DocumentsContract.getTreeDocumentId(treeUri);
            pending.push(new TreeFolder(rootDocumentId, 0));
            visited.add(rootDocumentId);
            ContentResolver resolver = getContext().getContentResolver();
            String[] projection = {
                Document.COLUMN_DOCUMENT_ID,
                Document.COLUMN_DISPLAY_NAME,
                Document.COLUMN_MIME_TYPE,
                Document.COLUMN_SIZE,
                Document.COLUMN_LAST_MODIFIED
            };
            int foldersVisited = 0;
            int documentsScanned = 0;
            boolean folderDiscoveryTruncated = false;
            boolean depthLimitReached = false;
            while (!pending.isEmpty() && files.length() < 10000 &&
                   foldersVisited < MAX_TREE_FOLDERS_DISCOVERED &&
                   documentsScanned < MAX_TREE_DOCUMENTS_SCANNED) {
                TreeFolder folder = pending.pop();
                foldersVisited++;
                if (folder.depth > 32) {
                    depthLimitReached = true;
                    continue;
                }
                Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, folder.documentId);
                try (Cursor cursor = queryTreeChildren(resolver, childrenUri, projection)) {
                    if (cursor == null) continue;
                    int idColumn = cursor.getColumnIndex(Document.COLUMN_DOCUMENT_ID);
                    int nameColumn = cursor.getColumnIndex(Document.COLUMN_DISPLAY_NAME);
                    int mimeColumn = cursor.getColumnIndex(Document.COLUMN_MIME_TYPE);
                    int sizeColumn = cursor.getColumnIndex(Document.COLUMN_SIZE);
                    int modifiedColumn = cursor.getColumnIndex(Document.COLUMN_LAST_MODIFIED);
                    while (cursor.moveToNext() && files.length() < 10000 &&
                           documentsScanned < MAX_TREE_DOCUMENTS_SCANNED) {
                        documentsScanned++;
                        String docId = columnString(cursor, idColumn);
                        String name = columnString(cursor, nameColumn);
                        String mime = columnString(cursor, mimeColumn);
                        if (docId == null || docId.trim().isEmpty()) continue;
                        if (Document.MIME_TYPE_DIR.equals(mime)) {
                            if (!visited.contains(docId)) {
                                if (visited.size() >= MAX_TREE_FOLDERS_DISCOVERED) {
                                    folderDiscoveryTruncated = true;
                                    continue;
                                }
                                visited.add(docId);
                                pending.push(new TreeFolder(docId, folder.depth + 1));
                            }
                            continue;
                        }
                        if (!isAudioFile(name, mime)) continue;
                        Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
                        JSObject item = new JSObject();
                        item.put("id", documentUri.toString());
                        item.put("uri", documentUri.toString());
                        item.put("name", name == null || name.trim().isEmpty() ? "audio" : name);
                        item.put("title", stripExtension(name == null ? "audio" : name));
                        item.put("artist", "Artista desconocido");
                        item.put("album", "");
                        item.put("duration", 0);
                        item.put("size", columnLong(cursor, sizeColumn));
                        item.put("mimeType", mime == null ? guessMimeType(name == null ? "" : name) : mime);
                        item.put("lastModified", columnLong(cursor, modifiedColumn));
                        files.put(item);
                    }
                }
            }
            JSObject response = new JSObject();
            response.put("files", files);
            response.put("treeUri", treeUri.toString());
            response.put("truncated", !pending.isEmpty() || files.length() >= 10000 || foldersVisited >= MAX_TREE_FOLDERS_DISCOVERED || documentsScanned >= MAX_TREE_DOCUMENTS_SCANNED || folderDiscoveryTruncated || depthLimitReached);
            call.resolve(response);
        } catch (SecurityException error) {
            call.reject("Android no permitió leer la carpeta. Volvé a elegirla y concedé acceso.", error);
        } catch (Exception error) {
            call.reject("No se pudo explorar la carpeta de música seleccionada.", error);
        }
    }

    /**
     * Document providers vary: some reject sortOrder, and some reject optional
     * columns such as COLUMN_LAST_MODIFIED. Retry with fewer assumptions.
     */
    private Cursor queryTreeChildren(ContentResolver resolver, Uri childrenUri, String[] projection) {
        String sortOrder = Document.COLUMN_DISPLAY_NAME + " COLLATE NOCASE ASC";
        try {
            Cursor cursor = resolver.query(childrenUri, projection, null, null, sortOrder);
            if (cursor != null) return cursor;
        } catch (RuntimeException ignored) {
            // Retry without sort order.
        }
        try {
            Cursor cursor = resolver.query(childrenUri, projection, null, null, null);
            if (cursor != null) return cursor;
        } catch (RuntimeException ignored) {
            // Retry without optional metadata columns.
        }
        String[] minimumProjection = {
            Document.COLUMN_DOCUMENT_ID,
            Document.COLUMN_DISPLAY_NAME,
            Document.COLUMN_MIME_TYPE
        };
        return resolver.query(childrenUri, minimumProjection, null, null, null);
    }

    private static boolean isAudioFile(String filename, String mime) {
        if (mime != null && mime.toLowerCase().startsWith("audio/")) return true;
        if (filename == null) return false;
        return filename.matches("(?i).+\\.(mp3|m4a|mp4|aac|wav|wave|ogg|oga|opus|webm|flac|aiff|aif|alac|wma|ape|mp2|mid|midi|caf|3gp|amr)$");
    }

    private static final class TreeFolder {
        final String documentId;
        final int depth;
        TreeFolder(String documentId, int depth) {
            this.documentId = documentId;
            this.depth = depth;
        }
    }

    @PluginMethod
    public void pruneAudioCache(PluginCall call) {
        final JSArray rawKeepPaths = call.getArray("keepPaths");
        Thread worker = new Thread(() -> {
            JSObject result = new JSObject();
            try {
                synchronized (RitmoMusicLibraryPlugin.this) {
                    Set<String> keepPaths = new HashSet<>();
                    if (rawKeepPaths != null) {
                        for (int i = 0; i < rawKeepPaths.length(); i++) {
                            try {
                                String rawPath = rawKeepPaths.optString(i, "");
                                if (rawPath != null && !rawPath.trim().isEmpty()) {
                                    keepPaths.add(new File(rawPath).getCanonicalPath());
                                }
                            } catch (Exception ignored) {
                                // Ignore malformed paths; only files inside the managed cache can be deleted.
                            }
                        }
                    }

                    File folder = new File(getContext().getCacheDir(), "ritmo-audio").getCanonicalFile();
                    int deleted = 0;
                    int failed = 0;
                    int skippedRecent = 0;
                    if (folder.isDirectory()) {
                        File[] entries = folder.listFiles();
                        long cutoff = System.currentTimeMillis() - AUDIO_CACHE_ORPHAN_GRACE_MS;
                        if (entries != null) {
                            for (File entry : entries) {
                                File candidate = entry.getCanonicalFile();
                                // Never follow a symlink or delete a file outside Ritmo's audio cache.
                                if (!candidate.isFile() || candidate.getParentFile() == null ||
                                    !candidate.getParentFile().equals(folder)) continue;
                                if (keepPaths.contains(candidate.getPath())) continue;
                                // Protect audio resolved/imported in the last hour from import/cleanup races.
                                if (candidate.lastModified() >= cutoff) {
                                    skippedRecent++;
                                    continue;
                                }
                                if (candidate.delete()) deleted++;
                                else failed++;
                            }
                        }
                    }

                    result.put("deleted", deleted);
                    result.put("failed", failed);
                    result.put("skippedRecent", skippedRecent);
                }
                call.resolve(result);
            } catch (Exception error) {
                call.reject("No se pudo limpiar la caché local de audio.", error);
            }
        }, "RitmoPruneAudioCache");
        worker.start();
    }

    @PluginMethod
    public void getEmbeddedArtwork(PluginCall call) {
        String rawUri = call.getString("uri");
        String rawPath = call.getString("path");
        final Uri sourceUri;
        try {
            if (rawUri != null && !rawUri.trim().isEmpty()) {
                sourceUri = Uri.parse(rawUri.trim());
            } else if (rawPath != null && !rawPath.trim().isEmpty()) {
                sourceUri = Uri.fromFile(new File(rawPath.trim()));
            } else {
                call.reject("Android no recibió una URI o ruta para leer la portada.");
                return;
            }
            if (sourceUri.getUserInfo() != null) {
                call.reject("La URI de la portada no es válida.");
                return;
            }
        } catch (Exception error) {
            call.reject("No se pudo interpretar la URI de la portada.", error);
            return;
        }

        Thread worker = new Thread(() -> {
            MediaMetadataRetriever retriever = new MediaMetadataRetriever();
            try {
                retriever.setDataSource(getContext(), sourceUri);
                byte[] embedded = retriever.getEmbeddedPicture();
                byte[] cover = normalizeEmbeddedArtwork(embedded);
                JSObject result = new JSObject();
                result.put("found", cover != null);
                if (cover != null) {
                    result.put("mimeType", "image/jpeg");
                    result.put("base64", Base64.encodeToString(cover, Base64.NO_WRAP));
                }
                call.resolve(result);
            } catch (Exception error) {
                call.reject("No se pudo leer la portada incrustada del audio.", error);
            } finally {
                try { retriever.release(); } catch (Exception ignored) {}
            }
        }, "RitmoReadEmbeddedArtwork");
        worker.start();
    }

    private static byte[] normalizeEmbeddedArtwork(byte[] encoded) {
        if (encoded == null || encoded.length < 8 || encoded.length > MAX_ARTWORK_RAW_BYTES) return null;
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try {
            BitmapFactory.decodeByteArray(encoded, 0, encoded.length, bounds);
        } catch (RuntimeException error) {
            return null;
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 ||
            bounds.outWidth > MAX_ARTWORK_DIMENSION || bounds.outHeight > MAX_ARTWORK_DIMENSION ||
            (long) bounds.outWidth * (long) bounds.outHeight > MAX_ARTWORK_PIXELS) return null;

        int sampleSize = 1;
        while ((bounds.outWidth + sampleSize - 1) / sampleSize > MAX_ARTWORK_DECODE_DIMENSION ||
               (bounds.outHeight + sampleSize - 1) / sampleSize > MAX_ARTWORK_DECODE_DIMENSION ||
               ((long) (bounds.outWidth + sampleSize - 1) / sampleSize) *
                   ((long) (bounds.outHeight + sampleSize - 1) / sampleSize) > MAX_ARTWORK_DECODE_PIXELS) {
            sampleSize *= 2;
        }

        BitmapFactory.Options decode = new BitmapFactory.Options();
        decode.inSampleSize = sampleSize;
        decode.inPreferredConfig = Bitmap.Config.RGB_565;
        Bitmap bitmap;
        try {
            bitmap = BitmapFactory.decodeByteArray(encoded, 0, encoded.length, decode);
        } catch (RuntimeException error) {
            return null;
        }
        if (bitmap == null) return null;
        try {
            for (int quality = 85; quality >= 45; quality -= 10) {
                ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(encoded.length, MAX_ARTWORK_OUTPUT_BYTES));
                if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)) return null;
                byte[] result = output.toByteArray();
                if (result.length <= MAX_ARTWORK_OUTPUT_BYTES) return result;
            }
            return null;
        } catch (RuntimeException error) {
            return null;
        } finally {
            bitmap.recycle();
        }
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
        final boolean forceRefresh = Boolean.TRUE.equals(call.getBoolean("forceRefresh"));
        Thread worker = new Thread(() -> {
            try {
                String path = findReadableFilesystemPath(uri);
                if (path == null) path = copyToPrivateCache(uri, filename, forceRefresh);
                JSObject result = new JSObject();
                result.put("path", path);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("No se pudo leer el audio seleccionado. Probá importarlo desde otra carpeta o proveedor.", error);
            }
        }, "RitmoResolveAudio");
        worker.start();
    }

    private static String readableFilesystemPath(String path) {
        if (path == null || path.trim().isEmpty()) return null;
        File candidate = new File(path);
        return candidate.isFile() && candidate.canRead() ? path : null;
    }

    private String findReadableFilesystemPath(Uri uri) {
        if ("file".equalsIgnoreCase(uri.getScheme())) {
            String path = readableFilesystemPath(uri.getPath());
            if (path != null) return path;
        }
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { MediaStore.MediaColumns.DATA }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(MediaStore.MediaColumns.DATA);
                if (index >= 0 && !cursor.isNull(index)) {
                    String path = readableFilesystemPath(cursor.getString(index));
                    if (path != null) return path;
                }
            }
        } catch (Exception ignored) {
            // Document providers often do not expose a filesystem path; private-cache copy is the fallback.
        }
        return null;
    }

    private synchronized String copyToPrivateCache(Uri uri, String originalName, boolean forceRefresh) throws Exception {
        File folder = new File(getContext().getCacheDir(), "ritmo-audio");
        if (!folder.exists() && !folder.mkdirs()) throw new IllegalStateException("No se pudo crear la caché de audio.");
        String safeName = originalName.replaceAll("[^A-Za-z0-9._-]", "_");
        if (safeName.isEmpty()) safeName = "audio";
        if (safeName.length() > MAX_AUDIO_CACHE_NAME_CHARS) {
            safeName = safeName.substring(0, MAX_AUDIO_CACHE_NAME_CHARS);
        }
        String key = sha256Hex(uri.toString());
        File output = new File(folder, key + "-" + safeName);
        if (!forceRefresh && output.isFile() && output.length() > 0) {
            // Ordinary resolutions may reuse a complete cache entry. Playback fallback
            // can force a refresh because the provider may have changed the same URI.
            output.setLastModified(System.currentTimeMillis());
            return output.getAbsolutePath();
        }
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
            // Never stream directly into the final cache path: a failed copy could leave a
            // non-empty partial file that the fast-path above would incorrectly reuse.
            File staged = new File(folder, key + ".copying");
            try {
                if (staged.exists() && !staged.delete()) {
                    throw new IllegalStateException("No se pudo limpiar una copia temporal de audio anterior.");
                }
                try (FileInputStream input = new FileInputStream(temporary);
                     FileOutputStream stream = new FileOutputStream(staged)) {
                    byte[] buffer = new byte[64 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) stream.write(buffer, 0, count);
                    stream.getFD().sync();
                }
                if (!staged.renameTo(output)) {
                    throw new IllegalStateException("No se pudo finalizar la copia temporal de audio.");
                }
            } catch (Exception error) {
                if (staged.exists() && !staged.delete()) {
                    error.addSuppressed(new IllegalStateException("No se pudo eliminar la copia incompleta de audio."));
                }
                throw error;
            } finally {
                temporary.delete();
            }
        }
        return output.getAbsolutePath();
    }

    private static String sha256Hex(String value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        char[] hex = "0123456789abcdef".toCharArray();
        char[] output = new char[digest.length * 2];
        for (int i = 0; i < digest.length; i++) {
            int current = digest[i] & 0xff;
            output[i * 2] = hex[current >>> 4];
            output[i * 2 + 1] = hex[current & 0x0f];
        }
        return new String(output);
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
