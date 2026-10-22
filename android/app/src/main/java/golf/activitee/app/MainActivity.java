package golf.activitee.app;

import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private BiometricLockController biometricLock;
    private boolean firstPageLoaded;

    BiometricLockController biometricLock() {
        if (biometricLock == null) biometricLock = new BiometricLockController(this);
        return biometricLock;
    }
    private static final String HIDE_SCROLLBARS = """
        (() => {
            if (document.getElementById('activitee-android-scrollbars')) return;
            const style = document.createElement('style');
            style.id = 'activitee-android-scrollbars';
            style.textContent = '* { scrollbar-width: none !important; }'
                + '*::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }';
            (document.head || document.documentElement).appendChild(style);
        })();
        """;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        long launchStartedAt = SystemClock.elapsedRealtime();
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        // Keep the logo during initial loading, with a bound for offline starts.
        splash.setKeepOnScreenCondition(() -> !firstPageLoaded && SystemClock.elapsedRealtime() - launchStartedAt < 8000);
        registerPlugin(NativePushContextPlugin.class);
        registerPlugin(BiometricLockPlugin.class);
        // Keep this presentation rule inside the Android shell, including on reload.
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                firstPageLoaded = true;
                webView.setVerticalScrollBarEnabled(false);
                webView.evaluateJavascript(HIDE_SCROLLBARS, null);
            }
        });

        super.onCreate(savedInstanceState);
        biometricLock();

        if (bridge != null) {
            // Hide Android's native scroll indicator while keeping touch scrolling.
            bridge.getWebView().setVerticalScrollBarEnabled(false);
            bridge.getWebView().setBackgroundColor(android.graphics.Color.rgb(53, 72, 59));
        }
    }

    @Override public void onResume() {
        super.onResume();
        biometricLock().resume();
    }

    @Override public void onPause() {
        if (biometricLock != null) biometricLock.pause();
        super.onPause();
    }

    @Override public void onStop() {
        if (biometricLock != null) biometricLock.stop();
        super.onStop();
    }

    @Override public void onDestroy() {
        if (biometricLock != null) biometricLock.destroy();
        super.onDestroy();
    }
}
