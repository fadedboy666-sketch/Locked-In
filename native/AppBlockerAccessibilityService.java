package PACKAGE_NAME;

import android.accessibilityservice.AccessibilityService;
import android.content.SharedPreferences;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.os.Build;
import android.view.KeyEvent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.Drawable;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONException;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import java.util.Set;

public class AppBlockerAccessibilityService extends AccessibilityService {
    private static final int RED = Color.rgb(205, 28, 54);
    private static final int WHITE = Color.WHITE;
    private static final int BLACK = Color.BLACK;
    private static final int MAX_SCROLL_PASSES = 4;
    private static final long CHALLENGE_DELAY_MS = 40000L;
    private static final long SCROLL_WINDOW_MS = 5 * 60 * 1000L;

    private WindowManager windowManager;
    private View blockerView;
    private String currentBlockedPackage = "";
    private String foregroundPackage = "";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private AudioFocusRequest blockerAudioFocusRequest;
    private final AudioManager.OnAudioFocusChangeListener blockerAudioFocusListener = focusChange -> { };
    private final Map<String, Runnable> reblockRunnables = new HashMap<>();
    private Runnable enableDoneRunnable;
    private long challengeStartedAt = 0L;
    private boolean challengeStarted = false;

    @Override public void onServiceConnected() {
        super.onServiceConnected();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getPackageName() == null) return;
        // Overlay/window-content events are not reliable foreground changes. Only
        // react to a real app-window transition to avoid the overlay hiding itself.
        if (event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                && event.getEventType() != AccessibilityEvent.TYPE_WINDOWS_CHANGED
                && event.getEventType() != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) return;
        String packageName = event.getPackageName().toString();
        if (packageName.equals(getPackageName())) {
            CharSequence className = event.getClassName();
            String activity = className == null ? "" : className.toString();
            if (activity.endsWith("MainActivity") || activity.endsWith("BridgeActivity")) {
                foregroundPackage = packageName;
                removeBlocker();
            }
            return;
        }
        foregroundPackage = packageName;

        // Once the blocker is visible, keep it above the launcher and any transition
        // windows. The user leaves through the blocker button, not by briefly exposing
        // the blocked app underneath.
        if (!packageName.equals(currentBlockedPackage) && blockerView != null
                && !currentBlockedPackage.isEmpty()) return;

