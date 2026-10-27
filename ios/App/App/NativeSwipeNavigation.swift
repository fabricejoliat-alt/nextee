import Capacitor
import WebKit
import UIKit

@objc(NativeSwipeNavigationPlugin)
public class NativeSwipeNavigationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeSwipeNavigationPlugin"
    public let jsName = "NativeSwipeNavigation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setPolicy", returnType: CAPPluginReturnPromise)
    ]
    private var policy: NativeSwipePolicy?
    private var navigationGestures: [UIGestureRecognizer] = []
    private var observations: [NSKeyValueObservation] = []

    override public func load() {
        guard let webView else { return }
        // This flag also controls WebKit's history snapshot recording. Keeping
        // it off on the first page leaves the first Back transition blank.
        // Discover only the recognizers installed by this public API, then gate
        // those independently; leave its inactive alternative recognizers alone.
        // Never replace WebKit's gesture delegates.
        let existing = Set((webView.gestureRecognizers ?? []).map(ObjectIdentifier.init))
        webView.allowsBackForwardNavigationGestures = true
        navigationGestures = (webView.gestureRecognizers ?? []).filter {
            !existing.contains(ObjectIdentifier($0)) && $0.isEnabled
        }
        // Fail closed on an OS where the expected recognizers aren't installed.
        if navigationGestures.count < 2 {
            navigationGestures = []
            webView.allowsBackForwardNavigationGestures = false
        }
        refresh()
        // Disable immediately when the URL changes; re-enable only after the
        // hosted app confirms the new route, history boundary and form state.
        observations = [
            webView.observe(\.url, options: [.new]) { [weak self] _, _ in self?.refresh() },
            webView.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in self?.refresh() },
            webView.observe(\.canGoForward, options: [.new]) { [weak self] _, _ in self?.refresh() },
            webView.observe(\.isLoading, options: [.new]) { [weak self] _, _ in self?.refresh() }
        ]
    }

    @objc func setPolicy(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let href = call.getString("href"), let url = URL(string: href),
                  let enabled = call.getBool("enabled"), let back = call.getBool("canGoBack"),
                  let forward = call.getBool("canGoForward") else {
                call.reject("Invalid native swipe policy")
                return
            }
            self.policy = NativeSwipePolicy(href: url, enabled: enabled, canGoBack: back, canGoForward: forward)
            self.refresh()
            #if DEBUG
            call.resolve([
                "snapshotRecording": self.webView?.allowsBackForwardNavigationGestures ?? false,
                "navigationGestureCount": self.navigationGestures.count,
                "navigationGesturesEnabled": self.navigationGestures.map(\.isEnabled)
            ])
            #else
            call.resolve()
            #endif
        }
    }

    private func refresh() {
        guard let webView, let serverURL = bridge?.config.serverURL else { return }
        let allowed = !webView.isLoading && (policy?.allowsGestures(
            currentURL: webView.url,
            serverURL: serverURL,
            backURL: webView.backForwardList.backItem?.url,
            forwardURL: webView.backForwardList.forwardItem?.url
        ) ?? false)
        if navigationGestures.isEmpty {
            webView.allowsBackForwardNavigationGestures = allowed
        } else {
            for gesture in navigationGestures where gesture.isEnabled != allowed {
                gesture.isEnabled = allowed
            }
        }
    }
}
