import Foundation
import Security

/// API host resolution.
///
/// Order, most specific first:
///   1. a per-device override set in Settings › Diagnostics (lets a phone point at a
///      LAN or staging gateway without a rebuild),
///   2. `MM_API_URL` from the launch environment (UI tests and local development),
///   3. `MMApiBaseURL` from Info.plist — the value baked into a release build.
///
/// A release build may only talk to an `https` host. A loopback or `http` host is
/// accepted in DEBUG for the local stack and refused otherwise, so a misconfigured
/// store build fails loudly instead of silently sending every request nowhere.
enum AppConfig {
    static let overrideKey = "mm.apiOverride"
    static let productionURL = URL(string: "https://www.moneymart.app")!

    static var apiBaseURL: URL {
        if let raw = UserDefaults.standard.string(forKey: overrideKey), let url = validated(raw) { return url }
        if let raw = ProcessInfo.processInfo.environment["MM_API_URL"], let url = validated(raw) { return url }
        if let raw = Bundle.main.object(forInfoDictionaryKey: "MMApiBaseURL") as? String, let url = validated(raw) { return url }
        return productionURL
    }

    static func setOverride(_ raw: String?) {
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty || validated(trimmed) == nil {
            UserDefaults.standard.removeObject(forKey: overrideKey)
        } else {
            UserDefaults.standard.set(trimmed, forKey: overrideKey)
        }
    }

    static var currentOverride: String? { UserDefaults.standard.string(forKey: overrideKey) }

    /// Accepts only http(s) URLs with a host; strips a trailing slash; enforces https outside DEBUG.
    static func validated(_ raw: String) -> URL? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix("/") { text.removeLast() }
        guard let url = URL(string: text), let scheme = url.scheme?.lowercased(), let host = url.host, !host.isEmpty else { return nil }
        #if DEBUG
        guard scheme == "https" || scheme == "http" else { return nil }
        #else
        guard scheme == "https" else { return nil }
        #endif
        return url
    }

    static func isLoopback(_ url: URL) -> Bool {
        ["127.0.0.1", "localhost", "::1"].contains(url.host ?? "")
    }
}

/// Session token storage. The token is a bearer credential, so it lives in the
/// Keychain (this-device-only, after first unlock) — never in UserDefaults.
enum TokenStore {
    private static let service = "com.rubynav.moneymart.session"
    private static let account = "token"

    static func save(_ token: String) {
        let data = Data(token.utf8)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: account]
        SecItemDelete(query as CFDictionary)
        var insert = query
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(insert as CFDictionary, nil)
    }

    static func load() -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: account,
                                    kSecReturnData as String: true,
                                    kSecMatchLimit as String: kSecMatchLimitOne]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func clear() {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: account]
        SecItemDelete(query as CFDictionary)
    }
}