        SharedPreferences prefs = getSharedPreferences(AppBlockerPlugin.PREFS, MODE_PRIVATE);
        boolean enabled = prefs.getBoolean(AppBlockerPlugin.KEY_MANUAL, false)
                || prefs.getBoolean(AppBlockerPlugin.KEY_SESSION, false);
        if (!enabled || !isBlocked(prefs, packageName) || hasTemporaryAccess(prefs, packageName)) {
            if (blockerView != null && !currentBlockedPackage.isEmpty()) return;
            removeBlocker();
            return;
        }
        if (!packageName.equals(currentBlockedPackage) || blockerView == null) {
            // Attach the opaque banner immediately, interrupt media, then move the
            // blocked activity behind the banner so its video cannot remain visible.
            showBlocker(packageName);
            pauseBlockedMedia(packageName);
            // Send the blocked activity behind the opaque accessibility overlay immediately.
            // A delay here allows a frame of the blocked feed to remain visible.
            performGlobalAction(GLOBAL_ACTION_HOME);
        }
    }

    private boolean isBlocked(SharedPreferences prefs, String packageName) {
        try {
            JSONArray list = new JSONArray(prefs.getString(AppBlockerPlugin.KEY_BLOCKED, "[]"));
            for (int i = 0; i < list.length(); i++) if (packageName.equals(list.optString(i))) return true;
        } catch (JSONException ignored) { }
        return false;
    }

    private boolean hasTemporaryAccess(SharedPreferences prefs, String packageName) {
        return prefs.getLong("scroll_until_" + packageName, 0L) > System.currentTimeMillis();
    }

    private void showBlocker(String packageName) {
        boolean keepExistingOverlay = packageName.equals(currentBlockedPackage) && blockerView != null;
        if (!keepExistingOverlay) removeBlocker();
        if (windowManager == null) windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        if (windowManager == null) return;
        currentBlockedPackage = packageName;

        SharedPreferences prefs = getSharedPreferences(AppBlockerPlugin.PREFS, MODE_PRIVATE);
        String appName = getAppLabel(packageName);
        int screenCount = prefs.getInt("screen_count_" + packageName, 0) + 1;
        prefs.edit().putInt("screen_count_" + packageName, screenCount).apply();
        String goal = prefs.getString(AppBlockerPlugin.KEY_GOAL, "");
        boolean showGoal = goal != null && !goal.trim().isEmpty() && screenCount % 5 == 0;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(28), dp(30), dp(28), dp(30));
        root.setBackgroundColor(BLACK);
        root.setClickable(true);
        root.setFocusable(true);

        ImageView logo = buildLogo();
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(dp(82), dp(82));
        logoParams.bottomMargin = dp(24);
        root.addView(logo, logoParams);

        TextView appTitle = text(appName + " is blocked.", 22, WHITE, true);
        appTitle.setGravity(Gravity.CENTER);
        root.addView(appTitle, matchWrap());

        TextView message;
        if (showGoal) {
            TextView goalLabel = text("YOUR YEARLY GOAL", 11, WHITE, true);
            goalLabel.setLetterSpacing(0.12f);
            LinearLayout.LayoutParams labelParams = matchWrap();
            labelParams.topMargin = dp(28);
            root.addView(goalLabel, labelParams);

            TextView goalText = text(goal, 24, WHITE, true);
            goalText.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams goalParams = matchWrap();
            goalParams.topMargin = dp(12);
            root.addView(goalText, goalParams);
            message = text("Is scrolling worth giving this up?", 16, WHITE, false);
        } else {
            message = text(messageFor(prefs, packageName), 17, WHITE, false);
        }
        message.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams messageParams = matchWrap();
        messageParams.topMargin = dp(showGoal ? 18 : 14);
        messageParams.bottomMargin = dp(30);
        root.addView(message, messageParams);

        addActionButton(root, "LOCK IN", RED, WHITE, () -> { removeBlocker(); performGlobalAction(GLOBAL_ACTION_HOME); });
        int scrollCount = prefs.getInt("scroll_count_" + packageName, 0);
        if (scrollCount < MAX_SCROLL_PASSES) {
            LinearLayout.LayoutParams scrollParams = matchWrap();
            scrollParams.topMargin = dp(10);
            TextView scroll = actionButton("SCROLL", Color.TRANSPARENT, WHITE, true);
            root.addView(scroll, scrollParams);
            scroll.setOnClickListener(v -> showChallengeStart(packageName));
        } else {
            TextView limit = text("You can't scroll now. You have reached the limit.", 13, WHITE, false);
            limit.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams limitParams = matchWrap();
            limitParams.topMargin = dp(18);
            root.addView(limit, limitParams);
        }

        if (keepExistingOverlay) replaceOverlay(root); else attachOverlay(root);
    }

    private void showChallengeStart(String packageName) {
        if (!packageName.equals(currentBlockedPackage)) return;
        LinearLayout root = baseScreen();
        TextView title = text("Do 15 push-ups to unlock scrolling.", 24, WHITE, true);
        title.setGravity(Gravity.CENTER);
        root.addView(title, matchWrap());
        TextView detail = text("Complete your 15 push-ups, then tap Done when it unlocks.", 13, WHITE, false);
        detail.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams detailParams = matchWrap();
        detailParams.topMargin = dp(14);
        detailParams.bottomMargin = dp(24);
        root.addView(detail, detailParams);
        addActionButton(root, "START", RED, WHITE, () -> startChallenge(packageName));
        TextView cancel = actionButton("BACK", Color.TRANSPARENT, WHITE, true);
        LinearLayout.LayoutParams cancelParams = matchWrap();
        cancelParams.topMargin = dp(8);
        root.addView(cancel, cancelParams);
        cancel.setOnClickListener(v -> showBlocker(packageName));
        replaceOverlay(root);
    }

    private void startChallenge(String packageName) {
        SharedPreferences prefs = getSharedPreferences(AppBlockerPlugin.PREFS, MODE_PRIVATE);
        int count = prefs.getInt("scroll_count_" + packageName, 0);
        if (count >= MAX_SCROLL_PASSES) { showBlocker(packageName); return; }
        LinearLayout root = baseScreen();
        TextView title = text("You've got this.", 25, WHITE, true);
        title.setGravity(Gravity.CENTER);
        root.addView(title, matchWrap());
        TextView detail = text("Finish your 15 push-ups and your Done button will unlock shortly.", 15, WHITE, false);
        detail.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams detailParams = matchWrap();
        detailParams.topMargin = dp(14);
        detailParams.bottomMargin = dp(28);
        root.addView(detail, detailParams);

        TextView done = actionButton("DONE", Color.TRANSPARENT, WHITE, true);
        done.setAlpha(0.38f);
        root.addView(done, matchWrap());
        done.setOnClickListener(v -> {
            long elapsed = SystemClock.elapsedRealtime() - challengeStartedAt;
            if (!challengeStarted || elapsed < CHALLENGE_DELAY_MS) {
                showShortMessage("Complete the push-up challenge first. Done unlocks after 40 seconds.");
                return;
            }
            grantScrollPass(packageName);
        });
        TextView cancel = actionButton("BACK", Color.TRANSPARENT, WHITE, true);
        LinearLayout.LayoutParams cancelParams = matchWrap();
        cancelParams.topMargin = dp(10);
        root.addView(cancel, cancelParams);
        cancel.setOnClickListener(v -> showBlocker(packageName));
        replaceOverlay(root);

        challengeStarted = true;
        challengeStartedAt = SystemClock.elapsedRealtime();
        if (enableDoneRunnable != null) handler.removeCallbacks(enableDoneRunnable);
        enableDoneRunnable = () -> {
            if (!packageName.equals(currentBlockedPackage) || root.getParent() == null) return;
            done.setAlpha(1f);
            done.setBackground(background(RED, RED, 14));
        };
        handler.postDelayed(enableDoneRunnable, CHALLENGE_DELAY_MS);
    }

    private void showShortMessage(String message) {
        android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_SHORT).show();
    }

    private void requestBlockerAudioFocus() {
        try {
            AudioManager audio = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (audio == null) return;
            if (Build.VERSION.SDK_INT >= 26) {
                if (blockerAudioFocusRequest == null) {
                    AudioAttributes attributes = new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build();
                    blockerAudioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                            .setAudioAttributes(attributes)
                            .setOnAudioFocusChangeListener(blockerAudioFocusListener, handler)
                            .setAcceptsDelayedFocusGain(false)
                            .build();
                }
                audio.requestAudioFocus(blockerAudioFocusRequest);
            } else {
                audio.requestAudioFocus(blockerAudioFocusListener, AudioManager.STREAM_MUSIC,
                        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE);
            }
        } catch (Exception ignored) { }
    }

    private void abandonBlockerAudioFocus() {
        try {
            AudioManager audio = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (audio == null) return;
            if (Build.VERSION.SDK_INT >= 26 && blockerAudioFocusRequest != null) {
                audio.abandonAudioFocusRequest(blockerAudioFocusRequest);
            } else {
                audio.abandonAudioFocus(blockerAudioFocusListener);
            }
        } catch (Exception ignored) { }
    }

    private void pauseForegroundMediaBestEffort() {
        try {
            AudioManager audio = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (audio == null) return;
            long now = SystemClock.uptimeMillis();
            KeyEvent down = new KeyEvent(now, now, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PAUSE, 0);
            KeyEvent up = new KeyEvent(now, now, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PAUSE, 0);
            audio.dispatchMediaKeyEvent(down);
            audio.dispatchMediaKeyEvent(up);
        } catch (Exception ignored) { }
    }

    private void pauseBlockedMedia(String packageName) {
        requestBlockerAudioFocus();
        pauseForegroundMediaBestEffort();
        // Repeat pause after the activity is backgrounded; some feeds ignore the
        // first media-key event while their window is transitioning.
        long[] retries = {120L, 350L, 800L, 1500L};
        for (long delay : retries) {
            handler.postDelayed(() -> {
                if (packageName.equals(currentBlockedPackage) && blockerView != null) {
                    pauseForegroundMediaBestEffort();
                }
            }, delay);
        }
    }

    private void grantScrollPass(String packageName) {
        if (!packageName.equals(currentBlockedPackage)) return;

        SharedPreferences prefs =
                getSharedPreferences(AppBlockerPlugin.PREFS, MODE_PRIVATE);

        final long until = System.currentTimeMillis() + SCROLL_WINDOW_MS;

        int completedPasses =
                prefs.getInt("scroll_count_" + packageName, 0);

        if (completedPasses >= MAX_SCROLL_PASSES) {
            showBlocker(packageName);
            return;
        }

        // Persist the access deadline so the blocker can re-check it after a restart.
        prefs.edit()
                .putInt("scroll_count_" + packageName, completedPasses + 1)
                .putLong("scroll_until_" + packageName, until)
                .apply();

        removeBlocker();
        // The blocked app was sent behind the home screen while the banner was
        // visible. Reopen it for the approved scroll pass after the challenge.
        try {
            Intent launch = getPackageManager().getLaunchIntentForPackage(packageName);
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(launch);
            }
        } catch (Exception ignored) { }

        // Cancel only the previous timer for this package.
        Runnable previous = reblockRunnables.remove(packageName);
        if (previous != null) {
            handler.removeCallbacks(previous);
        }

        Runnable expiry = new Runnable() {
            @Override
            public void run() {
                SharedPreferences latest =
                        getSharedPreferences(AppBlockerPlugin.PREFS, MODE_PRIVATE);

                long savedUntil =
                        latest.getLong("scroll_until_" + packageName, 0L);

                // Do not let an outdated timer interfere with a newer pass.
                if (savedUntil != until) {
                    if (reblockRunnables.get(packageName) == this) {
                        reblockRunnables.remove(packageName);
                    }
                    return;
                }

                // If the handler runs early, wait for the actual saved deadline.
                long remaining = savedUntil - System.currentTimeMillis();
                if (remaining > 0L) {
                    handler.postDelayed(this, remaining);
                    return;
                }

                boolean enabled =
                        latest.getBoolean(AppBlockerPlugin.KEY_MANUAL, false)
                        || latest.getBoolean(AppBlockerPlugin.KEY_SESSION, false);

                boolean stillBlocked = enabled && isBlocked(latest, packageName);

                // Expire this package's temporary access.
                latest.edit()
                        .remove("scroll_until_" + packageName)
                        .apply();

                if (stillBlocked && packageName.equals(foregroundPackage)) {
                    // Best-effort media pause, then leave the selected app.
                    pauseForegroundMediaBestEffort();
                    performGlobalAction(GLOBAL_ACTION_HOME);
                }

                if (reblockRunnables.get(packageName) == this) {
                    reblockRunnables.remove(packageName);
                }
            }
        };

        reblockRunnables.put(packageName, expiry);
        handler.postDelayed(expiry, SCROLL_WINDOW_MS);
    }

    private LinearLayout baseScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(28), dp(30), dp(28), dp(30));
        root.setBackgroundColor(BLACK);
        root.setClickable(true);
        root.setFocusable(true);
        return root;
    }

    private ImageView buildLogo() {
        ImageView logo = new ImageView(this);
        int logoId = getResources().getIdentifier("locked_in_logo", "drawable", getPackageName());
        if (logoId != 0) {
            logo.setImageResource(logoId);
        } else {
            int launcherId = getResources().getIdentifier("ic_launcher", "mipmap", getPackageName());
            if (launcherId != 0) logo.setImageResource(launcherId);
            else {
                try { logo.setImageDrawable(getPackageManager().getApplicationIcon(getPackageName())); }
                catch (Exception ignored) { }
            }
        }
        logo.setContentDescription("Locked In logo");
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        return logo;
    }

    private String getAppLabel(String packageName) {
        try {
            android.content.pm.ApplicationInfo info = getPackageManager().getApplicationInfo(packageName, 0);
            return String.valueOf(getPackageManager().getApplicationLabel(info));
        } catch (Exception ignored) { return packageName; }
    }

    private String messageFor(SharedPreferences prefs, String pkg) {
        String lower = pkg.toLowerCase();
        String category;
        String[] messages;
        if (lower.contains("instagram")) {
            category = "instagram";
            messages = new String[] {
                "You came here for a minute. How long has it actually been?",
                "You opened the feed. Did you have something specific to check?",
                "A quick check can wait. Your next task is still waiting.",
                "Is this scroll helping with anything you planned?",
                "Your attention is valuable. Spend it on purpose.",
                "You can close the app without missing your own progress.",
                "What were you about to do before opening Instagram?",
                "Don't trade your focus for an endless feed.",
                "You don't need to watch everyone else's day right now.",
                "Make the next few minutes count somewhere else."
            };
        } else if (lower.contains("tiktok")) {
            category = "tiktok";
            messages = new String[] {
                "One more video? You already know where this goes.",
                "Five minutes can disappear quickly here.",
                "You opened the feed. Did you open it for a reason?",
                "Your next goal needs your time more than this feed does.",
                "You can stop here. The next video isn't important.",
                "Choose what gets your attention.",
                "This feed can wait until your planned downtime.",
                "Don't let autoplay make your decisions.",
                "You came here to check one thing. Is it done?",
                "Your plans deserve the time you're giving this feed."
            };
        } else if (lower.contains("facebook")) {
            category = "facebook";
            messages = new String[] {
                "What did you open Facebook for?",
                "Checking updates or losing time?",
                "Don't let an unplanned scroll take over your day.",
                "Your time is better spent intentionally.",
                "If nothing needs your attention here, head back to your plan."
            };
        } else if (lower.contains("snapchat")) {
            category = "snapchat";
            messages = new String[] {
                "Are those snaps worth interrupting your focus?",
                "You can reply later. Your priorities are still here.",
                "A notification doesn't need to control your attention.",
                "Check in with your goals before checking every snap.",
                "You don't have to answer everything immediately.",
                "Give your attention to what you chose to do."
            };
        } else if (lower.contains("netflix")) {
            category = "netflix";
            messages = new String[] {
                "One episode can wait. Your plans are still there.",
                "Watching can wait until your planned downtime.",
                "Is this the time you meant to spend watching?",
                "Your next goal needs your attention too."
            };
        } else if (lower.contains("youtube")) {
            category = "youtube";
            messages = new String[] {
                "Did you open YouTube with a purpose?",
                "One video can become an hour. Choose intentionally.",
                "Watch with a reason, not out of habit.",
                "Your attention deserves a better plan.",
                "If you found what you needed, close it now.",
                "The next recommendation can wait.",
                "You don't need another video to start your task.",
                "Make sure this is what you meant to do.",
                "Your next step is outside this screen.",
                "Choose your time before the algorithm chooses it."
            };
        } else {
            category = "general";
            messages = new String[] {
                "You opened this app. Remember what you were doing?",
                "Take a second. Was this part of your plan?",
                "Your attention is yours. Use it deliberately.",
                "Get back to the thing you meant to do."
            };
        }

        String historyKey = "recent_messages_" + category + "_" + pkg;
        JSONArray history;
        try { history = new JSONArray(prefs.getString(historyKey, "[]")); }
        catch (JSONException ignored) { history = new JSONArray(); }
        Set<Integer> recent = new HashSet<>();
        for (int i = 0; i < Math.min(2, history.length()); i++) {
            int index = history.optInt(i, -1);
            if (index >= 0 && index < messages.length) recent.add(index);
        }

        ArrayList<Integer> candidates = new ArrayList<>();
        for (int i = 0; i < messages.length; i++) if (!recent.contains(i)) candidates.add(i);
        if (candidates.isEmpty()) for (int i = 0; i < messages.length; i++) candidates.add(i);

        int totalWeight = 0;
        for (int index : candidates) totalWeight += index == 0 ? 5 : (index == 1 ? 3 : 1);
        int pick = new Random().nextInt(Math.max(1, totalWeight));
        int chosen = candidates.get(0);
        for (int index : candidates) {
            pick -= index == 0 ? 5 : (index == 1 ? 3 : 1);
            if (pick < 0) { chosen = index; break; }
        }

        JSONArray nextHistory = new JSONArray();
        nextHistory.put(chosen);
        if (history.length() > 0) nextHistory.put(history.optInt(0, -1));
        prefs.edit().putString(historyKey, nextHistory.toString()).apply();
        return messages[chosen];
    }

    private void addActionButton(LinearLayout parent, String label, int fill, int textColor, Runnable action) {
        TextView button = actionButton(label, fill, textColor, fill == Color.TRANSPARENT);
        LinearLayout.LayoutParams params = matchWrap();
        params.topMargin = dp(6);
        parent.addView(button, params);
        button.setOnClickListener(v -> action.run());
    }

    private TextView actionButton(String label, int fill, int textColor, boolean outlined) {
        TextView button = text(label, 15, textColor, true);
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(16), dp(15), dp(16), dp(15));
        button.setBackground(background(fill, outlined ? WHITE : fill, 14));
        button.setClickable(true);
        button.setFocusable(true);
        return button;
    }

    private GradientDrawable background(int fill, int stroke, int radius) {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(fill);
        bg.setCornerRadius(dp(radius));
        if (stroke != fill || fill == Color.TRANSPARENT) bg.setStroke(dp(1), stroke);
        return bg;
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextColor(color);
        view.setTextSize(size);
        view.setTypeface(Typeface.DEFAULT, bold ? Typeface.BOLD : Typeface.NORMAL);
        view.setGravity(Gravity.CENTER);
        return view;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(-1, -2);
    }

    private void attachOverlay(View view) {
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                android.graphics.PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        try {
            windowManager.addView(view, params);
            blockerView = view;
        } catch (Exception ignored) {
            blockerView = null;
            currentBlockedPackage = "";
        }
    }

    private void replaceOverlay(View view) {
        // Keep the accessibility overlay window attached while changing screens.
        // Removing and re-adding it creates a visible gap where the blocked app peeks through.
        if (blockerView instanceof ViewGroup && windowManager != null) {
            try {
                ViewGroup host = (ViewGroup) blockerView;
                host.removeAllViews();
                host.addView(view, new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));
                return;
            } catch (Exception ignored) { }
        }
        attachOverlay(view);
    }

    private void removeOverlayOnly() {
        if (blockerView != null && windowManager != null) {
            try { windowManager.removeView(blockerView); } catch (Exception ignored) { }
        }
        blockerView = null;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private void removeBlocker() {
        abandonBlockerAudioFocus();
        removeOverlayOnly();
        currentBlockedPackage = "";
        challengeStarted = false;
        challengeStartedAt = 0L;
        if (enableDoneRunnable != null) {
            handler.removeCallbacks(enableDoneRunnable);
            enableDoneRunnable = null;
        }
    }

    @Override public void onInterrupt() { removeBlocker(); }
    @Override public void onDestroy() {
        removeBlocker();
        for (Runnable runnable : reblockRunnables.values()) {
            handler.removeCallbacks(runnable);
        }
        reblockRunnables.clear();
        super.onDestroy();
    }
}
