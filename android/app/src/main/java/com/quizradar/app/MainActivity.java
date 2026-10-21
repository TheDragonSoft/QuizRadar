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

    private LocalOAuthServer oauthServer;
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
            oauthServer.start();
            if (oauthServer.awaitStart(1500)) {
                Log.i(TAG, "Local OAuth server listening on 127.0.0.1:3000");
            } else {
                Log.e(TAG, "Local OAuth server failed to bind port 3000 — Google/Microsoft sign-in will not work this session");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize LocalOAuthServer", e);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (pendingSendIntent != null) {
            Intent send = pendingSendIntent;
            pendingSendIntent = null;
            trySendToWebApp(send);
        }
        refreshWidgetSnapshot(false);
    }

    @Override
    public void onDestroy() {
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
    public void onGoogleSuccess(final JSONObject tokens, final JSONObject profile) {
        Log.i(TAG, "Google OAuth completed: " + profile.optString("email"));
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
        Log.i(TAG, "Microsoft OAuth completed: " + profile.optString("mail", profile.optString("userPrincipalName")));
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
