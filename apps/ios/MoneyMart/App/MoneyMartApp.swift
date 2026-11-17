import SwiftUI
import AVFoundation

@main
struct MoneyMartApp: App {
    @State private var session = SessionStore()
    @State private var watchlist = WatchlistStore()
    @State private var router = Router()
    @State private var ore = OreStore()
    @AppStorage("mm.onboarded") private var onboarded = false

    init() {
        if ProcessInfo.processInfo.arguments.contains("-mm-reset") {
            UserDefaults.standard.removeObject(forKey: "mm.onboarded")
            TokenStore.clear()
        }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        Self.styleChrome()
    }

    var body: some Scene {
        WindowGroup {
            RootView(onboarded: $onboarded)
                .environment(session)
                .environment(watchlist)
                .environment(router)
                .environment(ore)
                .environment(Realtime.shared)
                .preferredColorScheme(.dark)
                .tint(MM.Color.gold)
                .task { await session.bootstrap() }
                .task { await ore.refreshStatus() }
                .onOpenURL { router.open($0) }
        }
    }

    private static func styleChrome() {
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = UIColor(MM.Color.surface)
        nav.shadowColor = .clear
        nav.titleTextAttributes = [.foregroundColor: UIColor(MM.Color.ink)]
        nav.largeTitleTextAttributes = [.foregroundColor: UIColor(MM.Color.ink),
                                        .font: UIFont.systemFont(ofSize: 32, weight: .bold).rounded()]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav

        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = UIColor(MM.Color.navyDeep)
        tab.shadowColor = UIColor(MM.Color.border)
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }
}

private extension UIFont {
    func rounded() -> UIFont {
        guard let descriptor = fontDescriptor.withDesign(.rounded) else { return self }
        return UIFont(descriptor: descriptor, size: pointSize)
    }
}

/// Deep links (`moneymart://lot/<id>`, `moneymart://bid/<id>`, `moneymart://stream/<id>`)
/// and the active tab.
@MainActor
@Observable
final class Router {
    enum Tab: Hashable { case home, discover, live, sell, profile }
    enum Route: Hashable { case auction(String), stream(String), notifications, orders, wallet, watchlist, settings }

    var tab: Tab = .home
    var homePath: [Route] = []
    var discoverPath: [Route] = []
    var livePath: [Route] = []
    var profilePath: [Route] = []
    var showSignIn = false
    var showOre = false

    func open(_ url: URL) {
        guard url.scheme == "moneymart" else { return }
        let id = url.pathComponents.dropFirst().first ?? url.lastPathComponent
        switch url.host {
        case "lot", "bid", "auction":
            tab = .home; homePath = [.auction(id)]
        case "stream", "live":
            tab = .live; livePath = [.stream(id)]
        default: break
        }
    }
}

struct RootView: View {
    @Binding var onboarded: Bool
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router

    var body: some View {
        @Bindable var router = router
        ZStack {
            MM.Color.surface.ignoresSafeArea()
            switch (session.status, onboarded) {
            case (.loading, _):
                SplashView()
            case (_, false):
                WelcomeView { withAnimation(.easeInOut) { onboarded = true } }
                    .transition(.opacity)
            default:
                MainTabView().transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.35), value: session.status)
        .sheet(isPresented: $router.showSignIn) {
            AuthView().presentationDragIndicator(.visible)
        }
        .fullScreenCover(isPresented: $router.showOre) { OreChatView() }
    }
}

struct MainTabView: View {
    @Environment(Router.self) private var router

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.tab) {
            Tab("Home", systemImage: "house.fill", value: Router.Tab.home) {
                NavigationStack(path: $router.homePath) { HomeView().withRoutes() }
            }
            Tab("Discover", systemImage: "magnifyingglass", value: Router.Tab.discover) {
                NavigationStack(path: $router.discoverPath) { DiscoverView().withRoutes() }
            }
            Tab("Live", systemImage: "dot.radiowaves.left.and.right", value: Router.Tab.live) {
                NavigationStack(path: $router.livePath) { LiveListView().withRoutes() }
            }
            Tab("Sell", systemImage: "plus.circle.fill", value: Router.Tab.sell) {
                NavigationStack { SellView().withRoutes() }
            }
            Tab("Profile", systemImage: "person.crop.circle.fill", value: Router.Tab.profile) {
                NavigationStack(path: $router.profilePath) { ProfileView().withRoutes() }
            }
        }
    }
}

extension View {
    func withRoutes() -> some View {
        navigationDestination(for: Router.Route.self) { route in
            switch route {
            case .auction(let id): AuctionDetailView(auctionId: id)
            case .stream(let id): StreamView(streamId: id)
            case .notifications: NotificationsView()
            case .orders: OrdersView()
            case .wallet: WalletView()
            case .watchlist: WatchlistView()
            case .settings: SettingsView()
            }
        }
    }
}
