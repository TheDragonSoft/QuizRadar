package com.quizradar.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import org.json.JSONObject;

/**
 * Home-screen widget: countdown to the next assessment.
 *
 * Data contract: MainActivity pushes a JSON snapshot into the
 * "quizradar_widget_prefs" SharedPrefs file under "next_snapshot_json"
 * (see MainActivity#refreshWidgetSnapshot). All fields are optional and
 * defensively parsed: course_id, title, date (ISO "2026-10-24"),
 * assessment_type, days_until (number, may be 0), google_cal_url.
 */
public class QuizRadarWidgetProvider extends AppWidgetProvider {
    private static final String TAG = "QuizRadarWidget";
    private static final String PREFS_FILE = "quizradar_widget_prefs";
    private static final String KEY_SNAPSHOT = "next_snapshot_json";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        try {
            render(context, appWidgetManager, appWidgetIds);
        } catch (Exception e) {
            Log.e(TAG, "Widget onUpdate failed", e);
        }
    }

    /**
     * Re-renders ALL widget instances from the shared prefs snapshot.
     * Called by MainActivity after it writes a new snapshot.
     */
    public static void pushUpdate(Context context) {
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(context);
            if (mgr == null) return;
            int[] ids = mgr.getAppWidgetIds(
                    new ComponentName(context, QuizRadarWidgetProvider.class));
            if (ids == null || ids.length == 0) return;
            render(context, mgr, ids);
        } catch (Exception e) {
            Log.e(TAG, "Widget pushUpdate failed", e);
        }
    }

    private static void render(Context context, AppWidgetManager mgr, int[] ids) {
        // NOTE: the card is intentionally a single white design with dark text —
        // on dark launchers it reads as a light card, accepted for v1.
        SharedPreferences prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
        String json = prefs.getString(KEY_SNAPSHOT, null);
        RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.quizradar_widget);
        rv.setOnClickPendingIntent(R.id.widget_root, buildLaunchIntent(context));

        JSONObject snap = null;
        if (json != null && !json.trim().isEmpty()) {
            try {
                snap = new JSONObject(json.trim());
            } catch (Exception e) {
                Log.w(TAG, "Widget snapshot JSON invalid — rendering empty state");
            }
        }

        if (snap == null) {
            rv.setTextViewText(R.id.widget_course_code, "QuizRadar");
            rv.setViewVisibility(R.id.widget_days_badge, View.GONE);
            rv.setTextViewText(R.id.widget_title, "Open QuizRadar to load your radar");
            rv.setTextViewText(R.id.widget_date, "Tap to open your radar");
            mgr.updateAppWidget(ids, rv);
            return;
        }

        String courseId = optStr(snap, "course_id");
        String title = optStr(snap, "title");
        String type = optStr(snap, "assessment_type");
        Integer days = optDays(snap, "days_until");
        String dateIso = optStr(snap, "date");

        rv.setViewVisibility(R.id.widget_days_badge, days == null ? View.GONE : View.VISIBLE);
        rv.setTextViewText(R.id.widget_course_code, courseId != null ? courseId : "Quiz");
        rv.setTextViewText(R.id.widget_title,
                title != null ? title : (type != null ? type : "Next assessment"));

        String dateDisplay = null;
        if (dateIso != null) {
            try {
                // java.time needs API 26+; on API 23–25 the NoClassDefFoundError
                // is caught (Throwable) and we fall back to the raw ISO string.
                dateDisplay = LocalDate.parse(dateIso)
                        .format(DateTimeFormatter.ofPattern("EEE, MMM d", Locale.ENGLISH));
            } catch (Throwable t) {
                dateDisplay = dateIso;
            }
        }
        rv.setTextViewText(R.id.widget_date, dateDisplay != null ? dateDisplay : "");

        if (days != null) {
            String badge;
            if (days < 0) {
                badge = "Done";
            } else if (days == 0) {
                badge = "Today";
            } else if (days == 1) {
                badge = "Tomorrow";
            } else {
                badge = "in " + days + "d";
            }
            int badgeBg;
            if (days <= 1) {
                badgeBg = R.drawable.widget_badge_urgent;
            } else if (days <= 3) {
                badgeBg = R.drawable.widget_badge_soon;
            } else {
                badgeBg = R.drawable.widget_badge_later;
            }
            rv.setTextViewText(R.id.widget_days_badge, badge);
            rv.setInt(R.id.widget_days_badge, "setBackgroundResource", badgeBg);
        }

        mgr.updateAppWidget(ids, rv);
    }

    private static PendingIntent buildLaunchIntent(Context context) {
        Intent launch = new Intent(context, MainActivity.class);
        return PendingIntent.getActivity(context, 0, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static String optStr(JSONObject snap, String key) {
        Object v = snap.opt(key);
        if (v == null || v == JSONObject.NULL) return null;
        String s = v.toString().trim();
        return s.isEmpty() ? null : s;
    }

    private static Integer optDays(JSONObject snap, String key) {
        Object v = snap.opt(key);
        if (v == null || v == JSONObject.NULL) return null;
        if (v instanceof Number) return ((Number) v).intValue();
        try {
            return Integer.parseInt(v.toString().trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
