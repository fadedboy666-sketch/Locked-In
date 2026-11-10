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
                String label = String.valueOf(info.loadLabel(pm));
                JSObject item = new JSObject();
                item.put("name", label);
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
            call.reject("Could not read installed apps: " + error.getMessage());
        }
    }

    private String drawableToBase64(Drawable drawable) {
        int width = drawable.getIntrinsicWidth();
        int height = drawable.getIntrinsicHeight();
        if (width <= 0) width = 96;
        if (height <= 0) height = 96;
        float scale = Math.min(1f, 96f / Math.max(width, height));
        width = Math.max(1, (int)(width * scale));
        height = Math.max(1, (int)(height * scale));
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        drawable.setBounds(0, 0, width, height);
        drawable.draw(canvas);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.PNG, 85, output);
        bitmap.recycle();
        return android.util.Base64.encodeToString(output.toByteArray(), android.util.Base64.NO_WRAP);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
        JSObject result = new JSObject();
        result.put("blockedPackages", readBlocked(prefs));
        result.put("manualEnabled", prefs.getBoolean(KEY_MANUAL, false));
        result.put("sessionActive", prefs.getBoolean(KEY_SESSION, false));
        result.put("enabled", prefs.getBoolean(KEY_MANUAL, false) || prefs.getBoolean(KEY_SESSION, false));
        result.put("accessibilityEnabled", isServiceEnabled());
        call.resolve(result);
    }

    @PluginMethod
    public void setBlockedApps(PluginCall call) {
        JSArray packages = call.getArray("packages");
        if (packages == null) packages = new JSArray();
        JSONArray clean = new JSONArray();
        if (packages != null) {
            for (int i = 0; i < packages.length(); i++) {
                String value = packages.optString(i, "");
                if (!TextUtils.isEmpty(value) && value.matches("[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)+") && !value.equals(getContext().getPackageName())) {
                    if (!contains(clean, value)) clean.put(value);
                }
            }
        }
        getContext().getSharedPreferences(PREFS, 0).edit().putString(KEY_BLOCKED, clean.toString()).apply();
        call.resolve(statusObject());
    }

    @PluginMethod
    public void setManualEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        getContext().getSharedPreferences(PREFS, 0).edit().putBoolean(KEY_MANUAL, enabled).apply();
        call.resolve(statusObject());
    }

    @PluginMethod
    public void setSessionActive(PluginCall call) {
        boolean active = call.getBoolean("active", false);
        getContext().getSharedPreferences(PREFS, 0).edit().putBoolean(KEY_SESSION, active).apply();
        call.resolve(statusObject());
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open Accessibility settings.", error);
        }
    }

    private JSObject statusObject() {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
        JSObject result = new JSObject();
        result.put("blockedPackages", readBlocked(prefs));
        result.put("manualEnabled", prefs.getBoolean(KEY_MANUAL, false));
        result.put("sessionActive", prefs.getBoolean(KEY_SESSION, false));
        result.put("enabled", prefs.getBoolean(KEY_MANUAL, false) || prefs.getBoolean(KEY_SESSION, false));
        result.put("accessibilityEnabled", isServiceEnabled());
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
        while (splitter.hasNext()) if (component.equals(ComponentName.unflattenFromString(splitter.next()))) return true;
        return false;
    }
}
