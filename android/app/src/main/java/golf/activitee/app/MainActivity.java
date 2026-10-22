package golf.activitee.app;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
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
        registerPlugin(NativePushContextPlugin.class);
        // Keep this presentation rule inside the Android shell, including on reload.
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                webView.setVerticalScrollBarEnabled(false);
                webView.evaluateJavascript(HIDE_SCROLLBARS, null);
            }
        });

        super.onCreate(savedInstanceState);

        if (bridge != null) {
            // Hide Android's native scroll indicator while keeping touch scrolling.
            bridge.getWebView().setVerticalScrollBarEnabled(false);
        }
    }
}
