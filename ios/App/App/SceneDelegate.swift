import UIKit
import WebKit
import Capacitor

private class BrandedBridgeViewController: CAPBridgeViewController {
    private var launchOverlay: UIImageView?
    private var loadingObservation: NSKeyValueObservation?

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        let webView = super.webView(with: frame, configuration: configuration)
        let launchColor = UIColor(red: 53 / 255, green: 72 / 255, blue: 59 / 255, alpha: 1)
        webView.isOpaque = false
        webView.backgroundColor = launchColor
        webView.scrollView.backgroundColor = launchColor
        return webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        let overlay = UIImageView(image: UIImage(named: "Splash"))
        overlay.translatesAutoresizingMaskIntoConstraints = false
        overlay.contentMode = .scaleAspectFit
        overlay.clipsToBounds = true
        overlay.backgroundColor = UIColor(red: 53 / 255, green: 72 / 255, blue: 59 / 255, alpha: 1)
        view.addSubview(overlay)
        NSLayoutConstraint.activate([
            overlay.topAnchor.constraint(equalTo: view.topAnchor),
            overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        launchOverlay = overlay

        // Keep the branded image visible until the first page has loaded.
        loadingObservation = webView?.observe(\.estimatedProgress, options: [.new]) { [weak self] webView, _ in
            guard webView.estimatedProgress >= 1 else { return }
            DispatchQueue.main.async { self?.hideLaunchOverlay() }
        }

        // A failed or unreachable development server must not leave an overlay forever.
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            self?.hideLaunchOverlay()
        }
    }

    private func hideLaunchOverlay() {
        guard let overlay = launchOverlay else { return }
        launchOverlay = nil
        loadingObservation = nil
        UIView.animate(withDuration: 0.2, animations: {
            overlay.alpha = 0
        }, completion: { _ in
            overlay.removeFromSuperview()
        })
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = BrandedBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
