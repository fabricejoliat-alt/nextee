import Foundation

let server = URL(string: "https://activitee.app")!
let home = URL(string: "https://activitee.app/player")!
let detail = URL(string: "https://activitee.app/player/om?child_id=example")!
func policy(_ url: URL = detail, enabled: Bool = true, back: Bool = true, forward: Bool = false) -> NativeSwipePolicy {
    NativeSwipePolicy(href: url, enabled: enabled, canGoBack: back, canGoForward: forward)
}
func allowed(_ value: NativeSwipePolicy, current: URL? = detail, back: URL? = home, forward: URL? = nil) -> Bool {
    value.allowsGestures(currentURL: current, serverURL: server, backURL: back, forwardURL: forward)
}
assert(allowed(policy()))
assert(!allowed(policy(enabled: false))) // Focused input, form or modal.
assert(!allowed(policy(), current: home)) // A delayed policy from the previous route.
assert(!allowed(policy(), back: nil)) // Initial history entry.
assert(!allowed(policy(back: false))) // WebKit has older entries outside this session.
assert(!allowed(policy(), back: server)) // Login page.
assert(!allowed(policy(), back: URL(string: "https://external.example/player")!))
assert(!allowed(policy(), back: URL(string: "http://activitee.app/player")!))
assert(!allowed(policy(), back: URL(string: "https://activitee.app:444/player")!))
assert(!allowed(policy(), back: URL(string: "https://activitee.app/player-other")!))
assert(!allowed(policy(), back: URL(string: "https://activitee.app/player/profile")!))
assert(!allowed(policy(), forward: URL(string: "https://activitee.app/reset-password")!))
assert(!allowed(policy(), forward: home)) // Forward exists natively, but not in our owned history.
assert(allowed(policy(back: false, forward: true), back: nil, forward: home))
assert(allowed(policy(forward: true), forward: home))
for path in ["/player/golf/rounds/new", "/coach/players/example/edit", "/manager/settings", "/player/profile"] {
    let url = URL(string: "https://activitee.app" + path)!
    assert(!allowed(policy(url), current: url))
}
assert(!allowed(policy(), current: nil))
print("Native swipe policy: 20 boundary, form and navigation checks passed")
