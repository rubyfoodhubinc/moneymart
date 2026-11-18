import SwiftUI

struct ProfileView: View {
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                if let user = session.user {
                    header(user)
                    stats(user)
                    menu
                    Button("Sign out", role: .destructive) { Task { await session.signOut() } }
                        .buttonStyle(.glass)
                        .accessibilityIdentifier("profile-signout")
                } else {
                    signedOut
                }
            }
            .padding(MM.Space.screen)
        }
        .buttonStyle(.plain)
        .navigationTitle("Profile")
        .refreshable { await session.refresh(); await loadUnread() }
        .task(id: session.user?.id) { if session.isSignedIn { await loadUnread() } }
        .onAppear { if session.isSignedIn { Task { await loadUnread() } } }
        .mmScreen()
    }

    private var signedOut: some View {
        VStack(spacing: 16) {
            Image(systemName: "person.crop.circle.badge.plus").font(.system(size: 60)).foregroundStyle(MM.Color.gold).padding(.top, 40)
            Text("Join MoneyMart").font(MM.Font.display(26)).foregroundStyle(MM.Color.ink)
            Text("Bid in live shows, follow sellers, track orders and get paid — one account across phone, web and TV.")
                .font(MM.Font.body(15)).foregroundStyle(MM.Color.ink2).multilineTextAlignment(.center)
            Button("Sign in or create account") { router.showSignIn = true }.buttonStyle(.gold)
                .accessibilityIdentifier("profile-signin")
            NavigationLink(value: Router.Route.watchlist) { row("heart.fill", "Watchlist") }
            NavigationLink(value: Router.Route.settings) { row("gearshape.fill", "Settings") }
        }
    }

    private func header(_ user: User) -> some View {
        VStack(spacing: 10) {
            AvatarView(url: user.avatarUrl, name: user.displayName, size: 86)
            HStack(spacing: 6) {
                Text(user.displayName).font(MM.Font.display(24)).foregroundStyle(MM.Color.ink)
                if user.verificationStatus == "verified" { VerifiedMark() }
                if user.isPro == true { Pill(text: "PRO", tint: MM.Color.gold) }
            }
            Text("@\(user.handle)").font(MM.Font.body(14)).foregroundStyle(MM.Color.ink3)
            if let bio = user.bio, !bio.isEmpty { Text(bio).font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2).multilineTextAlignment(.center) }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private func stats(_ user: User) -> some View {
        HStack {
            stat(Format.count(user.followersCount ?? 0), "Followers")
            Divider().frame(height: 30).overlay(MM.Color.divider)
            stat(Format.count(user.followingCount ?? 0), "Following")
            Divider().frame(height: 30).overlay(MM.Color.divider)
            stat("\(user.totalSales ?? 0)", "Sales")
            Divider().frame(height: 30).overlay(MM.Color.divider)
            stat(String(format: "%.1f", user.rating ?? 0), "Rating")
        }
        .padding(.vertical, 14)
        .mmCard()
    }

    private func stat(_ value: String, _ label: LocalizedStringKey) -> some View {
        VStack(spacing: 2) {
            Text(value).font(MM.Font.data(18)).foregroundStyle(MM.Color.ink)
            Text(label).font(MM.Font.body(11)).foregroundStyle(MM.Color.ink3)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    @Environment(OreStore.self) private var ore

    private var menu: some View {
        VStack(spacing: 0) {
            if ore.visible {
                Button { router.showOre = true } label: { row("sparkles", "Ask Ore") }
                    .accessibilityIdentifier("profile-ore")
            }
            NavigationLink(value: Router.Route.orders) { row("shippingbox.fill", "Orders") }
            NavigationLink(value: Router.Route.wallet) { row("creditcard.fill", "Wallet & payouts") }
            NavigationLink(value: Router.Route.watchlist) { row("heart.fill", "Watchlist") }
            NavigationLink(value: Router.Route.notifications) { row("bell.fill", "Notifications", badge: unread > 0 ? "\(unread)" : nil) }
                .accessibilityIdentifier("profile-notifications")
            NavigationLink(value: Router.Route.verification) {
                row("checkmark.seal.fill", "Verification", badge: session.user?.verificationStatus == "verified" ? String(localized: "Verified") : nil)
            }
            .accessibilityIdentifier("profile-verification")
            NavigationLink(value: Router.Route.settings) { row("gearshape.fill", "Settings") }
        }
        .mmCard()
    }

    @State private var unread = 0

    private func loadUnread() async {
        unread = (try? await APIClient.shared.notifications().unread) ?? unread
    }

    private func row(_ symbol: String, _ title: LocalizedStringKey, badge: String? = nil) -> some View {
        HStack(spacing: 14) {
            Image(systemName: symbol).foregroundStyle(MM.Color.gold).frame(width: 26)
            Text(title).font(MM.Font.body(16, weight: .medium)).foregroundStyle(MM.Color.ink)
            Spacer()
            if let badge {
                Text(badge).font(MM.Font.body(12, weight: .bold)).foregroundStyle(MM.Color.navy)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(MM.Color.gold, in: Capsule())
            }
            Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundStyle(MM.Color.ink3)
        }
        .padding(.horizontal, 16).padding(.vertical, 15)
        .contentShape(Rectangle())
    }
}

struct OrdersView: View {
    @State private var orders: OrdersResponse?
    @State private var error: String?
    @State private var side = 0

    var body: some View {
        List {
            Picker("Side", selection: $side) { Text("Buying").tag(0); Text("Selling").tag(1) }
                .pickerStyle(.segmented).listRowBackground(Color.clear)
            if let error { ErrorState(message: error) { Task { await load() } }.listRowBackground(Color.clear) }
            let list = side == 0 ? (orders?.buying ?? []) : (orders?.selling ?? [])
            if orders != nil && list.isEmpty {
                EmptyStateView(symbol: "shippingbox", title: "No orders yet", message: "Won lots and sales appear here with tracking.").listRowBackground(Color.clear)
            }
            ForEach(list) { order in
                NavigationLink(value: Router.Route.auction(order.auctionId)) {
                    HStack(spacing: 12) {
                        ArtworkView(source: order.auction?.coverImage).frame(width: 52, height: 52).clipShape(RoundedRectangle(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(order.auction?.title ?? order.id).font(MM.Font.body(14, weight: .semibold)).foregroundStyle(MM.Color.ink).lineLimit(1)
                            Text(order.orderStatus.capitalized).font(MM.Font.body(12, weight: .semibold)).foregroundStyle(MM.Color.green)
                            if let tracking = order.trackingNumber { Text("\(order.courierName ?? "") \(tracking)").font(MM.Font.body(11)).foregroundStyle(MM.Color.ink3) }
                        }
                        Spacer()
                        Text(Format.money(order.totalAmount, order.currency)).font(MM.Font.data(14)).foregroundStyle(MM.Color.gold)
                    }
                }
                .listRowBackground(MM.Color.card)
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Orders")
        .task { await load() }
        .refreshable { await load() }
        .mmScreen()
    }

    private func load() async {
        do { orders = try await APIClient.shared.orders(); error = nil } catch { self.error = error.localizedDescription }
    }
}

struct WalletView: View {
    @State private var wallet: WalletResponse?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if let wallet {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Available").font(MM.Font.body(13, weight: .semibold)).foregroundStyle(MM.Color.navy.opacity(0.7))
                        Text(Format.money(wallet.available, wallet.currency)).font(MM.Font.data(36)).foregroundStyle(MM.Color.navy)
                        Text("Pending in escrow: \(Format.money(wallet.pending, wallet.currency))").font(MM.Font.body(13, weight: .medium)).foregroundStyle(MM.Color.navy.opacity(0.75))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20)
                    .background(MM.Gradient.gold, in: RoundedRectangle(cornerRadius: MM.Radius.xl, style: .continuous))

                    VStack(spacing: 0) {
                        ForEach(wallet.transactions) { tx in
                            HStack {
                                Image(systemName: tx.type == "sale" ? "arrow.down.left.circle.fill" : "arrow.up.right.circle.fill")
                                    .foregroundStyle(tx.type == "sale" ? MM.Color.green : MM.Color.ink3)
                                VStack(alignment: .leading) {
                                    Text(tx.label).font(MM.Font.body(14, weight: .medium)).foregroundStyle(MM.Color.ink).lineLimit(1)
                                    Text(Format.relative(tx.at)).font(MM.Font.body(11)).foregroundStyle(MM.Color.ink3)
                                }
                                Spacer()
                                Text((tx.type == "sale" ? "+" : "−") + Format.money(abs(tx.amount), tx.currency)).font(MM.Font.data(14)).foregroundStyle(tx.type == "sale" ? MM.Color.green : MM.Color.ink)
                            }
                            .padding(14)
                            Divider().overlay(MM.Color.divider)
                        }
                        if wallet.transactions.isEmpty {
                            EmptyStateView(symbol: "creditcard", title: "No transactions", message: "Purchases and payouts will show here.")
                        }
                    }
                    .mmCard()
                } else if let error {
                    ErrorState(message: error) { Task { await load() } }
                } else {
                    LoadingState()
                }
            }
            .padding(MM.Space.screen)
        }
        .navigationTitle("Wallet")
        .task { await load() }
        .refreshable { await load() }
        .mmScreen()
    }

    private func load() async {
        do { wallet = try await APIClient.shared.wallet(); error = nil } catch { self.error = error.localizedDescription }
    }
}

struct NotificationsView: View {
    @Environment(Router.self) private var router
    @Environment(PushManager.self) private var push
    @State private var items: [AppNotification] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var live: RealtimeSubscription?

    var body: some View {
        List {
            if let error { ErrorState(message: error) { Task { await load() } }.listRowBackground(Color.clear) }
            if loaded && items.isEmpty {
                EmptyStateView(symbol: "bell", title: "All caught up", message: "Outbid alerts, show reminders and order updates land here.").listRowBackground(Color.clear)
            }
            if loaded && !push.isOn {
                pushCard.listRowBackground(MM.Color.card)
            }
            ForEach(items) { note in
                Button { Task { await tap(note) } } label: { noteRow(note) }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("notification-row")
                    .listRowBackground(MM.Color.card)
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Notifications")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Mark all read", systemImage: "checkmark.circle") { Task { _ = try? await APIClient.shared.markAllRead(); await load() } }
                        .disabled(items.allSatisfy(\.read))
                    Button("Notification settings", systemImage: "slider.horizontal.3") { router.profilePath.append(.settings) }
                } label: { Image(systemName: "ellipsis.circle") }
                .accessibilityIdentifier("notifications-menu")
            }
        }
        .task {
            await push.refreshStatus()
            await load()
            push.clearBadge()
            live = Realtime.shared.on("notification", as: AppNotification.self) { note in
                if !items.contains(where: { $0.id == note.id }) { items.insert(note, at: 0) }
            }
        }
        .refreshable { await load() }
        .mmScreen()
    }

    private var pushCard: some View {
        HStack(spacing: 12) {
            Image(systemName: "bell.badge.fill").font(.system(size: 22)).foregroundStyle(MM.Color.gold)
            VStack(alignment: .leading, spacing: 3) {
                Text("Turn on notifications").font(MM.Font.body(14, weight: .bold)).foregroundStyle(MM.Color.ink)
                Text(push.status == .denied ? "Notifications are off for MoneyMart in iOS Settings." : "Know the moment you're outbid, a show goes live or an order ships.")
                    .font(MM.Font.body(12)).foregroundStyle(MM.Color.ink2)
            }
            Spacer()
            Button(push.status == .denied ? "Settings" : "Turn on") { Task { await push.turnOn() } }
                .buttonStyle(.goldCompact)
                .accessibilityIdentifier("notifications-turn-on")
        }
        .padding(.vertical, 4)
    }

    private func tap(_ note: AppNotification) async {
        if !note.read, let index = items.firstIndex(where: { $0.id == note.id }) {
            items[index].read = true
            _ = try? await APIClient.shared.markRead(note.id)
        }
        if let href = note.href, href != "/notifications" { router.openPath(href) }
    }

    private func noteRow(_ note: AppNotification) -> some View {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: icon(note.category)).foregroundStyle(MM.Color.gold).frame(width: 28, height: 28).background(MM.Color.goldSoft, in: Circle())
                    VStack(alignment: .leading, spacing: 3) {
                        Text(note.title).font(MM.Font.body(14, weight: note.read ? .medium : .bold)).foregroundStyle(MM.Color.ink)
                        Text(note.body).font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2)
                        Text(Format.relative(note.createdAt)).font(MM.Font.body(11)).foregroundStyle(MM.Color.ink3)
                    }
                    Spacer(minLength: 0)
                    if !note.read { Circle().fill(MM.Color.gold).frame(width: 8, height: 8) }
                }
                .contentShape(Rectangle())
    }

    private func icon(_ category: String) -> String {
        switch category {
        case "bids": "hammer.fill"
        case "streams": "dot.radiowaves.left.and.right"
        case "orders": "shippingbox.fill"
        default: "bell.fill"
        }
    }

    private func load() async {
        do { items = try await APIClient.shared.notifications().items; error = nil } catch { self.error = error.localizedDescription }
        loaded = true
    }
}

