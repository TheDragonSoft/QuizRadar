package com.quizradar.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;

/**
 * Foreground keep-alive while the user completes Google/Microsoft sign-in in an
 * external browser. Without this, the moment Chrome takes the foreground the
 * QUIZRADAR process drops into the cached/frozen bucket — and the loopback
 * callback server dies with it, so https://accounts.google.com finally redirects
 * to http://localhost:3000 and the phone shows "this site can't be reached".
 * A foreground service raises the process priority so the loopback listener
 * keeps answering the single callback that matters.
 */
public class OAuthSigninService extends Service {
    private static final String CHANNEL_ID = "quizradar_oauth";
    private static final int NOTIFICATION_ID = 4210;
    private static final long TIMEOUT_MS = 12 * 60 * 1000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeoutStop = new Runnable() {
        @Override public void run() {
            stopForegroundCompat();
            stopSelf();
        }
    };

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String provider = (intent != null) ? intent.getStringExtra("provider") : null;
        String title = "microsoft".equals(provider) ? "Microsoft Sign-In" : "Google Sign-In";

        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            nm.createNotificationChannel(new NotificationChannel(
                    CHANNEL_ID, "Sign-In", NotificationManager.IMPORTANCE_LOW));
        }
        startForeground(NOTIFICATION_ID, buildNotification(title));

        handler.removeCallbacks(timeoutStop);
        handler.postDelayed(timeoutStop, TIMEOUT_MS);
        return START_NOT_STICKY;
    }

    private Notification buildNotification(String title) {
        PendingIntent contentIntent = PendingIntent.getActivity(
                this, 0,
                new Intent(this, MainActivity.class)
                        .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle("QuizRadar " + title)
                .setContentText("Waiting for your browser — this finishes as soon as you sign in.")
                .setOngoing(true)
                .setSilent(true)
                .setContentIntent(contentIntent)
                .build();
    }

    private void stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= 24) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(timeoutStop);
        super.onDestroy();
    }
}
