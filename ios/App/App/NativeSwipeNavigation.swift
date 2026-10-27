import Capacitor
import WebKit

@objc(NativeSwipeNavigationPlugin)
public class NativeSwipeNavigationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeSwipeNavigationPlugin"
    public let jsName = "NativeSwipeNavigation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setPolicy", returnType: CAPPluginReturnPromise)
    ]
    private var policy: NativeSwipePolicy?
    private var observations: [NSKeyValueObservation] = []

    override public func load() {
        guard let webView else { return }
        webView.allowsBackForwardNavigationGestures = false
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
            call.resolve()
        }
    }

    private func refresh() {
        guard let webView, let serverURL = bridge?.config.serverURL else { return }
        webView.allowsBackForwardNavigationGestures = !webView.isLoading && (policy?.allowsGestures(
            currentURL: webView.url,
            serverURL: serverURL,
            backURL: webView.backForwardList.backItem?.url,
            forwardURL: webView.backForwardList.forwardItem?.url
        ) ?? false)
    }
}
