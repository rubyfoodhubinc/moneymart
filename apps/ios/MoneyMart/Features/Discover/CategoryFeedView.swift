import SwiftUI

/// One category: live and upcoming shows, then listings sorted Popular / New / Buy It Now.
struct CategoryFeedView: View {
    let categoryId: String
    @State private var sort = "popular"
    @State private var feed: CategoryFeed?
    @State private var error: String?
    @State private var board: [LeaderRow] = []

    private let columns = [GridItem(.flexible(), spacing: MM.Space.card), GridItem(.flexible(), spacing: MM.Space.card)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Picker("Sort", selection: $sort) {
                    Text("Popular").tag("popular")
                    Text("New").tag("new")
                    Text("Buy It Now").tag("bin")
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("category-sort")

                if let feed {
                    if !feed.live.isEmpty {
                        Text("Shows").font(MM.Font.display(18)).foregroundStyle(MM.Color.ink)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: MM.Space.card) {
                                ForEach(feed.live) { s in
                                    NavigationLink(value: Router.Route.stream(s.id)) { StreamCard(stream: s, width: 180, height: 240) }
                                }
                            }
                        }
                    }
                    if !board.isEmpty {
                        Text("Top sellers this month").font(MM.Font.display(18)).foregroundStyle(MM.Color.ink)
                        VStack(spacing: 8) {
                            ForEach(board.prefix(5)) { r in
                                if let seller = r.seller {
                                    NavigationLink(value: Router.Route.seller(seller.handle)) {
                                        HStack(spacing: 10) {
                                            Text("#\(r.rank)").font(MM.Font.data(14)).foregroundStyle(MM.Color.gold).frame(width: 34, alignment: .leading)
                                            AvatarView(url: seller.avatarUrl, name: seller.displayName, size: 28)
                                            Text("@\(seller.handle)").font(MM.Font.body(14, weight: .semibold)).foregroundStyle(MM.Color.ink)
                                            Spacer()
                                            Text("\(r.sales) " + String(localized: "sold")).font(MM.Font.body(12)).foregroundStyle(MM.Color.ink2)
                                        }
                                    }
                                }
                            }
                        }
                        .padding(12).mmCard()
                        .accessibilityIdentifier("category-leaderboard")
                    }
                    Text("For sale").font(MM.Font.display(18)).foregroundStyle(MM.Color.ink)
                    if feed.listings.isEmpty {
                        EmptyStateView(symbol: "tag", title: "Nothing here yet", message: "Follow sellers in this category to hear when they list.")
                    } else {
                        LazyVGrid(columns: columns, spacing: MM.Space.card) {
                            ForEach(feed.listings) { lot in NavigationLink(value: Router.Route.auction(lot.id)) { LotCard(auction: lot, width: nil) } }
                        }
                    }
                } else if let error {
                    ErrorState(message: error) { Task { await load() } }
                } else {
                    LoadingState()
                }
            }
            .padding(MM.Space.screen)
        }
        .buttonStyle(.plain)
        .navigationTitle(feed.map { "\($0.category.emoji ?? "") \($0.category.label)" } ?? String(localized: Catalog.category(categoryId).label))
        .task(id: sort) { await load() }
        .task { board = (try? await APIClient.shared.leaderboard(category: categoryId).items) ?? [] }
        .refreshable { await load() }
        .mmScreen()
    }

    private func load() async {
        do { feed = try await APIClient.shared.categoryFeed(categoryId, sort: sort); error = nil } catch { self.error = error.localizedDescription }
    }
}

struct LeaderRow: Codable, Hashable, Identifiable, Sendable {
    var rank: Int
    var seller: MiniUser?
    var sales: Int
    var gmvUSD: Double
    var id: Int { rank }
}
struct LeaderboardResponse: Codable, Sendable { var items: [LeaderRow] }

extension APIClient {
    func leaderboard(category: String?) async throws -> LeaderboardResponse { try await get("/api/leaderboards", query: ["category": category]) }
}
