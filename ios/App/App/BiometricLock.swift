import UIKit
import LocalAuthentication
import Capacitor

/// All access is on the main queue. No password, token or biometric data is stored here.
final class BiometricLockController {
    static let shared = BiometricLockController()
    private let ownerKey = "activitee.biometric-lock.owner.v1"
    private let localeKey = "activitee.biometric-lock.locale.v1"
    private var state: BiometricLockState
    private var locale: String
    private weak var window: UIWindow?
    private var cover: UIView?
    private var unlockButton: UIButton?
    private var context: LAContext?
    private var attemptedAutomatically = false
    private var inactive = true

    private init() {
        state = BiometricLockState(ownerID: UserDefaults.standard.string(forKey: "activitee.biometric-lock.owner.v1"))
        locale = UserDefaults.standard.string(forKey: "activitee.biometric-lock.locale.v1")
            ?? Locale.preferredLanguages.first.map { String($0.prefix(2)) } ?? "fr"
    }

    private func text(_ key: String) -> String {
        let path = Bundle.main.path(forResource: ["fr", "en", "de", "it"].contains(locale) ? locale : "fr", ofType: "lproj")
        let bundle = path.flatMap(Bundle.init(path:)) ?? Bundle.main
        return bundle.localizedString(forKey: key, value: nil, table: "BiometricLock")
    }

    private func persist() {
        if let owner = state.ownerID { UserDefaults.standard.set(owner, forKey: ownerKey) }
        else { UserDefaults.standard.removeObject(forKey: ownerKey) }
        UserDefaults.standard.set(locale, forKey: localeKey)
    }

    func attach(to window: UIWindow) {
        self.window = window
        refreshCover()
    }

    func resignActive() {
        inactive = true
        refreshCover() // Conceal content before the app switcher captures a snapshot.
    }

    func enterBackground() {
        state.background()
        attemptedAutomatically = false
        context?.invalidate()
        context = nil
        refreshCover()
    }

    func becomeActive() {
        inactive = false
        refreshCover()
        if state.locked && !attemptedAutomatically && context == nil {
            attemptedAutomatically = true
            unlock()
        }
    }

    func synchronize(userID: String?, language: String) {
        locale = ["fr", "en", "de", "it"].contains(language) ? language : "fr"
        state.synchronizeUser(userID)
        persist()
        refreshCover()
    }

    func status() -> [String: Any] {
        let check = LAContext()
        var error: NSError?
        let available = check.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        let type = check.biometryType == .faceID ? "faceID" : check.biometryType == .touchID ? "touchID" : "none"
        return ["enabled": state.enabled, "available": available, "biometryType": type, "locked": state.locked]
    }

    func configure(userID: String, enabled: Bool, language: String, completion: @escaping (String?) -> Void) {
        guard !state.locked, !inactive, context == nil else { completion("LOCKED"); return }
        locale = ["fr", "en", "de", "it"].contains(language) ? language : "fr"
        let auth = LAContext()
        let policy: LAPolicy = enabled ? .deviceOwnerAuthenticationWithBiometrics : .deviceOwnerAuthentication
        var error: NSError?
        guard auth.canEvaluatePolicy(policy, error: &error) else { completion("UNAVAILABLE"); return }
        let generation = state.generation
        context = auth
        auth.localizedCancelTitle = text("cancel")
        // Enrollment requires biometrics. Unlocking/disabling also accepts the device passcode.
        if enabled { auth.localizedFallbackTitle = "" }
        auth.evaluatePolicy(policy, localizedReason: text(enabled ? "enableReason" : "disableReason")) { [weak self] success, error in
            DispatchQueue.main.async {
                guard let self else { completion("CANCELLED"); return }
                guard self.context === auth, self.state.generation == generation else {
                    completion("CANCELLED"); return
                }
                self.context = nil
                guard success else { completion(self.errorCode(error)); return }
                self.state.configure(userID: userID, enabled: enabled)
                self.persist()
                self.refreshCover()
                completion(nil)
            }
        }
    }

    private func errorCode(_ error: Error?) -> String {
        let code = (error as? LAError)?.code
        if code == .userCancel || code == .systemCancel || code == .appCancel { return "CANCELLED" }
        if code == .biometryLockout || code == .biometryNotAvailable || code == .biometryNotEnrolled || code == .passcodeNotSet {
            return "UNAVAILABLE"
        }
        return "AUTHENTICATION_FAILED"
    }

