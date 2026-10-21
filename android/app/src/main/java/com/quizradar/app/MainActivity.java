package com.quizradar.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;
import org.json.JSONTokener;

public class MainActivity extends BridgeActivity implements LocalOAuthServer.OAuthListener {
    private static final String TAG = "MainActivity";

    // Widget snapshot prefs (same file/key contract as QuizRadarWidgetProvider).
    private static final String WIDGET_PREFS_FILE = "quizradar_widget_prefs";
    private static final String WIDGET_KEY_SNAPSHOT = "next_snapshot_json";
    private static final String WIDGET_KEY_LAST_PUSH = "last_widget_push";
    private static final long WIDGET_PUSH_MIN_INTERVAL_MS = 60_000L;

    // Refresh-token storage (private to the app; never exposed to the WebView —
    // the JS side only receives short-lived access tokens via the bridge).
    private static final String OAUTH_TOKEN_PREFS = "quizradar_oauth_tokens";

    private LocalOAuthServer oauthServer;
    private volatile boolean oauthKeepAlive = false;
    // FEATURE A: share-sheet intent received before the WebView is ready.
    private Intent pendingSendIntent;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // If the app was cold-started from a share sheet, stash the intent —
        // the bridge/WebView do not exist until super.onCreate() finishes, so
        // delivery is deferred to onResume().
        Intent launchIntent = getIntent();
        if (launchIntent != null && Intent.ACTION_SEND.equals(launchIntent.getAction())) {
            pendingSendIntent = launchIntent;
        }
        try {
            oauthServer = new LocalOAuthServer(3000, this);
            oauthServer.regenerateBridgeNonce();
            oauthServer.setOAuthRefreshHandler(this::handleBridgeRefresh);
            oauthServer.start();
            if (oauthServer.awaitStart(1500)) {
                Log.i(TAG, "Local OAuth server listening on 127.0.0.1:3000");
            } else {
                Log.e(TAG, "Local OAuth server failed to bind port 3000 — Google/Microsoft sign-in will not work this session");
            }
            // Late re-injection: the first onResume() can fire before the
            // WebView's page context exists, so the key would be lost. One
            // delayed injection covers the cold-start while the early one in
            // onResume() covers warm resumes.
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(this::injectBridgeKey, 2500);
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize LocalOAuthServer", e);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        injectBridgeKey();
        if (pendingSendIntent != null) {
            Intent send = pendingSendIntent;
            pendingSendIntent = null;
            trySendToWebApp(send);
        }
        refreshWidgetSnapshot(false);
    }

    /** Hands the per-session bridge secret to the web app so the engine can
     *  use the token-refresh endpoint. The key lives only in the page's JS
     *  memory (never localStorage) and is rebuilt on every process start. */
    private void injectBridgeKey() {
        try {
            if (oauthServer == null || getBridge() == null || getBridge().getWebView() == null) return;
            String key = oauthServer.getBridgeNonce();
            if (key == null || key.isEmpty()) return;
            String js = "window.__quizradarBridgeKey = '" + key + "';";
            getBridge().getWebView().evaluateJavascript(js, null);
        } catch (Exception e) {
            Log.w(TAG, "Bridge key injection failed", e);
        }
    }

    @Override
    public void onDestroy() {
        stopOauthKeepAlive();
        if (oauthServer != null) {
            oauthServer.stop();
            oauthServer = null;
        }
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // singleTask re-entry: the WebView is already alive, deliver immediately.
        if (intent != null && Intent.ACTION_SEND.equals(intent.getAction())) {
            pendingSendIntent = null;
            trySendToWebApp(intent);
        }
    }

