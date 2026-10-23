package golf.activitee.app;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.core.view.ViewCompat;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.Locale;

/** Native fallback: remains available even when the hosted application cannot load. */
final class OfflineScreenController {
    private final MainActivity activity;
    private final WebView webView;
    private final ConnectivityManager connectivity;
    private final String home;
    private final FrameLayout container;
    private final TextView title;
    private final TextView message;
    private final Button retryButton;
    private final ConnectivityManager.NetworkCallback callback;
    private String retryUrl;
    private boolean visible;
    private boolean failed;
    private boolean loading;
    private boolean destroyed;
    private boolean registered;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable retryTimeout = this::timeout;

    private void timeout() {
        if (!destroyed && visible && loading) {
            webView.stopLoading();
            failed(retryUrl);
        }
    }

    OfflineScreenController(MainActivity activity, WebView webView, String home) {
        this.activity = activity;
        this.webView = webView;
        this.home = home == null ? "https://activitee.app" : home;
        this.retryUrl = this.home;
        connectivity = activity.getSystemService(ConnectivityManager.class);
        container = new FrameLayout(activity);
        container.setBackgroundColor(activity.getColor(R.color.activitee_green));
        container.setClickable(true);
        container.setFocusableInTouchMode(true);
        container.setVisibility(View.GONE);
        ScrollView scroll = new ScrollView(activity);
        scroll.setFillViewport(true);
        LinearLayout stack = new LinearLayout(activity);
        stack.setOrientation(LinearLayout.VERTICAL);
        stack.setGravity(Gravity.CENTER);
        stack.setPadding(dp(32), dp(48), dp(32), dp(48));
        ImageView logo = new ImageView(activity);
        logo.setImageResource(R.drawable.activitee_wordmark);
        logo.setContentDescription("ActiviTee");
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        LinearLayout.LayoutParams logoSize = new LinearLayout.LayoutParams(dp(240), dp(67));
        logoSize.bottomMargin = dp(44);
        stack.addView(logo, logoSize);
        title = new TextView(activity);
        title.setTextColor(Color.WHITE);
        title.setTextSize(25);
        title.setTypeface(null, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        ViewCompat.setAccessibilityHeading(title, true);
        stack.addView(title);
        message = new TextView(activity);
        message.setTextColor(Color.rgb(229, 236, 227));
        message.setTextSize(16);
        message.setGravity(Gravity.CENTER);
        message.setLineSpacing(dp(4), 1);
        LinearLayout.LayoutParams messageSize = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        messageSize.topMargin = dp(16);
        messageSize.bottomMargin = dp(32);
        stack.addView(message, messageSize);
        retryButton = new Button(activity);
        retryButton.setAllCaps(false);
        retryButton.setTextSize(16);
        retryButton.setTextColor(activity.getColor(R.color.activitee_green));
        retryButton.setTypeface(null, Typeface.BOLD);
        GradientDrawable buttonBackground = new GradientDrawable();
        buttonBackground.setColor(Color.WHITE);
        buttonBackground.setCornerRadius(dp(16));
        retryButton.setBackground(buttonBackground);
        retryButton.setOnClickListener(v -> retry());
        stack.addView(retryButton, new LinearLayout.LayoutParams(dp(240), dp(56)));
        scroll.addView(stack);
        container.addView(scroll);
        // A sibling of the WebView, below the separate biometric privacy cover.
        ((ViewGroup) webView.getParent()).addView(container, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        callback = new ConnectivityManager.NetworkCallback() {
            @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) {
                if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
                    activity.runOnUiThread(() -> { if (!destroyed && visible && !loading) retry(); });
                }
            }
        };
        try { connectivity.registerDefaultNetworkCallback(callback); registered = true; }
        catch (RuntimeException ignored) { /* Manual retry is always available. */ }
    }

    void started(String url) {
        failed = false;
        if (trusted(url)) retryUrl = url;
    }

    void failed(String url) {
        handler.removeCallbacks(retryTimeout);
        failed = true;
        loading = false;
        if (trusted(url)) retryUrl = url;
        visible = true;
        render();
        container.setVisibility(View.VISIBLE);
        webView.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
    }

    void committed(String url) {
        if (failed || !trusted(url)) return;
        handler.removeCallbacks(retryTimeout);
        loading = false;
        visible = false;
        container.setVisibility(View.GONE);
        activity.biometricLock().refreshPresentation();
    }

    private boolean trusted(String url) {
        if (url == null) return false;
        Uri target = Uri.parse(url), origin = Uri.parse(home);
        return origin.getScheme().equals(target.getScheme()) && origin.getHost().equals(target.getHost()) && origin.getPort() == target.getPort();
    }

    private void retry() {
        if (destroyed || loading) return;
        loading = true;
        render();
        // Keep the fallback covering the browser until a real page commits.
        webView.loadUrl(retryUrl);
        handler.postDelayed(retryTimeout, 20000);
    }

    private void render() {
        Configuration config = new Configuration(activity.getResources().getConfiguration());
        config.setLocale(Locale.forLanguageTag(activity.biometricLock().language()));
        Context localized = activity.createConfigurationContext(config);
        title.setText(localized.getString(R.string.offline_title));
        message.setText(localized.getString(R.string.offline_message));
        retryButton.setText(localized.getString(loading ? R.string.offline_retrying : R.string.offline_retry));
        retryButton.setEnabled(!loading);
        retryButton.setAlpha(loading ? .65f : 1f);
    }

    void destroy() {
        destroyed = true;
        handler.removeCallbacks(retryTimeout);
        if (registered) connectivity.unregisterNetworkCallback(callback);
    }

    private int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }
}
