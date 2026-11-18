import SwiftUI
import UIKit
import UserNotifications

/// iPhone notifications: asks permission when the member chooses to turn them on, registers this phone with
/// MoneyMart (only while signed in), shows alerts while the app is open, and opens the right screen on a tap.
@MainActor
@Observable
final class PushManager: NSObject {
    static let shared = PushManager()

    private(set) var status: UNAuthorizationStatus = .notDetermined
    private var token: String?
    private var registeredFor: String?
    weak var router: Router?

    var isOn: Bool { status == .authorized || status == .provisional || status == .ephemeral }

    func configure(router: Router) {
        self.router = router
        UNUserNotificationCenter.current().delegate = self
    }

    func refreshStatus() async {
        status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// Ask (first time) and register. Returns whether notifications are now on.
    @discardableResult
    func turnOn() async -> Bool {
        await refreshStatus()
        if status == .denied {
            if let url = URL(string: UIApplication.openNotificationSettingsURLString) { await UIApplication.shared.open(url) }
            return false
        }
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])) ?? false
        await refreshStatus()
        if granted { UIApplication.shared.registerForRemoteNotifications() }
        return granted
    }

    /// Called when a member signs in: re-register silently if they already allowed notifications.
    func signedIn(userId: String) async {
        await refreshStatus()
        guard isOn else { return }
        if registeredFor != userId { registeredFor = nil }
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// Called on sign-out, so the next person on this phone does not get the previous member's alerts.
    func signedOut() async {
        if let token { _ = try? await APIClient.shared.unregisterDevice(token: token) }
        registeredFor = nil
        try? await UNUserNotificationCenter.current().setBadgeCount(0)
    }

    func didRegister(_ deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        token = hex
        Task {
            guard let user = try? await APIClient.shared.authSession().user else { return }
            #if DEBUG
            let env = "sandbox"
            #else
            let env = "production"
            #endif
            if (try? await APIClient.shared.registerDevice(token: hex, env: env)) != nil { registeredFor = user.id }
        }
    }

    func clearBadge() {
        Task { try? await UNUserNotificationCenter.current().setBadgeCount(0) }
    }

    fileprivate func open(_ href: String) {
        router?.openPath(href)
    }
}

extension PushManager: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound, .badge]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let href = response.notification.request.content.userInfo["href"] as? String ?? "/notifications"
        await MainActor.run { PushManager.shared.open(href) }
    }
}

/// Receives the device token from iOS.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushManager.shared.didRegister(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Simulators without push and builds without the capability land here; the in-app list still works.
    }
}