struct SettingsView: View {
    @Environment(SessionStore.self) private var session
    @State private var displayName = ""
    @State private var bio = ""
    @State private var market = "USD"
    @State private var notify: [String: Bool] = [:]
    @State private var saved = false
    @State private var apiOverride = AppConfig.currentOverride ?? ""
    @State private var health: String?

    private let notificationKeys: [(String, LocalizedStringKey)] = [
        ("outbid", "Outbid alerts"), ("endingSoon", "Ending soon"), ("streamStart", "Shows going live"),
        ("orderUpdates", "Order updates"), ("priceDrops", "Price drops"), ("marketing", "News and offers"),
    ]

    var body: some View {
        Form {
            if session.isSignedIn {
                Section("Profile") {
                    TextField("Display name", text: $displayName)
                    TextField("Bio", text: $bio, axis: .vertical).lineLimit(2...4)
                    Picker("Market & currency", selection: $market) {
                        ForEach(Catalog.markets) { Text("\($0.flag) \($0.country) · \($0.currency)").tag($0.currency) }
                    }
                }
                Section("Notifications") {
                    ForEach(notificationKeys, id: \.0) { key, label in
                        Toggle(label, isOn: Binding(get: { notify[key] ?? true }, set: { notify[key] = $0 })).tint(MM.Color.gold)
                    }
                }
                Section {
                    Button(saved ? "Saved" : "Save changes") { Task { await save() } }.disabled(session.busy)
                    if let error = session.error { Text(error).foregroundStyle(MM.Color.errorText) }
                }
            }
            Section {
                LabeledContent("App language", value: Locale.current.localizedString(forLanguageCode: Locale.current.language.languageCode?.identifier ?? "en") ?? "")
                Button("Change language in iOS Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
            } header: { Text("Language") } footer: {
                Text("MoneyMart follows your device language and detects the language of listings and chat, offering on-device translation.")
            }
            Section {
                LabeledContent("Gateway", value: AppConfig.apiBaseURL.absoluteString)
                TextField("Override gateway URL", text: $apiOverride).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                Button("Apply gateway") {
                    AppConfig.setOverride(apiOverride)
                    Realtime.shared.updateToken(nil)
                    Task { await session.bootstrap() }
                }
                Button("Check connection") {
                    Task {
                        do { let h = try await APIClient.shared.health(); health = "OK · v\(h.version ?? "?") · \(h.liveStreams ?? 0) live shows" }
                        catch { health = error.localizedDescription }
                    }
                }
                if let health { Text(health).font(MM.Font.data(13, weight: .medium)) }
                LabeledContent("Version", value: "\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""))")
            } header: { Text("Diagnostics") }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Settings")
        .onAppear(perform: hydrate)
        .mmScreen()
    }

    private func hydrate() {
        guard let user = session.user else { return }
        displayName = user.displayName
        bio = user.bio ?? ""
        market = user.currencyCode ?? "USD"
        notify = user.preferences?.notifications ?? [:]
    }

    private func save() async {
        let country = Catalog.markets.first { $0.currency == market }?.countryCode
        var prefs = session.user?.preferences ?? UserPreferences()
        prefs.notifications = notify
        prefs.language = Locale.current.language.languageCode?.identifier
        saved = await session.updateProfile(.init(displayName: displayName, bio: bio, countryCode: country, currencyCode: market, preferences: prefs))
    }
}
