package PACKAGE_NAME;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.content.Context;
import android.content.SharedPreferences;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONException;

public class AppBlockerAccessibilityService extends AccessibilityService {
    private WindowManager windowManager;
    private View blockerView;
    private String currentBlockedPackage = "";

    @Override public void onServiceConnected() {
        super.onServiceConnected();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getPackageName() == null) return;
        String packageName = event.getPackageName().toString();
        if (packageName.equals(getPackageName())) {
            if (event.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) removeBlocker();
            return;
        }
        SharedPreferences prefs = getSharedPreferences(AppBlockerPlugin.PREFS, MODE_PRIVATE);
        boolean enabled = prefs.getBoolean(AppBlockerPlugin.KEY_MANUAL, false)
                || prefs.getBoolean(AppBlockerPlugin.KEY_SESSION, false);
        if (!enabled || !isBlocked(prefs, packageName)) {
            removeBlocker();
            return;
        }
        if (!packageName.equals(currentBlockedPackage) || blockerView == null) showBlocker(packageName);
    }

    private boolean isBlocked(SharedPreferences prefs, String packageName) {
        try {
            JSONArray list = new JSONArray(prefs.getString(AppBlockerPlugin.KEY_BLOCKED, "[]"));
            for (int i = 0; i < list.length(); i++) if (packageName.equals(list.optString(i))) return true;
        } catch (JSONException ignored) { }
        return false;
    }

    private void showBlocker(String packageName) {
        removeBlocker();
        if (windowManager == null) windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        if (windowManager == null) return;
        currentBlockedPackage = packageName;

        LinearLayout shade = new LinearLayout(this);
        shade.setGravity(Gravity.CENTER);
        shade.setOrientation(LinearLayout.VERTICAL);
        shade.setPadding(dp(28), dp(28), dp(28), dp(28));
        shade.setBackgroundColor(Color.rgb(9, 10, 14));
        shade.setClickable(true);
        shade.setFocusable(true);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setPadding(dp(24), dp(30), dp(24), dp(26));
        GradientDrawable cardBg = new GradientDrawable();
        cardBg.setColor(Color.rgb(24, 25, 32));
        cardBg.setCornerRadius(dp(22));
        cardBg.setStroke(dp(1), Color.rgb(65, 42, 49));
        card.setBackground(cardBg);

        TextView logo = new TextView(this);
        logo.setText("LOCKED IN");
        logo.setTextColor(Color.rgb(232, 57, 78));
        logo.setTextSize(13);
        logo.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        logo.setLetterSpacing(0.12f);
        card.addView(logo, matchWrap());

        TextView title = new TextView(this);
        title.setText("This app is blocked");
        title.setTextColor(Color.WHITE);
        title.setTextSize(23);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleParams = matchWrap();
        titleParams.topMargin = dp(18);
        card.addView(title, titleParams);

        TextView message = new TextView(this);
        message.setText("Stay focused. You can use this app when your blocking settings allow it.");
        message.setTextColor(Color.rgb(172, 174, 184));
        message.setTextSize(14);
        message.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams messageParams = matchWrap();
        messageParams.topMargin = dp(10);
        card.addView(message, messageParams);

        Button home = new Button(this);
        home.setText("Go back to Home");
        home.setTextColor(Color.WHITE);
        home.setAllCaps(false);
        home.setTextSize(15);
        home.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(224, 51, 72)));
        LinearLayout.LayoutParams buttonParams = matchWrap();
        buttonParams.topMargin = dp(24);
        card.addView(home, buttonParams);
        home.setOnClickListener(v -> performGlobalAction(GLOBAL_ACTION_HOME));
        shade.addView(card, new LinearLayout.LayoutParams(-1, -2));

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                android.graphics.PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        try {
            windowManager.addView(shade, params);
            blockerView = shade;
        } catch (Exception ignored) {
            blockerView = null;
            currentBlockedPackage = "";
        }
    }

    private LinearLayout.LayoutParams matchWrap() { return new LinearLayout.LayoutParams(-1, -2); }
    private int dp(int value) { return (int)(value * getResources().getDisplayMetrics().density + 0.5f); }

    private void removeBlocker() {
        if (blockerView != null && windowManager != null) {
            try { windowManager.removeView(blockerView); } catch (Exception ignored) { }
        }
        blockerView = null;
        currentBlockedPackage = "";
    }

    @Override public void onInterrupt() { removeBlocker(); }
    @Override public void onDestroy() { removeBlocker(); super.onDestroy(); }
}
