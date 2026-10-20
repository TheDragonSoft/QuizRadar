package com.quizradar.app;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity implements LocalOAuthServer.OAuthListener {
    private static final String TAG = "MainActivity";
    private LocalOAuthServer oauthServer;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            oauthServer = new LocalOAuthServer(3000, this);
            oauthServer.start();
            Log.i(TAG, "Local OAuth server successfully initialized on port 3000");
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize LocalOAuthServer", e);
        }
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
        Log.e(TAG, "OAuth error for " + provider + ": " + error);
        runOnUiThread(() -> {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    String sanitized = error.replace("'", "\\'");
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
