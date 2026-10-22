package golf.activitee.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativePushContext")
public class NativePushContextPlugin extends Plugin {
    @Override
    public void load() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel("activitee", "ActiviTee", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setShowBadge(true);
            getContext().getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    @PluginMethod
    public void getContext(PluginCall call) {
        int appId = getContext().getResources().getIdentifier("google_app_id", "string", getContext().getPackageName());
        JSObject result = new JSObject();
        result.put("environment", "production");
        result.put("bundleId", getContext().getPackageName());
        result.put("firebaseConfigured", appId != 0 && !getContext().getString(appId).isEmpty());
        call.resolve(result);
    }
}
