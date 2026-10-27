import Foundation

/// WebKit exposes one switch for BOTH directions. Disable it whenever an
/// available direction could cross the web app's bounded history.
struct NativeSwipePolicy {
    let href: URL
    let enabled: Bool
    let canGoBack: Bool
    let canGoForward: Bool

    static func isAppURL(_ url: URL, serverURL: URL) -> Bool {
        guard url.scheme == serverURL.scheme, url.host == serverURL.host,
              url.port == serverURL.port else { return false }
        let segments = url.path.split(separator: "/")
        guard let role = segments.first,
              ["player", "parent", "coach", "manager", "admin"].contains(String(role)) else { return false }
        return !segments.dropFirst().contains { ["new", "edit", "settings", "profile"].contains(String($0)) }
    }

    func allowsGestures(currentURL: URL?, serverURL: URL, backURL: URL?, forwardURL: URL?) -> Bool {
        guard enabled, let currentURL, currentURL == href,
              Self.isAppURL(currentURL, serverURL: serverURL) else { return false }
        if let backURL, (!canGoBack || !Self.isAppURL(backURL, serverURL: serverURL)) { return false }
        if let forwardURL, (!canGoForward || !Self.isAppURL(forwardURL, serverURL: serverURL)) { return false }
        return (canGoBack && backURL != nil) || (canGoForward && forwardURL != nil)
    }
}
