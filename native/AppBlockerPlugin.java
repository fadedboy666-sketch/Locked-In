package PACKAGE_NAME;

import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.provider.Settings;
import android.text.TextUtils;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(name = "AppBlocker")
public class AppBlockerPlugin extends Plugin {
    static final String PREFS = "lockedin_app_blocker";
    static final String KEY_BLOCKED = "blocked_packages";
    static final String KEY_MANUAL = "manual_enabled";
    static final String KEY_SESSION = "session_active";
    static final String KEY_GOAL = "yearly_goal";

    @PluginMethod
    public void listApps(PluginCall call) {
        try {
            Intent launcher = new Intent(Intent.ACTION_MAIN, null);
            launcher.addCategory(Intent.CATEGORY_LAUNCHER);
            android.content.pm.PackageManager pm = getContext().getPackageManager();
            java.util.List<android.content.pm.ResolveInfo> found = pm.queryIntentActivities(launcher, 0);
            ArrayList<JSObject> apps = new ArrayList<>();
            Set<String> seen = new HashSet<>();
            for (android.content.pm.ResolveInfo info : found) {
                String packageName = info.activityInfo == null ? null : info.activityInfo.packageName;
                if (packageName == null || packageName.equals(getContext().getPackageName()) || !seen.add(packageName)) continue;
                JSObject item = new JSObject();
                item.put("name", String.valueOf(info.loadLabel(pm)));
                item.put("packageName", packageName);
                Drawable drawable = info.loadIcon(pm);
                if (drawable != null) item.put("icon", drawableToBase64(drawable));
                apps.add(item);
            }
            Collections.sort(apps, new Comparator<JSObject>() {
                @Override public int compare(JSObject a, JSObject b) {
                    return a.optString("name").compareToIgnoreCase(b.optString("name"));
                }
            });
            JSArray result = new JSArray();
            for (JSObject app : apps) result.put(app);
            JSObject response = new JSObject();
            response.put("apps", result);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not read installed apps: " + error.getMessage(), error);
        }
    }