    /**
     * FEATURE A: forwards a ACTION_SEND payload into the web app.
     * JS contract: window.__quizradarHandleShared && window.__quizradarHandleShared(payload)
     * where payload is a JSON object {"title": string|null, "text": string}.
     * Privacy: only lengths are logged, never the shared content itself.
     */
    private void trySendToWebApp(Intent intent) {
        try {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            String title = intent.getStringExtra(Intent.EXTRA_TITLE);
            if (title == null || title.trim().isEmpty()) {
                title = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            }
            if (text != null) {
                text = text.trim();
            }

            // Gmail shares subject inline as "subject\n\ntext" when no
            // EXTRA_SUBJECT was provided — split the first line back out.
            if ((title == null || title.trim().isEmpty()) && text != null) {
                int sep = text.indexOf("\n\n");
                if (sep > 0 && sep <= 100) {
                    String candidate = text.substring(0, sep).trim();
                    String body = text.substring(sep + 2).trim();
                    if (!candidate.isEmpty() && !body.isEmpty()) {
                        title = candidate;
                        text = body;
                    }
                }
            }

            if (text == null || text.isEmpty()) {
                Log.i(TAG, "ACTION_SEND without usable EXTRA_TEXT (length "
                        + (text == null ? -1 : text.length()) + ") — ignoring");
                return;
            }

            JSONObject payload = new JSONObject();
            payload.put("title", (title == null || title.trim().isEmpty())
                    ? JSONObject.NULL : title.trim());
            payload.put("text", text);
            String js = "window.__quizradarHandleShared && window.__quizradarHandleShared("
                    + payload.toString() + ")";
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(js, null);
                Log.i(TAG, "Delivered shared content to web app (text length " + text.length() + ")");
                // The dashboard changed context — pull a fresh widget snapshot.
                refreshWidgetSnapshot(true);
            } else {
                Log.w(TAG, "WebView not ready for shared content (text length "
                        + text.length() + ") — delivery skipped");
                Toast.makeText(this, "QuizRadar is still starting — open it and share again",
                        Toast.LENGTH_SHORT).show();
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to forward ACTION_SEND content into the web app", e);
        }
    }

    /**
     * FEATURE B: asks the web app for the next-assessment snapshot.
     * JS contract: ((window.__quizradarWidgetSnapshot && window.__quizradarWidgetSnapshot()) || null)
     * The JS must return an object or null; evaluateJavascript serializes the
     * result, so the callback string starts with '{' (object) or is "null".
     * If the JS returned a quoted JSON string, we unwrap it before parsing.
     * Throttled to once per 60s except the first ever run (and forced calls).
     */
    private void refreshWidgetSnapshot(boolean force) {
        try {
            if (getBridge() == null || getBridge().getWebView() == null) {
                return;
            }
            SharedPreferences prefs = getSharedPreferences(WIDGET_PREFS_FILE, MODE_PRIVATE);
            long last = prefs.getLong(WIDGET_KEY_LAST_PUSH, -1L);
            boolean firstEver = last < 0;
            if (!force && !firstEver
                    && System.currentTimeMillis() - last < WIDGET_PUSH_MIN_INTERVAL_MS) {
                return;
            }
            prefs.edit().putLong(WIDGET_KEY_LAST_PUSH, System.currentTimeMillis()).apply();
            getBridge().getWebView().evaluateJavascript(
                "((window.__quizradarWidgetSnapshot && window.__quizradarWidgetSnapshot()) || null)",
                this::handleWidgetSnapshotResult);
        } catch (Exception e) {
            Log.w(TAG, "Widget snapshot refresh failed", e);
        }
    }

