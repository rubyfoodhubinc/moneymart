import Foundation
import Observation

/// Passwordless session (§9.1): request a 6-digit code by email or phone, verify it,
/// hold the bearer token in the Keychain, and re-handshake realtime on every change.
@MainActor
@Observable
final class SessionStore {
    enum Status: Equatable { case loading, signedIn, signedOut }

    struct Challenge: Equatable {
        var identifier: String
        var kind: String
        var destination: String
        var expiresAt: Date
        var devCode: String?
    }

    private(set) var status: Status = .loading
    private(set) var user: User?
    private(set) var challenge: Challenge?
    var busy = false
    var error: String?

    private let api: APIClient
    private let realtime: Realtime

    init(api: APIClient = .shared, realtime: Realtime = .shared) {
        self.api = api
        self.realtime = realtime
    }

    var isSignedIn: Bool { status == .signedIn }

    /// Currency the signed-in member chose to see prices in (Settings › Country & currency).
    static var viewerCurrency: String?
    /// Signed-in member's handle, for live-room events that name people.
    static var currentHandle: String?
    var currency: String { user?.currencyCode ?? Locale.current.currency?.identifier ?? "USD" }

    func bootstrap() async {
        let token = await api.currentToken()
        realtime.connect(token: token)
        guard token != nil else { status = .signedOut; return }
        await refresh()
    }

    func refresh() async {
        do {
            let session = try await api.authSession()
            guard let user = session.user else { throw APIError(status: 401, code: "not_authenticated", message: "") }
            self.user = user
            Self.viewerCurrency = user.currencyCode; Self.currentHandle = user.handle
            status = .signedIn
            realtime.emit("user:join", user.id)
            await PushManager.shared.signedIn(userId: user.id)
            await BuyerState.shared.load()
        } catch let error as APIError where error.status == 401 || error.status == 403 {
            await api.setToken(nil)
            realtime.updateToken(nil)
            user = nil
            status = .signedOut
        } catch {
            // Offline: keep the stored token and let the user browse; retry later.
            status = user == nil ? .signedOut : .signedIn
        }
    }

    /// Normalises an email or E.164-ish phone number; returns nil when neither.
    static func normalise(_ raw: String) -> String? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.contains("@") {
            let lower = text.lowercased()
            let parts = lower.split(separator: "@")
            guard parts.count == 2, parts[1].contains("."), !parts[0].isEmpty, !lower.contains(" ") else { return nil }
            return lower
        }
        let digits = text.filter { $0.isNumber }
        guard digits.count >= 8, digits.count <= 15 else { return nil }
        return text.hasPrefix("+") ? "+" + digits : digits
    }

    @discardableResult
    func requestCode(for raw: String) async -> Bool {
        guard let identifier = Self.normalise(raw) else {
            error = String(localized: "Enter a valid email address or phone number.")
            return false
        }
        busy = true; error = nil
        defer { busy = false }
        do {
            let result = try await api.requestCode(identifier: identifier)
            challenge = Challenge(identifier: identifier, kind: result.kind, destination: result.destination,
                                  expiresAt: Date().addingTimeInterval(TimeInterval(result.expiresInSeconds)),
                                  devCode: result.devCode)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    @discardableResult
    func verify(code: String) async -> Bool {
        guard let challenge else { error = String(localized: "Request a code first."); return false }
        let digits = code.filter(\.isNumber)
        guard digits.count == 6 else { error = String(localized: "Enter the 6-digit code."); return false }
        busy = true; error = nil
        defer { busy = false }
        do {
            let result = try await api.verifyCode(identifier: challenge.identifier, code: digits)
            await api.setToken(result.token)
            realtime.updateToken(result.token)
            user = result.user
            Self.viewerCurrency = result.user.currencyCode; Self.currentHandle = result.user.handle
            self.challenge = nil
            status = .signedIn
            realtime.emit("user:join", result.user.id)
            await PushManager.shared.signedIn(userId: result.user.id)
            await BuyerState.shared.load()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func cancelChallenge() { challenge = nil; error = nil }

    func signOut() async {
        await PushManager.shared.signedOut()
        BuyerState.shared.reset()
        _ = try? await api.signOut()
        await api.setToken(nil)
        realtime.updateToken(nil)
        user = nil
        challenge = nil
        status = .signedOut
    }

    func updateProfile(_ patch: APIClient.ProfilePatch) async -> Bool {
        busy = true; error = nil
        defer { busy = false }
        do {
            let result = try await api.updateMe(patch)
            if let updated = result.user { user = updated; Self.viewerCurrency = updated.currencyCode; Self.currentHandle = updated.handle }
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}

/// Watchlist: saved on the phone and on the account (synced after sign-in).
@MainActor
@Observable
final class WatchlistStore {
    private let key = "mm.watchlist"
    private(set) var ids: Set<String>

    init() {
        ids = Set(UserDefaults.standard.stringArray(forKey: key) ?? [])
    }

    func contains(_ id: String) -> Bool { ids.contains(id) }

    func toggle(_ id: String) {
        let on = !ids.contains(id)
        if on { ids.insert(id) } else { ids.remove(id) }
        UserDefaults.standard.set(Array(ids).sorted(), forKey: key)
        // Saved to the account too, so the watchlist follows the member to every device.
        Task { _ = try? await APIClient.shared.setWatched(id, on) }
    }

    /// After sign-in: merge what this phone saved with what the account has, both ways.
    func sync() async {
        guard let server = try? await APIClient.shared.serverWatchlist() else { return }
        let remote = Set(server.ids)
        for id in ids.subtracting(remote) { _ = try? await APIClient.shared.setWatched(id, true) }
        ids.formUnion(remote)
        UserDefaults.standard.set(Array(ids).sorted(), forKey: key)
    }
}
