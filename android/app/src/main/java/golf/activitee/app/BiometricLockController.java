package golf.activitee.app;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.util.AtomicFile;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.json.JSONObject;

/** Main-thread native cover. Stores no password, auth token, or biometric data. */
final class BiometricLockController {
    private static final int GREEN = Color.rgb(53, 72, 59);
    private static final int STRONG = BiometricManager.Authenticators.BIOMETRIC_STRONG;
    private final MainActivity activity;
    private final BiometricLockState state;
    private final AtomicFile preferenceFile;
    private final ActivityResultLauncher<Intent> credentialLauncher;
    private String locale = "fr";
    private boolean inactive = true;
    private boolean attemptedAutomatically;
    private FrameLayout cover;
    private Button unlockButton;
    private Button passcodeButton;
    private TextView feedback;
    private String feedbackKey;
    private BiometricPrompt prompt;
    private boolean authenticating;
    private boolean credentialFlow;
    private long operation;
    private int attemptGeneration;
    private Boolean requestedEnabled;
    private String requestedUserID;
    private PluginCall pendingCall;

    BiometricLockController(MainActivity activity) {
        this.activity = activity;
        // A device-local preference must not be restored onto a different phone.
        preferenceFile = new AtomicFile(new File(activity.getNoBackupFilesDir(), "biometric-lock.json"));
        String owner = null;
        try {
            JSONObject saved = new JSONObject(new String(preferenceFile.readFully(), StandardCharsets.UTF_8));
            owner = saved.optString("owner", null);
            locale = saved.optString("locale", "fr");
        } catch (Exception ignored) { /* First use: opt-in is disabled. */ }
        state = new BiometricLockState(owner);
        credentialLauncher = activity.registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result ->
            finish(result.getResultCode() == Activity.RESULT_OK, "CANCELLED", operation));
        refreshCover();
    }

    JSObject status() {
        JSObject result = new JSObject();
        result.put("enabled", state.enabled());
        result.put("locked", state.locked());
        result.put("available", biometricAvailable());
        // Android chooses its supported face/fingerprint method; these are not Apple Face ID.
        result.put("biometryType", "biometric");
        return result;
    }

    private boolean biometricAvailable() {
        return BiometricManager.from(activity).canAuthenticate(STRONG) == BiometricManager.BIOMETRIC_SUCCESS;
    }

    private boolean deviceSecure() { return activity.getSystemService(KeyguardManager.class).isDeviceSecure(); }

    void configure(String userID, boolean enabled, String language, PluginCall call) {
        if (inactive || authenticating || !state.canConfigure(userID)) { call.reject("Device is locked", "LOCKED"); return; }
        locale = language;
        if (enabled && !biometricAvailable()) { call.reject("Biometrics unavailable", "UNAVAILABLE"); return; }
        authenticate(userID, enabled, call);
    }

    void synchronize(String userID, String language) {
        locale = language;
        state.synchronizeUser(userID);
        persist();
        refreshCover();
    }

    void resume() {
        inactive = false;
        refreshCover();
        if (state.locked() && !attemptedAutomatically && !authenticating) {
            attemptedAutomatically = true;
            unlock();
        }
    }

    void pause() {
        inactive = true;
        refreshCover(); // Conceal the WebView before Android takes the app-switcher snapshot.
    }

    void stop() {
        // A system PIN/pattern screen legitimately stops this Activity. Its result
        // must be delivered before another prompt can start. Enrollment never uses it.
        if (authenticating && credentialFlow) {
            state.coverForSystemAuthentication();
            refreshCover();
            return;
        }
        state.background();
        attemptedAutomatically = false;
        cancelPending();
        refreshCover();
    }

    void destroy() { cancelPending(); }

    private void cancelPending() {
        operation++;
        if (prompt != null) prompt.cancelAuthentication();
        prompt = null;
        authenticating = false;
        credentialFlow = false;
        if (pendingCall != null) pendingCall.reject("Verification cancelled", "CANCELLED");
        pendingCall = null;
    }

    private void unlock() {
        if (inactive || !state.locked() || authenticating) return;
        attemptedAutomatically = true;
        authenticate(null, null, null);
    }

    private void authenticate(String userID, Boolean enabled, PluginCall call) {
        boolean enrollment = Boolean.TRUE.equals(enabled);
        boolean available = biometricAvailable();
        if (!available && (enrollment || !deviceSecure())) {
            if (call != null) call.reject("Device authentication unavailable", "UNAVAILABLE");
            feedbackKey = "biometric_unavailable";
            refreshCover();
            return;
        }
        final long id = ++operation;
        attemptGeneration = state.generation();
        requestedUserID = userID;
        requestedEnabled = enabled;
        pendingCall = call;
        authenticating = true;
        credentialFlow = !enrollment && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R;
        feedbackKey = null;
        if (!available && Build.VERSION.SDK_INT < Build.VERSION_CODES.R) { launchCredential(id); return; }
        prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), new BiometricPrompt.AuthenticationCallback() {
            @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) { finish(true, null, id); }
            @Override public void onAuthenticationError(int code, CharSequence message) {
                if (id != operation || !authenticating) return;
                if (!enrollment && code == BiometricPrompt.ERROR_NEGATIVE_BUTTON && deviceSecure()) { launchCredential(id); return; }
                boolean cancelled = code == BiometricPrompt.ERROR_USER_CANCELED || code == BiometricPrompt.ERROR_CANCELED
                    || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON;
                finish(false, cancelled ? "CANCELLED" : "UNAVAILABLE", id);
            }
            @Override public void onAuthenticationFailed() {
                // A non-match is not success; Android keeps its prompt open for retry.
            }
        });
        int authenticators = credentialFlow ? STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL : STRONG;
        BiometricPrompt.PromptInfo.Builder info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle("ActiviTee")
            .setSubtitle(text(enrollment ? "biometric_enable_reason" : enabled != null ? "biometric_disable_reason" : "biometric_unlock_reason"))
            .setAllowedAuthenticators(authenticators);
        if (!credentialFlow) info.setNegativeButtonText(text(!enrollment && deviceSecure() ? "biometric_passcode" : "biometric_cancel"));
        try { prompt.authenticate(info.build()); }
        catch (RuntimeException e) { finish(false, "UNAVAILABLE", id); }
        refreshCover();
    }

    @SuppressWarnings("deprecation")
    private void launchCredential(long id) {
        if (id != operation || !authenticating) return;
        Intent intent = activity.getSystemService(KeyguardManager.class).createConfirmDeviceCredentialIntent("ActiviTee", text("biometric_unlock_reason"));
        if (intent == null) { finish(false, "UNAVAILABLE", id); return; }
        credentialFlow = true;
        try { credentialLauncher.launch(intent); }
        catch (RuntimeException e) { finish(false, "UNAVAILABLE", id); }
        refreshCover();
    }

    private void finish(boolean success, String error, long id) {
        if (id != operation || !authenticating) return;
        success = success && attemptGeneration == state.generation() && (!inactive || credentialFlow);
        authenticating = false;
        credentialFlow = false;
        prompt = null;
        PluginCall call = pendingCall;
        pendingCall = null;
        if (success) {
            if (requestedEnabled != null) state.configure(requestedUserID, requestedEnabled);
            else success = state.completeUnlock(true, attemptGeneration);
            if (success) persist();
        }
        feedbackKey = success ? null : "CANCELLED".equals(error) ? "biometric_cancelled" : "biometric_unavailable";
        refreshCover();
        if (call != null) {
            if (success) call.resolve(status());
            else call.reject("Device verification could not be completed", error == null ? "CANCELLED" : error);
        }
    }

    private void persist() {
        FileOutputStream stream = null;
        try {
            JSONObject value = new JSONObject();
            value.put("owner", state.ownerID() == null ? JSONObject.NULL : state.ownerID());
            value.put("locale", locale);
            stream = preferenceFile.startWrite();
            stream.write(value.toString().getBytes(StandardCharsets.UTF_8));
            preferenceFile.finishWrite(stream);
        } catch (Exception e) {
            if (stream != null) preferenceFile.failWrite(stream);
        }
    }

    private String text(String key) {
        String language = "en".equals(locale) || "de".equals(locale) || "it".equals(locale) ? locale : "fr";
        Configuration config = new Configuration(activity.getResources().getConfiguration());
        config.setLocale(Locale.forLanguageTag(language));
        Context localized = activity.createConfigurationContext(config);
        int identifier = activity.getResources().getIdentifier(key, "string", activity.getPackageName());
        return localized.getString(identifier);
    }

    private int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }

    private void refreshCover() {
        boolean concealed = state.enabled() && (state.locked() || inactive);
        if (activity.getBridge() != null) {
            View web = activity.getBridge().getWebView();
            web.setVisibility(concealed ? View.INVISIBLE : View.VISIBLE);
            web.setImportantForAccessibility(concealed ? View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS : View.IMPORTANT_FOR_ACCESSIBILITY_AUTO);
        }
        FrameLayout root = activity.findViewById(android.R.id.content);
        if (!concealed) {
            if (cover != null) root.removeView(cover);
            cover = null;
            return;
        }
        if (cover == null) {
            activity.getSystemService(InputMethodManager.class).hideSoftInputFromWindow(root.getWindowToken(), 0);
            cover = new FrameLayout(activity);
            cover.setBackgroundColor(GREEN);
            cover.setClickable(true);
            cover.setFocusableInTouchMode(true);
            LinearLayout stack = new LinearLayout(activity);
            stack.setOrientation(LinearLayout.VERTICAL);
            stack.setGravity(Gravity.CENTER);
            stack.setPadding(dp(24), dp(24), dp(24), dp(24));
            ImageView logo = new ImageView(activity);
            logo.setImageResource(R.drawable.activitee_wordmark);
            logo.setContentDescription("ActiviTee");
            logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
            LinearLayout.LayoutParams logoLayout = new LinearLayout.LayoutParams(dp(240), dp(67));
            logoLayout.bottomMargin = dp(24);
            stack.addView(logo, logoLayout);
            unlockButton = new Button(activity);
            unlockButton.setTextColor(Color.BLACK);
            unlockButton.setTextSize(16);
            unlockButton.setTypeface(null, Typeface.BOLD);
            unlockButton.setAllCaps(false);
            GradientDrawable background = new GradientDrawable();
            background.setColor(Color.WHITE);
            background.setCornerRadius(dp(14));
            unlockButton.setBackground(background);
            unlockButton.setOnClickListener(v -> unlock());
            stack.addView(unlockButton, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));
            passcodeButton = new Button(activity);
            passcodeButton.setTextColor(Color.WHITE);
            passcodeButton.setAllCaps(false);
            passcodeButton.setBackgroundColor(Color.TRANSPARENT);
            passcodeButton.setOnClickListener(v -> {
                if (inactive || authenticating || !state.locked() || !deviceSecure()) return;
                operation++;
                attemptGeneration = state.generation();
                requestedEnabled = null;
                requestedUserID = null;
                pendingCall = null;
                authenticating = true;
                launchCredential(operation);
            });
            stack.addView(passcodeButton, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            feedback = new TextView(activity);
            feedback.setTextColor(Color.WHITE);
            feedback.setGravity(Gravity.CENTER);
            feedback.setPadding(0, dp(12), 0, 0);
            feedback.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
            stack.addView(feedback);
            FrameLayout.LayoutParams centered = new FrameLayout.LayoutParams(Math.min(dp(360), activity.getResources().getDisplayMetrics().widthPixels), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
            cover.addView(stack, centered);
            root.addView(cover, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            cover.requestFocus();
        }
        cover.bringToFront();
        unlockButton.setText(text(authenticating ? "biometric_checking" : "biometric_unlock"));
        unlockButton.setEnabled(!inactive && !authenticating);
        passcodeButton.setText(text("biometric_passcode"));
        passcodeButton.setVisibility(deviceSecure() ? View.VISIBLE : View.GONE);
        passcodeButton.setEnabled(!inactive && !authenticating);
        feedback.setText(feedbackKey == null ? "" : text(feedbackKey));
    }
}