    private void handleWidgetSnapshotResult(String raw) {
        try {
            String v = raw == null ? null : raw.trim();
            if (v != null && !v.isEmpty() && v.charAt(0) == '"') {
                // Result came back as a quoted JS string — unwrap the JSON inside.
                try {
                    Object unquoted = new JSONTokener(v).nextValue();
                    if (unquoted instanceof String) {
                        v = ((String) unquoted).trim();
                    }
                } catch (Exception ignored) {
                    // Falls through; the '{' check below will reject it.
                }
            }
            SharedPreferences prefs = getSharedPreferences(WIDGET_PREFS_FILE, MODE_PRIVATE);
            String old = prefs.getString(WIDGET_KEY_SNAPSHOT, null);
            if (v != null && v.startsWith("{")) {
                new JSONObject(v); // validate before persisting
                if (v.equals(old)) {
                    return; // unchanged — widget already shows this
                }
                prefs.edit().putString(WIDGET_KEY_SNAPSHOT, v).apply();
                QuizRadarWidgetProvider.pushUpdate(this);
            } else if (old != null) {
                // Web app reports no next assessment — clear the stale widget.
                prefs.edit().remove(WIDGET_KEY_SNAPSHOT).apply();
                QuizRadarWidgetProvider.pushUpdate(this);
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not parse widget snapshot from WebView", e);
        }
    }

    @Override
    public void onCodeReceived(final String provider) {
        Log.i(TAG, "Auth code received for " + provider + "; returning app to foreground");
        runOnUiThread(() -> {
            bringAppToFront();
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(
                        "if (window.showToast) { window.showToast('Finishing sign-in...', 'info', 3000); }", null);
                }
            } catch (Exception ignored) {}
        });
    }

    @Override
    public void onPrepare(final String provider) {
        Log.i(TAG, "Sign-in prepare for " + provider + " — starting keep-alive foreground service");
        try {
            Intent svc = new Intent(this, OAuthSigninService.class);
            svc.putExtra("provider", provider);
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                startForegroundService(svc);
            } else {
                startService(svc);
            }
            oauthKeepAlive = true;
        } catch (Exception e) {
            Log.w(TAG, "Could not start OAuth keep-alive service", e);
        }
    }

    /** Stops the temporary foreground keep-alive once sign-in resolves. */
    private void stopOauthKeepAlive() {
        if (!oauthKeepAlive) return;
        oauthKeepAlive = false;
        try {
            stopService(new Intent(this, OAuthSigninService.class));
        } catch (Exception ignored) {}
    }

    @Override
    public void onGoogleSuccess(final JSONObject tokens, final JSONObject profile) {
        Log.i(TAG, "Google OAuth completed: " + profile.optString("email"));
        stopOauthKeepAlive();
        storeRefreshToken("google", tokens, profile.optString("email"));
        runOnUiThread(() -> {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    String js = "if (window.handleOAuthResult) { window.handleOAuthResult('google', "
                            + tokens.toString() + ", "
                            + profile.toString() + "); }";
                    getBridge().getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to evaluate Google OAuth JS in WebView", e);
            }
            bringAppToFront();
        });
    }

    @Override
    public void onMicrosoftSuccess(final JSONObject tokens, final JSONObject profile) {
        String msEmail = profile.optString("mail", profile.optString("userPrincipalName"));
        Log.i(TAG, "Microsoft OAuth completed: " + msEmail);
        stopOauthKeepAlive();
        storeRefreshToken("microsoft", tokens, msEmail);
        runOnUiThread(() -> {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    String js = "if (window.handleOAuthResult) { window.handleOAuthResult('microsoft', "
                            + tokens.toString() + ", "
                            + profile.toString() + "); }";
                    getBridge().getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to evaluate Microsoft OAuth JS in WebView", e);
            }
            bringAppToFront();
        });
    }

    @Override
    public void onError(final String provider, final String error) {
        Log.e(TAG, "OAuth error for " + provider);
        stopOauthKeepAlive();
        runOnUiThread(() -> {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    // Escape backslash FIRST, then quote; cap length so a
                    // hostile error string can't break out of the JS literal.
                    String raw = error == null ? "unknown error" : error;
                    if (raw.length() > 160) raw = raw.substring(0, 160);
                    String sanitized = raw.replace("\\", "\\\\").replace("'", "\\'")
                            .replace("\n", " ").replace("\r", " ");
                    String js = "if (window.showToast) { window.showToast('Authentication failed: " + sanitized + "', 'error', 4500); }";
                    getBridge().getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to evaluate OAuth error JS in WebView", e);
            }
            bringAppToFront();
        });
    }

    /**
     * Persists the most recent Google/Microsoft refresh credential in the
     * app's private storage. Called right after every successful sign-in so
     * the on-device scanner can silently renew expired access tokens through
     * the bridge endpoint.
     */
    private void storeRefreshToken(String provider, JSONObject tokens, String email) {
        try {
            if (tokens == null) return;
            String refreshToken = tokens.optString("refresh_token", "");
            if (refreshToken.isEmpty()) {
                Log.w(TAG, provider + " sign-in returned no refresh token — silent renewal will be unavailable");
                return;
            }
            SharedPreferences prefs = getSharedPreferences(OAUTH_TOKEN_PREFS, MODE_PRIVATE);
            prefs.edit()
                    .putString("google".equals(provider) ? "google_refresh_token" : "ms_refresh_token", refreshToken)
                    .putString("google".equals(provider) ? "google_email" : "ms_email",
                            email == null ? "" : email)
                    .apply();
            Log.i(TAG, "Stored refresh token for " + provider + " (" + (email == null ? "" : email.length()) + "-char email)");
        } catch (Exception e) {
            Log.e(TAG, "Failed to store refresh token for " + provider, e);
        }
    }

    /**
     * Bridge handler for POST /api/auth/refresh. Runs on the OAuth server's
     * worker thread (never the UI thread): redeems the stored refresh token
     * for a fresh access token. Scope-gated by the session bridge secret,
     * which is validated inside LocalOAuthServer before this is invoked.
     */
    private JSONObject handleBridgeRefresh(String provider) {
        SharedPreferences prefs = null;
        String storedKey;
        try {
            prefs = getSharedPreferences(OAUTH_TOKEN_PREFS, MODE_PRIVATE);
            storedKey = "google".equals(provider) ? "google_refresh_token" : "ms_refresh_token";
            String refreshToken = prefs.getString(storedKey, null);
            if (refreshToken == null || refreshToken.isEmpty()) {
                Log.w(TAG, "Refresh requested for " + provider + " but nothing is stored");
                return null;
            }
            String endpoint;
            String postData;
            if ("google".equals(provider)) {
                endpoint = "https://oauth2.googleapis.com/token";
                postData = "client_id=" + java.net.URLEncoder.encode(LocalOAuthServer.GOOGLE_CLIENT_ID, "UTF-8")
                        + "&client_secret=" + java.net.URLEncoder.encode(LocalOAuthServer.GOOGLE_CLIENT_SECRET, "UTF-8")
                        + "&refresh_token=" + java.net.URLEncoder.encode(refreshToken, "UTF-8")
                        + "&grant_type=refresh_token";
            } else {
                endpoint = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
                postData = "client_id=" + java.net.URLEncoder.encode(LocalOAuthServer.MICROSOFT_CLIENT_ID, "UTF-8")
                        + "&refresh_token=" + java.net.URLEncoder.encode(refreshToken, "UTF-8")
                        + "&grant_type=refresh_token"
                        + "&scope=" + java.net.URLEncoder.encode("offline_access User.Read Mail.Read Calendars.Read", "UTF-8");
            }
            JSONObject res = LocalOAuthServer.postFormJson(endpoint, postData);
            String accessToken = res.optString("access_token");
            if (accessToken.isEmpty()) {
                Log.w(TAG, "Refresh for " + provider + " returned no access token");
                return null;
            }
            // Microsoft occasionally rotates the refresh token alongside the
            // access token — keep the newest one so later renewals keep working.
            String rotated = res.optString("refresh_token");
            if (!rotated.isEmpty() && !rotated.equals(refreshToken)) {
                prefs.edit().putString(storedKey, rotated).apply();
            }
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("provider", provider);
            out.put("access_token", accessToken);
            out.put("expires_in", res.optLong("expires_in", 3600L));
            Log.i(TAG, "Bridge refresh OK for " + provider + " (expires_in " + res.optLong("expires_in", 3600L) + "s)");
            return out;
        } catch (Exception e) {
            String msg = e == null ? "" : String.valueOf(e.getMessage());
            if (prefs != null && msg != null && (msg.contains("HTTP 400") || msg.contains("HTTP 401"))) {
                // The stored credential was revoked/expired server-side. Purge
                // it so the next sign-in starts cleanly instead of looping on
                // a dead token.
                try {
                    prefs.edit().remove("google".equals(provider) ? "google_refresh_token" : "ms_refresh_token").apply();
                    Log.w(TAG, "Purged revoked refresh token for " + provider + " — user must sign in again");
                } catch (Exception ignored) {}
            } else {
                Log.w(TAG, "Bridge refresh failed for " + provider + " (transient or transport error)");
            }
            return null;
        }
    }

    private void bringAppToFront() {
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "Could not bring MainActivity to front", e);
        }
    }
}