    private String drawableToBase64(Drawable drawable) {
        int width = drawable.getIntrinsicWidth();
        int height = drawable.getIntrinsicHeight();
        if (width <= 0) width = 96;
        if (height <= 0) height = 96;
        float scale = Math.min(1f, 96f / Math.max(width, height));
        width = Math.max(1, (int) (width * scale));
        height = Math.max(1, (int) (height * scale));
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        drawable.setBounds(0, 0, width, height);
        drawable.draw(canvas);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.PNG, 90, output);
        bitmap.recycle();
        return android.util.Base64.encodeToString(output.toByteArray(), android.util.Base64.NO_WRAP);
    }

    @PluginMethod public void getStatus(PluginCall call) { call.resolve(statusObject()); }

    @PluginMethod
    public void setBlockedApps(PluginCall call) {
        SharedPreferences prefs = prefs();
        JSArray packages = call.getArray("packages");
        if (packages == null) packages = new JSArray();
        JSONArray clean = new JSONArray();
        for (int i = 0; i < packages.length(); i++) {
            String value = packages.optString(i, "");
            if (!TextUtils.isEmpty(value) && value.matches("[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)+")
                    && !value.equals(getContext().getPackageName()) && !contains(clean, value)) clean.put(value);
        }
        if (prefs.getBoolean(KEY_SESSION, false) && clean.length() == 0) {
            call.reject("Keep at least one app selected during a Lock In session.");
            return;
        }
        SharedPreferences.Editor editor = prefs.edit().putString(KEY_BLOCKED, clean.toString());
        if (clean.length() == 0 && !prefs.getBoolean(KEY_SESSION, false)) editor.putBoolean(KEY_MANUAL, false);
        editor.apply();
        call.resolve(statusObject());
    }

    @PluginMethod
    public void setManualEnabled(PluginCall call) {
        SharedPreferences prefs = prefs();
        boolean enabled = call.getBoolean("enabled", false);
        if (!enabled && prefs.getBoolean(KEY_SESSION, false)) {
            call.reject("Lock In session is active. App Blocking cannot be turned off yet.");
            return;
        }
        if (enabled) {
            String problem = readinessProblem(prefs);
            if (problem != null) { call.reject(problem); return; }
        }
        prefs.edit().putBoolean(KEY_MANUAL, enabled).apply();
        call.resolve(statusObject());
    }

    @PluginMethod
    public void setSessionActive(PluginCall call) {
        SharedPreferences prefs = prefs();
        boolean active = call.getBoolean("active", false);
        if (active) {
            String problem = readinessProblem(prefs);
            if (problem != null) { call.reject(problem); return; }
        }
        prefs.edit().putBoolean(KEY_SESSION, active).apply();
        call.resolve(statusObject());
    }

    @PluginMethod
    public void setBlockerConfig(PluginCall call) {
        String goal = call.getString("yearlyGoal", "");
        if (goal == null) goal = "";
        prefs().edit().putString(KEY_GOAL, goal).apply();
        call.resolve();
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        try {
            ComponentName component = new ComponentName(getContext(), AppBlockerAccessibilityService.class);
            Intent intent = new Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS");
            intent.putExtra("android.provider.extra.ACCESSIBILITY_SERVICE_COMPONENT_NAME", component.flattenToString());
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { getContext().startActivity(intent); }
            catch (Exception unsupportedDetailsPage) {
                Intent fallback = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
            }
            call.resolve();
        } catch (Exception error) { call.reject("Could not open Android Accessibility settings.", error); }
    }

    private String readinessProblem(SharedPreferences prefs) {
        if (!isServiceEnabled()) return "Enable the Locked In Accessibility service first.";
        if (readBlocked(prefs).length() == 0) return "Select at least one app first.";
        return null;
    }
    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREFS, 0); }

    private JSObject statusObject() {
        SharedPreferences prefs = prefs();
        JSONArray blocked = readBlocked(prefs);
        boolean manual = prefs.getBoolean(KEY_MANUAL, false);
        boolean session = prefs.getBoolean(KEY_SESSION, false);
        boolean accessibility = isServiceEnabled();
        JSObject result = new JSObject();
        result.put("blockedPackages", blocked);
        result.put("manualEnabled", manual);
        result.put("sessionActive", session);
        result.put("accessibilityEnabled", accessibility);
        result.put("enabled", manual || session);
        result.put("active", (manual || session) && accessibility && blocked.length() > 0);
        result.put("ready", accessibility && blocked.length() > 0);
        return result;
    }

    private JSONArray readBlocked(SharedPreferences prefs) {
        try { return new JSONArray(prefs.getString(KEY_BLOCKED, "[]")); }
        catch (JSONException ignored) { return new JSONArray(); }
    }
    private boolean contains(JSONArray array, String value) {
        for (int i = 0; i < array.length(); i++) if (value.equals(array.optString(i))) return true;
        return false;
    }
    private boolean isServiceEnabled() {
        String enabled = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (TextUtils.isEmpty(enabled)) return false;
        ComponentName component = new ComponentName(getContext(), AppBlockerAccessibilityService.class);
        TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
        splitter.setString(enabled);
        while (splitter.hasNext()) {
            ComponentName candidate = ComponentName.unflattenFromString(splitter.next());
            if (component.equals(candidate)) return true;
        }
        return false;
    }

    @PluginMethod
    public void syncHomeWidgets(PluginCall call) {
        try {
            JSObject data = call.getData();
            SharedPreferences.Editor edit = getContext().getSharedPreferences("lockedin_home_widgets", 0).edit();
            edit.putInt("streak", Math.max(0, data.optInt("streak", 0)));
            edit.putLong("streak_start_ms", data.optLong("streakStartMs", 0));
            edit.putBoolean("streak_lapsed", data.optBoolean("lapsed", false));
            JSONArray habitData = data.optJSONArray("habits");
            edit.putString("habits", habitData == null ? "[]" : habitData.toString());
            edit.putString("selected_habit_name", data.optString("selectedHabitName", ""));
            edit.apply();
            if (habitData != null) {
                Set<String> availableNames = new HashSet<>();
                for (int i = 0; i < habitData.length(); i++) {
                    JSONObject item = habitData.optJSONObject(i);
                    if (item != null) availableNames.add(item.optString("name", ""));
                }
                android.appwidget.AppWidgetManager manager = android.appwidget.AppWidgetManager.getInstance(getContext());
                android.content.ComponentName provider = new android.content.ComponentName(getContext(), HabitWidgetProvider.class);
                SharedPreferences prefs = getContext().getSharedPreferences("lockedin_home_widgets", 0);
                SharedPreferences.Editor cleanup = prefs.edit();
                boolean changed = false;
                for (int widgetId : manager.getAppWidgetIds(provider)) {
                    String key = "habit_widget_name_" + widgetId;
                    String mapped = prefs.getString(key, null);
                    if (mapped != null && !TextUtils.isEmpty(mapped) && !availableNames.contains(mapped)) {
                        cleanup.putString(key, "");
                        changed = true;
                    }
                }
                if (changed) cleanup.apply();
            }
            updateHomeWidgets();
            call.resolve();
        } catch (Exception error) { call.reject("Could not sync home-screen widgets.", error); }
    }

    @PluginMethod
    public void requestStreakWidget(PluginCall call) { requestHomeWidget(call, "streak"); }

    @PluginMethod
    public void requestHabitWidget(PluginCall call) {
        String name = call.getString("habitName", "");
        if (TextUtils.isEmpty(name)) { call.reject("Choose a habit first."); return; }
        SharedPreferences prefs = getContext().getSharedPreferences("lockedin_home_widgets", 0);
        try {
            JSONArray queue = new JSONArray(prefs.getString("pending_habit_widget_names", "[]"));
            queue.put(name);
            prefs.edit().putString("selected_habit_name", name).putString("pending_habit_widget_names", queue.toString()).apply();
        } catch (JSONException error) { call.reject("Could not queue the selected habit widget.", error); return; }
        requestHomeWidget(call, "habit");
    }

    private void requestHomeWidget(PluginCall call, String kind) {
        try {
            if (android.os.Build.VERSION.SDK_INT < 26) { call.reject("Home-screen widget pinning requires Android 8.0 or newer."); return; }
            android.appwidget.AppWidgetManager manager = android.appwidget.AppWidgetManager.getInstance(getContext());
            if (!manager.isRequestPinAppWidgetSupported()) { call.reject("This launcher does not support adding widgets from the app. Add Locked In from your home-screen widget menu."); return; }
            android.content.ComponentName provider = new android.content.ComponentName(getContext(),
                kind.equals("streak") ? StreakWidgetProvider.class : HabitWidgetProvider.class);
            boolean accepted = manager.requestPinAppWidget(provider, null, null);
            JSObject result = new JSObject(); result.put("pinned", accepted); call.resolve(result);
        } catch (Exception error) { call.reject("Could not open the Android widget picker.", error); }
    }

    @PluginMethod
    public void getPendingWidgetChanges(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences("lockedin_home_widgets", 0);
        String raw = prefs.getString("pending_changes", "[]");
        prefs.edit().putString("pending_changes", "[]").apply();
        JSObject result = new JSObject();
        try { result.put("changes", new JSONArray(raw)); }
        catch (JSONException error) { result.put("changes", new JSONArray()); }
        call.resolve(result);
    }

    private void updateHomeWidgets() {
        android.appwidget.AppWidgetManager manager = android.appwidget.AppWidgetManager.getInstance(getContext());
        android.content.ComponentName streak = new android.content.ComponentName(getContext(), StreakWidgetProvider.class);
        android.content.ComponentName habit = new android.content.ComponentName(getContext(), HabitWidgetProvider.class);
        int[] streakIds = manager.getAppWidgetIds(streak);
        int[] habitIds = manager.getAppWidgetIds(habit);
        if (streakIds.length > 0) new StreakWidgetProvider().onUpdate(getContext(), manager, streakIds);
        if (habitIds.length > 0) new HabitWidgetProvider().onUpdate(getContext(), manager, habitIds);
    }

}