    @objc private func unlock() {
        guard state.locked, context == nil, !inactive else { return }
        attemptedAutomatically = true
        let auth = LAContext()
        var error: NSError?
        guard auth.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            refreshCover()
            return
        }
        auth.localizedCancelTitle = text("cancel")
        auth.localizedFallbackTitle = text("passcode")
        let generation = state.generation
        context = auth
        refreshCover()
        auth.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: text("unlockReason")) { [weak self] success, error in
            DispatchQueue.main.async {
                guard let self, self.context === auth else { return }
                self.context = nil
                if self.state.completeUnlock(success: success, generation: generation) {
                    self.persist()
                }
                self.refreshCover()
            }
        }
    }

    private func refreshCover() {
        guard let window else { return }
        let concealed = state.enabled && (state.locked || inactive)
        window.rootViewController?.view.accessibilityElementsHidden = concealed
        window.rootViewController?.view.isUserInteractionEnabled = !concealed
        guard concealed else {
            cover?.removeFromSuperview()
            cover = nil
            unlockButton = nil
            return
        }
        if cover == nil {
            window.endEditing(true)
            let panel = UIView()
            panel.translatesAutoresizingMaskIntoConstraints = false
            panel.backgroundColor = UIColor(red: 0.208, green: 0.282, blue: 0.231, alpha: 1)
            panel.accessibilityViewIsModal = true
            let stack = UIStackView()
            stack.axis = .vertical
            stack.spacing = 22
            stack.alignment = .fill
            stack.translatesAutoresizingMaskIntoConstraints = false
            let icon = UIImageView(image: UIImage(systemName: "lock.shield"))
            icon.tintColor = .white
            icon.contentMode = .scaleAspectFit
            icon.heightAnchor.constraint(equalToConstant: 52).isActive = true
            // Vector outlines match the header's Inter Tight weights and proportions.
            let title = UIImageView(image: UIImage(named: "ActiviTeeWordmark"))
            title.contentMode = .scaleAspectFit
            title.heightAnchor.constraint(equalToConstant: 44).isActive = true
            title.isAccessibilityElement = true
            title.accessibilityLabel = "ActiviTee"
            title.accessibilityTraits = .header
            let button = UIButton(type: .custom)
            button.backgroundColor = .white
            button.tintColor = .black
            button.setTitleColor(.black, for: .normal)
            button.setTitleColor(.black, for: .disabled)
            button.setTitleColor(.black, for: .highlighted)
            button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
            button.titleLabel?.adjustsFontForContentSizeCategory = true
            button.titleLabel?.numberOfLines = 0
            button.titleLabel?.textAlignment = .center
            button.layer.cornerRadius = 14
            // A custom button keeps its text readable while Face ID disables taps.
            // System configurations otherwise apply their own disabled appearance.
            button.heightAnchor.constraint(greaterThanOrEqualToConstant: 56).isActive = true
            button.widthAnchor.constraint(greaterThanOrEqualToConstant: 160).isActive = true
            button.addTarget(self, action: #selector(unlock), for: .touchUpInside)
            button.accessibilityIdentifier = "biometric-unlock"
            [icon, title, button].forEach(stack.addArrangedSubview)
            panel.addSubview(stack)
            window.addSubview(panel)
            NSLayoutConstraint.activate([
                panel.topAnchor.constraint(equalTo: window.topAnchor), panel.bottomAnchor.constraint(equalTo: window.bottomAnchor),
                panel.leadingAnchor.constraint(equalTo: window.leadingAnchor), panel.trailingAnchor.constraint(equalTo: window.trailingAnchor),
                stack.centerYAnchor.constraint(equalTo: panel.safeAreaLayoutGuide.centerYAnchor),
                stack.centerXAnchor.constraint(equalTo: panel.centerXAnchor),
                stack.widthAnchor.constraint(lessThanOrEqualToConstant: 360),
                stack.leadingAnchor.constraint(greaterThanOrEqualTo: panel.safeAreaLayoutGuide.leadingAnchor, constant: 24),
                stack.trailingAnchor.constraint(lessThanOrEqualTo: panel.safeAreaLayoutGuide.trailingAnchor, constant: -24),
                stack.topAnchor.constraint(greaterThanOrEqualTo: panel.safeAreaLayoutGuide.topAnchor, constant: 20),
                stack.bottomAnchor.constraint(lessThanOrEqualTo: panel.safeAreaLayoutGuide.bottomAnchor, constant: -20)
            ])
            cover = panel
            unlockButton = button
        }
        if let cover { window.bringSubviewToFront(cover) }
        unlockButton?.setTitle(text("unlock"), for: .normal)
        unlockButton?.isEnabled = context == nil && !inactive
    }
}

@objc(BiometricLockPlugin)
public class BiometricLockPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BiometricLockPlugin"
    public let jsName = "BiometricLock"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncSession", returnType: CAPPluginReturnPromise)
    ]

    private func trustedOrigin(_ call: CAPPluginCall) -> Bool {
        guard let actual = bridge?.webView?.url, let expected = bridge?.config.serverURL,
              actual.scheme == expected.scheme, actual.host == expected.host, actual.port == expected.port else {
            call.reject("Unavailable origin", "UNAVAILABLE"); return false
        }
        return true
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.trustedOrigin(call) else { return }
            call.resolve(BiometricLockController.shared.status())
        }
    }

    @objc func configure(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.trustedOrigin(call) else { return }
            guard let userID = call.getString("userID"), UUID(uuidString: userID) != nil,
                  let enabled = call.getBool("enabled") else { call.reject("Invalid arguments", "INVALID_ARGUMENT"); return }
            BiometricLockController.shared.configure(userID: userID, enabled: enabled, language: call.getString("locale") ?? "fr") { error in
                if let error { call.reject("Device authentication could not be completed", error) }
                else { call.resolve(BiometricLockController.shared.status()) }
            }
        }
    }

    @objc func syncSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.trustedOrigin(call) else { return }
            let userID = call.getString("userID")
            guard userID == nil || UUID(uuidString: userID!) != nil else { call.reject("Invalid user", "INVALID_ARGUMENT"); return }
            BiometricLockController.shared.synchronize(userID: userID, language: call.getString("locale") ?? "fr")
            call.resolve()
        }
    }
}
