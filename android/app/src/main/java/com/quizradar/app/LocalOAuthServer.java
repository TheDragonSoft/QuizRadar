package com.quizradar.app;

import android.util.Log;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class LocalOAuthServer {
    private static final String TAG = "LocalOAuthServer";

    public static final String GOOGLE_CLIENT_ID = "341760934836-60toi8rjgkid0gmc69tmt598teghbgv4.apps.googleusercontent.com";
    public static final String GOOGLE_CLIENT_SECRET = "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";
    public static final String MICROSOFT_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";

    /** Pending sign-in expectations recorded via /api/auth/prepare before the
     *  external browser is opened. The callback MUST echo the exact state and
     *  present a code that satisfies the PKCE challenge — this blocks
     *  authorization-code injection / login CSRF against the local listener. */
    private static class PendingAuth {
        final String state;
        final String verifier;
        final long createdAtMs;
        PendingAuth(String state, String verifier) {
            this.state = state;
            this.verifier = verifier;
            this.createdAtMs = System.currentTimeMillis();
        }
        boolean isFresh() {
            return System.currentTimeMillis() - createdAtMs < 15 * 60 * 1000L;
        }
    }

    public interface OAuthListener {
        /** Called as soon as an auth code arrives, so the app can return to the foreground
         *  (Android blocks network access for background apps). */
        void onCodeReceived(String provider);
        /**
         * Called when the web app records a pending sign-in expectation right before
         * the external browser is opened — lets MainActivity hold a foreground
         * keep-alive service so Android won't freeze/kill this process (and with it
         * the loopback listener) while Chrome handles the consent flow.
         */
        default void onPrepare(String provider) {}
        void onGoogleSuccess(JSONObject tokens, JSONObject profile);
        void onMicrosoftSuccess(JSONObject tokens, JSONObject profile);
        void onError(String provider, String error);
    }

    private final int port;
    private final OAuthListener listener;
    /** Two listeners cover the loopback regardless of which address family the
     *  browser resolves for "localhost": some devices prefer ::1 (IPv6) and get
     *  ERR_CONNECTION_REFUSED when only an IPv4 socket exists. */
    private volatile ServerSocket serverSocket4;
    private volatile ServerSocket serverSocket6;
    private volatile boolean isRunning = false;
    private volatile boolean bindSucceeded = false;
    private final CountDownLatch bindLatch = new CountDownLatch(2);
    private final ExecutorService threadPool = Executors.newCachedThreadPool();
    private final ConcurrentHashMap<String, PendingAuth> pendingAuths = new ConcurrentHashMap<>();

    public LocalOAuthServer(int port, OAuthListener listener) {
        this.port = port;
        this.listener = listener;
    }

    public synchronized void start() {
        if (isRunning) return;
        isRunning = true;
        threadPool.execute(() -> bindLoop(true));
        threadPool.execute(() -> bindLoop(false));
    }

    /** Binds one loopback family and serves it until stop(); IPv6 is
     *  best-effort (IPv4 failure alone still leaves sign-in working). */
    private void bindLoop(boolean ipv4) {
        ServerSocket ss = null;
        try {
            ss = new ServerSocket();
            ss.setReuseAddress(true);
            ss.bind(new InetSocketAddress(InetAddress.getByName(ipv4 ? "127.0.0.1" : "::1"), port));
            if (ipv4) serverSocket4 = ss; else serverSocket6 = ss;
            bindSucceeded = true;
            Log.i(TAG, "LocalOAuthServer listening on " + (ipv4 ? "127.0.0.1" : "[::1]") + ":" + port);

            while (isRunning && !ss.isClosed()) {
                try {
                    Socket client = ss.accept();
                    threadPool.execute(() -> handleClient(client));
                } catch (Exception e) {
                    if (!isRunning) break;
                    Log.w(TAG, "Error accepting connection: " + e.getMessage());
                }
            }
        } catch (Exception e) {
            if (ipv4 || !bindSucceeded) {
                Log.e(TAG, "Failed to bind server socket on "
                        + (ipv4 ? "127.0.0.1" : "[::1]") + ":" + port, e);
            }
        } finally {
            bindLatch.countDown();
        }
    }

    /** Blocks until both bind attempts settle so callers can report
     *  real success/failure instead of a fire-and-forget "initialized" log. */
    public boolean awaitStart(long timeoutMillis) {
        try {
            bindLatch.await(timeoutMillis, TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        return bindSucceeded;
    }

    public boolean isBindSucceeded() {
        return bindSucceeded;
    }

    public synchronized void stop() {
        isRunning = false;
        ServerSocket a = serverSocket4, b = serverSocket6;
        if (a != null) {
            try { a.close(); } catch (Exception ignored) {}
        }
        if (b != null) {
            try { b.close(); } catch (Exception ignored) {}
        }
        serverSocket4 = null;
        serverSocket6 = null;
        threadPool.shutdownNow();
    }

    private void handleClient(Socket client) {
        try {
            client.setSoTimeout(10000);
            InputStream is = client.getInputStream();
            BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));

            String requestLine = reader.readLine();
            if (requestLine == null || requestLine.isEmpty()) {
                client.close();
                return;
            }

            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                client.close();
                return;
            }

            String fullUri = parts[1];
            String path = fullUri;
            String queryString = "";
            int qIndex = fullUri.indexOf('?');
            if (qIndex >= 0) {
                path = fullUri.substring(0, qIndex);
                queryString = fullUri.substring(qIndex + 1);
            }

            // Redact query strings (they can carry authorization codes) from logs.
            Log.i(TAG, "Incoming HTTP request: " + path);

            // CORS preflight: the Capacitor WebView runs at origin http://localhost,
            // so its POSTs to the loopback listener are cross-origin. Modern WebView
            // fetches with a JSON content type fire an OPTIONS probe first — if we
            // don't answer it with permissive CORS headers, the JS side can never
            // record the pending PKCE state and sign-in fails before it starts.
            if (requestLine.startsWith("OPTIONS")) {
                sendCorsPreflight(client);
                return;
            }

            // Consume the HTTP headers before reading any body so the two are
            // never conflated; return the declared content length for POSTs.
            int contentLength = consumeHeaders(reader);

            Map<String, String> params = parseQueryParams(queryString);

            if (path.equals("/api/auth/callback")) {
                handleGoogleCallback(client, params);
            } else if (path.equals("/api/auth/microsoft/callback")) {
                handleMicrosoftCallback(client, params);
            } else if (path.equals("/api/auth/prepare")) {
                handlePrepare(client, readBody(reader, Math.min(contentLength, 4096)));
            } else if (path.equals("/api/state")) {
                sendJsonResponse(client, 200, "{\"status\":\"ok\"}");
            } else {
                sendTextResponse(client, 404, "Not Found");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error handling client connection", e);
        } finally {
            try {
                client.close();
            } catch (Exception ignored) {}
        }
    }

    private void handlePrepare(Socket client, String body) {
        try {
            JSONObject json = new JSONObject(body);
            String provider = json.optString("provider", "");
            String state = json.optString("state", "");
            String verifier = json.optString("verifier", "");
            if (provider.isEmpty() || state.isEmpty()) {
                sendJsonResponse(client, 400, "{\"ok\":false}");
                return;
            }
            pendingAuths.put(provider, new PendingAuth(state, verifier));
            sendJsonResponse(client, 200, "{\"ok\":true}");
            if (listener != null) listener.onPrepare(provider);
        } catch (Exception e) {
            sendJsonResponse(client, 400, "{\"ok\":false}");
        }
    }

    /** Reads the header block up to the blank line; returns the declared
     *  Content-Length (0 when absent) so POST bodies can be read exactly. */
    private int consumeHeaders(BufferedReader reader) {
        int length = 0;
        try {
            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                if (line.toLowerCase().startsWith("content-length:")) {
                    try {
                        length = Integer.parseInt(line.substring(line.indexOf(':') + 1).trim());
                    } catch (NumberFormatException ignored) {}
                }
            }
        } catch (Exception ignored) {}
        return length;
    }

    /** Reads exactly `contentLength` characters of the request body. */
    private String readBody(BufferedReader reader, int contentLength) {
        try {
            StringBuilder sb = new StringBuilder();
            int remaining = Math.max(0, contentLength);
            while (remaining > 0) {
                int chunk = reader.read();
                if (chunk < 0) break;
                sb.append((char) chunk);
                remaining--;
            }
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    /** Returns the pending auth for this provider only when the callback's
     *  state parameter matches exactly (single use, 15-minute validity). */
    private PendingAuth consumePendingAuth(String provider, String stateParam) {
        PendingAuth pending = pendingAuths.get(provider);
        if (pending == null || !pending.isFresh() || !pending.state.equals(stateParam)) {
            return null;
        }
        pendingAuths.remove(provider);
        return pending;
    }

    private void handleGoogleCallback(Socket client, Map<String, String> params) {
        String code = params.get("code");
        String error = params.get("error");
        PendingAuth pending = consumePendingAuth("google", params.get("state"));

        if (pending == null) {
            sendHtmlResponse(client, 400, "Sign-In Session Expired",
                    "This sign-in link is invalid or has expired. Please start the sign-in again from the QuizRadar app.", false);
            if (listener != null) listener.onError("google", "state mismatch");
            return;
        }

        if (error != null) {
            String errorDesc = params.get("error_description");
            sendHtmlResponse(client, 400, "Authentication Error", "Google Sign-In was cancelled or rejected: " + (errorDesc != null ? errorDesc : error), false);
            if (listener != null) listener.onError("google", error);
            return;
        }

        if (code == null || code.isEmpty()) {
            sendHtmlResponse(client, 400, "Missing Code", "No authorization code was received from Google.", false);
            if (listener != null) listener.onError("google", "Missing code parameter");
            return;
        }

        // Hand control back to the app immediately (neutral page — the token
        // exchange still has to succeed before we claim victory).
        if (listener != null) listener.onCodeReceived("google");
        sendHtmlResponse(client, 200, "Completing Sign-In", "Returning to QuizRadar to finish signing you in...", true);

        // Exchange code asynchronously (with PKCE verifier + client secret)
        threadPool.execute(() -> {
            try {
                Log.i(TAG, "Exchanging Google authorization code for tokens...");
                String postData = "client_id=" + URLEncoder.encode(GOOGLE_CLIENT_ID, "UTF-8")
                        + "&client_secret=" + URLEncoder.encode(GOOGLE_CLIENT_SECRET, "UTF-8")
                        + "&code=" + URLEncoder.encode(code, "UTF-8")
                        + "&code_verifier=" + URLEncoder.encode(pending.verifier, "UTF-8")
                        + "&redirect_uri=" + URLEncoder.encode("http://localhost:3000/api/auth/callback", "UTF-8")
                        + "&grant_type=authorization_code";

                JSONObject tokenJson = postForm("https://oauth2.googleapis.com/token", postData);
                String accessToken = tokenJson.optString("access_token");
                if (accessToken.isEmpty()) {
                    throw new Exception("No access token in Google response (HTTP body withheld)");
                }

                JSONObject profileJson = getJson("https://www.googleapis.com/oauth2/v2/userinfo", accessToken);
                Log.i(TAG, "Google profile loaded");

                if (listener != null) {
                    listener.onGoogleSuccess(tokenJson, profileJson);
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to exchange Google OAuth code", e);
                if (listener != null) {
                    listener.onError("google", e.getMessage());
                }
            }
        });
    }

    private void handleMicrosoftCallback(Socket client, Map<String, String> params) {
        String code = params.get("code");
        String error = params.get("error");
        PendingAuth pending = consumePendingAuth("microsoft", params.get("state"));

        if (pending == null) {
            sendHtmlResponse(client, 400, "Sign-In Session Expired",
                    "This sign-in link is invalid or has expired. Please start the sign-in again from the QuizRadar app.", false);
            if (listener != null) listener.onError("microsoft", "state mismatch");
            return;
        }

        if (error != null) {
            String errorDesc = params.get("error_description");
            sendHtmlResponse(client, 400, "Authentication Error", "Microsoft Sign-In was cancelled or rejected: " + (errorDesc != null ? errorDesc : error), false);
            if (listener != null) listener.onError("microsoft", error);
            return;
        }

        if (code == null || code.isEmpty()) {
            sendHtmlResponse(client, 400, "Missing Code", "No authorization code received from Microsoft.", false);
            if (listener != null) listener.onError("microsoft", "Missing code parameter");
            return;
        }

        // Hand control back to the app immediately (neutral page — the token
        // exchange still has to succeed before we claim victory).
        if (listener != null) listener.onCodeReceived("microsoft");
        sendHtmlResponse(client, 200, "Completing Sign-In", "Returning to QuizRadar to finish signing you in...", true);

        // Exchange code asynchronously (public client + PKCE)
        threadPool.execute(() -> {
            try {
                Log.i(TAG, "Exchanging Microsoft authorization code for tokens...");
                String postData = "client_id=" + URLEncoder.encode(MICROSOFT_CLIENT_ID, "UTF-8")
                        + "&code=" + URLEncoder.encode(code, "UTF-8")
                        + "&code_verifier=" + URLEncoder.encode(pending.verifier, "UTF-8")
                        + "&redirect_uri=" + URLEncoder.encode("http://localhost:3000/api/auth/microsoft/callback", "UTF-8")
                        + "&grant_type=authorization_code"
                        + "&scope=" + URLEncoder.encode("offline_access User.Read Mail.Read Calendars.Read", "UTF-8");

                JSONObject tokenJson = postForm("https://login.microsoftonline.com/common/oauth2/v2.0/token", postData);
                String accessToken = tokenJson.optString("access_token");
                if (accessToken.isEmpty()) {
                    throw new Exception("No access token in Microsoft response (HTTP body withheld)");
                }

                JSONObject profileJson = getJson("https://graph.microsoft.com/v1.0/me", accessToken);
                Log.i(TAG, "Microsoft profile loaded");

                if (listener != null) {
                    listener.onMicrosoftSuccess(tokenJson, profileJson);
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to exchange Microsoft OAuth code", e);
                if (listener != null) {
                    listener.onError("microsoft", e.getMessage());
                }
            }
        });
    }

    /** Retries while the OS unblocks networking after the app returns to the foreground. */
    private JSONObject postForm(String endpoint, String body) throws Exception {
        Exception last = null;
        for (int attempt = 0; attempt < 15; attempt++) {
            try {
                return postFormOnce(endpoint, body);
            } catch (java.io.IOException e) {
                last = e;
                Log.w(TAG, "Network not ready (attempt " + (attempt + 1) + ")");
                Thread.sleep(1000);
            }
        }
        throw last;
    }

    private JSONObject postFormOnce(String endpoint, String body) throws Exception {
        URL url = new URL(endpoint);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        conn.setRequestProperty("Accept", "application/json");
        conn.setDoOutput(true);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);

        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        try (OutputStream os = conn.getOutputStream()) {
            os.write(bytes);
            os.flush();
        }

        int code = conn.getResponseCode();
        InputStream is = (code >= 200 && code < 400) ? conn.getInputStream() : conn.getErrorStream();
        String resp = readStream(is);
        if (code >= 400) {
            // Never embed raw token-endpoint bodies in exceptions: they can
            // carry PII and end up in logcat.
            throw new Exception("Token endpoint returned HTTP " + code);
        }
        return new JSONObject(resp);
    }

    private JSONObject getJson(String endpoint, String bearerToken) throws Exception {
        URL url = new URL(endpoint);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Authorization", "Bearer " + bearerToken);
        conn.setRequestProperty("Accept", "application/json");
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);

        int code = conn.getResponseCode();
        InputStream is = (code >= 200 && code < 400) ? conn.getInputStream() : conn.getErrorStream();
        String resp = readStream(is);
        if (code >= 400) {
            throw new Exception("Profile endpoint returned HTTP " + code);
        }
        return new JSONObject(resp);
    }

    private String readStream(InputStream is) throws Exception {
        if (is == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                sb.append(line).append("\n");
            }
        }
        return sb.toString().trim();
    }

    private void sendHtmlResponse(Socket client, int statusCode, String title, String message, boolean isSuccess) {
        try {
            String statusText = (statusCode == 200) ? "OK" : "Bad Request";
            String accentColor = isSuccess ? "#10b981" : "#ef4444";
            String icon = isSuccess ? "&#10003;" : "&#10005;";

            // Return-to-app strategy (most -> least reliable):
            // 1. intent:// URI with explicit package — Chrome always resolves it
            //    to our app (a bare custom scheme via JS is frequently blocked
            //    with ERR_UNKNOWN_URL_SCHEME, which stranded users on this page).
            // 2. Visible anchor with the same intent:// for a manual tap.
            // 3. window.close() — in Custom Tabs this dismisses back to the app.
            String html = "<!DOCTYPE html>\n"
                    + "<html>\n"
                    + "<head>\n"
                    + "  <meta charset=\"utf-8\">\n"
                    + "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0\">\n"
                    + "  <title>" + title + "</title>\n"
                    + "  <style>\n"
                    + "    * { box-sizing: border-box; margin: 0; padding: 0; }\n"
                    + "    body { background-color: #0b0f19; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; text-align: center; }\n"
                    + "    .card { background: #131b2e; border: 1px solid #1e293b; border-radius: 24px; padding: 36px 28px; max-width: 380px; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }\n"
                    + "    .icon { width: 68px; height: 68px; border-radius: 50%; background: " + accentColor + "; color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 34px; font-weight: 700; margin: 0 auto 20px; box-shadow: 0 10px 25px " + accentColor + "55; }\n"
                    + "    h1 { font-size: 20px; font-weight: 800; margin-bottom: 10px; color: #ffffff; }\n"
                    + "    p { font-size: 13px; line-height: 1.6; color: #94a3b8; margin-bottom: 28px; }\n"
                    + "    .btn { display: inline-flex; align-items: center; justify-content: center; width: 100%; padding: 14px 20px; border-radius: 14px; background: #1a73e8; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; transition: all 0.2s; box-shadow: 0 4px 15px rgba(26,115,232,0.4); }\n"
                    + "    .btn:active { transform: scale(0.98); opacity: 0.9; }\n"
                    + "  </style>\n"
                    + "</head>\n"
                    + "<body>\n"
                    + "  <div class=\"card\">\n"
                    + "    <div class=\"icon\">" + icon + "</div>\n"
                    + "    <h1>" + title + "</h1>\n"
                    + "    <p>" + message + "</p>\n"
                    + "    <a id=\"return-link\" class=\"btn\" href=\"intent://oauth-done#Intent;scheme=com.quizradar.app;package=com.quizradar.app;end\">Tap to Return to QuizRadar</a>\n"
                    + "  </div>\n"
                    + "  <script>\n"
                    + "    (function() {\n"
                    + "      var returned = false;\n"
                    + "      function goBack() {\n"
                    + "        if (returned) return;\n"
                    + "        returned = true;\n"
                    + "        var link = document.getElementById('return-link');\n"
                    + "        if (link) { link.click(); }\n"
                    + "        setTimeout(function() { try { window.close(); } catch (e) {} }, 1200);\n"
                    + "      }\n"
                    + "      setTimeout(goBack, 250);\n"
                    + "    })();\n"
                    + "  </script>\n"
                    + "</body>\n"
                    + "</html>\n";

            byte[] body = html.getBytes(StandardCharsets.UTF_8);
            String response = "HTTP/1.1 " + statusCode + " " + statusText + "\r\n"
                    + "Content-Type: text/html; charset=utf-8\r\n"
                    + "Content-Length: " + body.length + "\r\n"
                    + "Connection: close\r\n\r\n";

            OutputStream os = client.getOutputStream();
            os.write(response.getBytes(StandardCharsets.UTF_8));
            os.write(body);
            os.flush();
        } catch (Exception e) {
            Log.e(TAG, "Error sending HTML response", e);
        }
    }

    private void sendJsonResponse(Socket client, int statusCode, String json) {
        try {
            byte[] body = json.getBytes(StandardCharsets.UTF_8);
            String response = "HTTP/1.1 " + statusCode + " " + statusReason(statusCode) + "\r\n"
                    + "Content-Type: application/json; charset=utf-8\r\n"
                    + "Content-Length: " + body.length + "\r\n"
                    + "Access-Control-Allow-Origin: http://localhost\r\n"
                    + "Connection: close\r\n\r\n";
            OutputStream os = client.getOutputStream();
            os.write(response.getBytes(StandardCharsets.UTF_8));
            os.write(body);
            os.flush();
        } catch (Exception ignored) {}
    }

    private void sendTextResponse(Socket client, int statusCode, String text) {
        try {
            byte[] body = text.getBytes(StandardCharsets.UTF_8);
            String response = "HTTP/1.1 " + statusCode + " " + statusReason(statusCode) + "\r\n"
                    + "Content-Type: text/plain; charset=utf-8\r\n"
                    + "Content-Length: " + body.length + "\r\n"
                    + "Connection: close\r\n\r\n";
            OutputStream os = client.getOutputStream();
            os.write(response.getBytes(StandardCharsets.UTF_8));
            os.write(body);
            os.flush();
        } catch (Exception ignored) {}
    }

    /** CORS preflight answer for the WebView origin (http://localhost). */
    private void sendCorsPreflight(Socket client) {
        try {
            String response = "HTTP/1.1 204 No Content\r\n"
                    + "Access-Control-Allow-Origin: http://localhost\r\n"
                    + "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                    + "Access-Control-Allow-Headers: Content-Type, Authorization\r\n"
                    + "Access-Control-Max-Age: 600\r\n"
                    + "Connection: close\r\n\r\n";
            OutputStream os = client.getOutputStream();
            os.write(response.getBytes(StandardCharsets.UTF_8));
            os.flush();
        } catch (Exception ignored) {}
    }

    private static String statusReason(int statusCode) {
        switch (statusCode) {
            case 200: return "OK";
            case 400: return "Bad Request";
            case 404: return "Not Found";
            default: return "Error";
        }
    }

    private static Map<String, String> parseQueryParams(String query) {
        Map<String, String> params = new HashMap<>();
        if (query == null || query.isEmpty()) return params;
        for (String pair : query.split("&")) {
            int idx = pair.indexOf('=');
            try {
                if (idx > 0) {
                    String key = URLDecoder.decode(pair.substring(0, idx), "UTF-8");
                    String val = URLDecoder.decode(pair.substring(idx + 1), "UTF-8");
                    params.put(key, val);
                } else if (!pair.isEmpty()) {
                    params.put(URLDecoder.decode(pair, "UTF-8"), "");
                }
            } catch (Exception ignored) {}
        }
        return params;
    }
}
