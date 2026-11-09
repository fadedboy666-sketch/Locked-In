package PACKAGE_NAME;

import android.app.Activity;
import android.content.Intent;
import android.net.VpnService;
import android.os.Build;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "InternetFilter")
public class InternetFilterPlugin extends Plugin {
    private static final String PREFS = "lockedin_internet_filter";

    @PluginMethod
    public void start(PluginCall call) {
        Intent permissionIntent = VpnService.prepare(getContext());
        if (permissionIntent != null) {
            startActivityForResult(call, permissionIntent, "vpnPermissionResult");
            return;
        }
        startFilterService();
        JSObject result = new JSObject();
        result.put("enabled", true);
        call.resolve(result);
    }

    @ActivityCallback
    private void vpnPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) {
            call.reject("Android VPN permission was not granted. Internet Filter remains off.");
            return;
        }
        startFilterService();
        JSObject response = new JSObject();
        response.put("enabled", true);
        call.resolve(response);
    }

    private void startFilterService() {
        Intent intent = new Intent(getContext(), InternetFilterVpnService.class);
        intent.setAction(InternetFilterVpnService.ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(intent);
        else getContext().startService(intent);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), InternetFilterVpnService.class);
        intent.setAction(InternetFilterVpnService.ACTION_STOP);
        getContext().startService(intent);
        JSObject result = new JSObject();
        result.put("enabled", false);
        call.resolve(result);
    }

    @PluginMethod
    public void status(PluginCall call) {
        boolean enabled = getContext().getSharedPreferences(PREFS, 0).getBoolean("enabled", false);
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }
}
