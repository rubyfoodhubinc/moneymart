import SwiftUI

/// Shared marketplace feed. Lots update in place from the realtime bid feed, so a
/// price on the home screen never lags the auction room.
@MainActor
@Observable
final class MarketFeed {
    var streams: [LiveStream] = []
    var auctions: [Auction] = []
    var loading = false
    var error: String?

    @ObservationIgnored private var subscriptions: [RealtimeSubscription] = []

    var liveStreams: [LiveStream] { streams.filter(\.isLive) }
    var upcomingStreams: [LiveStream] { streams.filter { !$0.isLive } }
    var liveLots: [Auction] { auctions.filter { $0.status == .live }.sorted { $0.endDate < $1.endDate } }
    var featured: [Auction] { auctions.filter { $0.featured == true } }
    var upcomingLots: [Auction] { auctions.filter { $0.status == .scheduled } }
    var recentlySold: [Auction] { auctions.filter { $0.status == .sold } }

    func load() async {
        loading = auctions.isEmpty && streams.isEmpty
        error = nil
        defer { loading = false }
        async let s = APIClient.shared.streams()
        async let a = APIClient.shared.auctions(limit: 80)
        do {
            let (streams, auctions) = try await (s, a)
            self.streams = streams.items
            self.auctions = auctions.items
        } catch {
            if self.auctions.isEmpty { self.error = error.localizedDescription }
        }
        subscribe()
    }

    private func subscribe() {
        guard subscriptions.isEmpty else { return }
        let realtime = Realtime.shared
        subscriptions = [
            realtime.on("auction:bid", as: BidPlacedPayload.self) { [weak self] payload in self?.upsert(payload.auction) },
            realtime.on("auction:created", as: AuctionCreatedPayload.self) { [weak self] payload in self?.upsert(payload.auction) },
            realtime.on("auction:won", as: AuctionWonPayload.self) { [weak self] payload in self?.upsert(payload.auction) },
            realtime.on("stream:viewers", as: ViewersPayload.self) { [weak self] payload in
                guard let self, let index = self.streams.firstIndex(where: { $0.id == payload.streamId }) else { return }
                self.streams[index].viewerCount = payload.viewerCount
            },
        ]
    }

    private func upsert(_ auction: Auction) {
        if let index = auctions.firstIndex(where: { $0.id == auction.id }) { auctions[index] = auction }
        else { auctions.insert(auction, at: 0) }
    }
}

struct HomeView: View {
    @State private var feed = MarketFeed()
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                header
                if feed.loading {
                    LoadingState()
                } else if let error = feed.error {
                    ErrorState(message: error) { Task { await feed.load() } }
                } else {
                    if let hero = feed.liveStreams.first { heroCard(hero) }
                    if feed.liveStreams.count > 1 {
                        section("Live now", subtitle: "Shows streaming this minute") {
                            ForEach(feed.liveStreams.dropFirst()) { stream in
                                NavigationLink(value: Router.Route.stream(stream.id)) { StreamCard(stream: stream, width: 200, height: 270) }
                            }
                        }
                    }
                    if !feed.liveLots.isEmpty {
                        section("Ending soon", subtitle: "Final calls — anti-snipe protected") {
                            ForEach(feed.liveLots) { lot in NavigationLink(value: Router.Route.auction(lot.id)) { LotCard(auction: lot) } }
                        }
                    }
                    categories
                    if !feed.featured.isEmpty {
                        section("Featured lots", subtitle: "Authenticated by MoneyMart") {
                            ForEach(feed.featured) { lot in NavigationLink(value: Router.Route.auction(lot.id)) { LotCard(auction: lot) } }
                        }
                    }
                    if !feed.upcomingStreams.isEmpty || !feed.upcomingLots.isEmpty {
                        section("Coming up", subtitle: "Set a reminder so you never miss the drop") {
                            ForEach(feed.upcomingStreams) { stream in
                                NavigationLink(value: Router.Route.stream(stream.id)) { StreamCard(stream: stream, width: 200, height: 270) }
                            }
                            ForEach(feed.upcomingLots) { lot in NavigationLink(value: Router.Route.auction(lot.id)) { LotCard(auction: lot) } }
                        }
                    }
                    if !feed.recentlySold.isEmpty {
                        section("Recently sold", subtitle: "Real hammer prices from the community") {
                            ForEach(feed.recentlySold) { lot in NavigationLink(value: Router.Route.auction(lot.id)) { LotCard(auction: lot) } }
                        }
                    }
                }
            }
            .padding(.bottom, 32)
        }
        .buttonStyle(.plain)
        .refreshable { await feed.load() }
        .task { if feed.auctions.isEmpty { await feed.load() } }
        .mmScreen()
        .toolbar(.hidden, for: .navigationBar)
    }

    private var header: some View {
        HStack {
            BrandWordmark(size: 22)
            Spacer()
            ConnectionDot()
            Button { RequiresSignIn.run(session, router) { router.homePath.append(.notifications) } } label: {
                Image(systemName: "bell.fill").font(.system(size: 17, weight: .semibold)).foregroundStyle(MM.Color.ink)
                    .frame(width: 40, height: 40).background(MM.Color.glass, in: Circle())
            }
            .accessibilityLabel("Notifications")
        }
        .padding(.horizontal, MM.Space.screen)
        .padding(.top, 8)
    }

    private func heroCard(_ stream: LiveStream) -> some View {
        NavigationLink(value: Router.Route.stream(stream.id)) {
            StreamCard(stream: stream, width: nil, height: 420)
                .overlay(alignment: .topTrailing) {
                    Label("Join show", systemImage: "play.fill")
                        .font(MM.Font.body(14, weight: .bold)).foregroundStyle(MM.Color.navy)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(MM.Gradient.gold, in: Capsule())
                        .padding(14)
                }
                .padding(.horizontal, MM.Space.screen)
        }
        .accessibilityIdentifier("home-hero")
    }

    private var categories: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Shop by category")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(Catalog.categories) { category in
                        Button {
                            router.discoverPath = []
                            DiscoverView.pendingCategory = category.id
                            router.tab = .discover
                        } label: {
                            VStack(spacing: 8) {
                                Image(systemName: category.symbol).font(.system(size: 22, weight: .semibold)).foregroundStyle(MM.Color.gold)
                                    .frame(width: 58, height: 58).background(MM.Color.goldSoft, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                                Text(category.label).font(MM.Font.body(12, weight: .medium)).foregroundStyle(MM.Color.ink2).lineLimit(1)
                            }
                            .frame(width: 78)
                        }
                    }
                }
                .padding(.horizontal, MM.Space.screen)
            }
        }
    }

    private func section<Content: View>(_ title: LocalizedStringKey, subtitle: LocalizedStringKey, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: title, subtitle: subtitle)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: MM.Space.card) { content() }
                    .padding(.horizontal, MM.Space.screen)
            }
        }
    }
}

struct ConnectionDot: View {
    @Environment(Realtime.self) private var realtime

    var body: some View {
        Circle()
            .fill(realtime.state == .connected ? MM.Color.green : (realtime.state == .connecting ? MM.Color.gold : MM.Color.error))
            .frame(width: 8, height: 8)
            .padding(.trailing, 6)
            .accessibilityLabel(realtime.state == .connected ? Text("Realtime connected") : Text("Realtime reconnecting"))
    }
}
