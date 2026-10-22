package golf.activitee.app;

import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.UUID;

@CapacitorPlugin(name = "BiometricLock")
public class BiometricLockPlugin extends Plugin {
    private boolean trustedOrigin(PluginCall call) {
        String actualURL = getBridge().getWebView().getUrl();
        String expectedURL = getBridge().getConfig().getServerUrl();
        if (actualURL != null && expectedURL != null) {
            Uri actual = Uri.parse(actualURL);
            Uri expected = Uri.parse(expectedURL);
            if (expected.getScheme() != null && expected.getHost() != null
                && expected.getScheme().equals(actual.getScheme())
                && expected.getHost().equals(actual.getHost()) && expected.getPort() == actual.getPort()) return true;
        }
        call.reject("Unavailable origin", "UNAVAILABLE");
        return false;
    }

    private boolean validUser(String value) {
        try { return value != null && UUID.fromString(value).toString().equalsIgnoreCase(value); }
        catch (IllegalArgumentException e) { return false; }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (trustedOrigin(call)) call.resolve(((MainActivity) getActivity()).biometricLock().status());
        });
    }

    @PluginMethod
    public void configure(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!trustedOrigin(call)) return;
            String userID = call.getString("userID");
            Boolean enabled = call.getBoolean("enabled");
            if (!validUser(userID) || enabled == null) { call.reject("Invalid arguments", "INVALID_ARGUMENT"); return; }
            ((MainActivity) getActivity()).biometricLock().configure(userID, enabled, call.getString("locale", "fr"), call);
        });
    }

    @PluginMethod
    public void syncSession(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!trustedOrigin(call)) return;
            String userID = call.getString("userID");
            if (userID != null && !validUser(userID)) { call.reject("Invalid user", "INVALID_ARGUMENT"); return; }
            ((MainActivity) getActivity()).biometricLock().synchronize(userID, call.getString("locale", "fr"));
            call.resolve();
        });
    }
}
