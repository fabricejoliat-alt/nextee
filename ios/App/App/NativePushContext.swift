import Foundation
import Capacitor

/// Read the signed provisioning profile, not Debug/Release: an exported archive
/// can have a different APNs environment from the build configuration.
@objc(NativePushContextPlugin)
public class NativePushContextPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativePushContextPlugin"
    public let jsName = "NativePushContext"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "getContext", returnType: CAPPluginReturnPromise)]

    @objc func getContext(_ call: CAPPluginCall) {
        #if targetEnvironment(simulator)
        let environment = "sandbox"
        #else
        var environment = "production" // App Store builds have no embedded profile.
        if let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision") {
            guard let data = try? Data(contentsOf: url),
                  let start = data.range(of: Data("<?xml".utf8)),
                  let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
                  let plist = try? PropertyListSerialization.propertyList(from: data.subdata(in: start.lowerBound..<end.upperBound), options: [], format: nil) as? [String: Any],
                  let entitlements = plist["Entitlements"] as? [String: Any],
                  let aps = entitlements["aps-environment"] as? String,
                  ["development", "production"].contains(aps) else {
                call.reject("The signing profile does not enable push notifications", "PUSH_SIGNING_UNAVAILABLE")
                return
            }
            environment = aps == "development" ? "sandbox" : "production"
        }
        #endif
        call.resolve(["environment": environment, "bundleId": Bundle.main.bundleIdentifier ?? ""])
    }
}
