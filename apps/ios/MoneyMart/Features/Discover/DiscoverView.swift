import SwiftUI

struct DiscoverView: View {
    /// Set by the Home category rail before switching tabs.
    @MainActor static var pendingCategory: String?

    enum Filter: String, CaseIterable, Identifiable {
        case all, live, ending, scheduled, sold
        var id: String { rawValue }
        var label: LocalizedStringKey {
            switch self {
            case .all: "All"
            case .live: "Live"
            case .ending: "Ending soon"
            case .scheduled: "Upcoming"
            case .sold: "Sold"
            }
        }
        var status: String? { self == .all ? nil : rawValue }
    }

    enum Kind: String, CaseIterable, Identifiable {
        case any, live_stream, traditional, buy_now, make_offer
        var id: String { rawValue }
        var label: LocalizedStringKey {
            switch self {
            case .any: "Any format"
            case .live_stream: "Live auction"
            case .traditional: "Auction house"
            case .buy_now: "Buy It Now"
            case .make_offer: "Make an Offer"
            }
        }
    }

    @State private var query = ""
    @State private var filter: Filter = .all
    @State private var kind: Kind = .any
    @State private var category: String?
    @State private var results: [Auction] = []
    @State private var loading = false
    @State private var error: String?

    private let columns = [GridItem(.flexible(), spacing: MM.Space.card), GridItem(.flexible(), spacing: MM.Space.card)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                chips
                if loading && results.isEmpty {
                    LoadingState()
                } else if let error {
                    ErrorState(message: error) { Task { await search() } }
                } else if results.isEmpty {
                    EmptyStateView(symbol: "magnifyingglass", title: "Nothing here yet", message: "Try another category or search term.")
                } else {
                    LazyVGrid(columns: columns, spacing: MM.Space.card) {
                        ForEach(results) { lot in
                            NavigationLink(value: Router.Route.auction(lot.id)) { LotCard(auction: lot, width: nil) }
                        }
                    }
                    .padding(.horizontal, MM.Space.screen)
                }
            }
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
        .navigationTitle("Discover")
        .searchable(text: $query, prompt: Text("Search lots, sellers, brands"))
        .onSubmit(of: .search) { Task { await search() } }
        .onChange(of: query) { _, value in if value.isEmpty { Task { await search() } } }
        .onChange(of: filter) { Task { await search() } }
        .onChange(of: kind) { Task { await search() } }
        .onChange(of: category) { Task { await search() } }
        .refreshable { await search() }
        .task {
            if let pending = Self.pendingCategory { category = pending; Self.pendingCategory = nil }
            await search()
        }
        .onAppear {
            if let pending = Self.pendingCategory { category = pending; Self.pendingCategory = nil }
        }
        .mmScreen()
    }

    private var chips: some View {
        VStack(alignment: .leading, spacing: 10) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Filter.allCases) { item in
                        chip(item.label, selected: filter == item) { filter = item }
                    }
                    Menu {
                        Picker("Format", selection: $kind) {
                            ForEach(Kind.allCases) { Text($0.label).tag($0) }
                        }
                    } label: {
                        chipLabel(kind.label, selected: kind != .any, systemImage: "slider.horizontal.3")
                    }
                }
                .padding(.horizontal, MM.Space.screen)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    chip("All categories", selected: category == nil) { category = nil }
                    ForEach(Catalog.categories) { item in
                        Button { category = category == item.id ? nil : item.id } label: {
                            chipLabel(LocalizedStringKey(String(localized: item.label)), selected: category == item.id, systemImage: item.symbol)
                        }
                    }
                }
                .padding(.horizontal, MM.Space.screen)
            }
        }
    }

    private func chip(_ label: LocalizedStringKey, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { chipLabel(label, selected: selected) }
    }

    private func chipLabel(_ label: LocalizedStringKey, selected: Bool, systemImage: String? = nil) -> some View {
        HStack(spacing: 6) {
            if let systemImage { Image(systemName: systemImage).font(.system(size: 12, weight: .semibold)) }
            Text(label).font(MM.Font.body(13, weight: .semibold))
        }
        .foregroundStyle(selected ? MM.Color.navy : MM.Color.ink2)
        .padding(.horizontal, 14).padding(.vertical, 9)
        .background(selected ? AnyShapeStyle(MM.Gradient.gold) : AnyShapeStyle(MM.Color.raised), in: Capsule())
        .overlay(Capsule().stroke(selected ? .clear : MM.Color.border, lineWidth: 1))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func search() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            let page = try await APIClient.shared.auctions(status: filter.status, category: category,
                                                           type: kind == .any ? nil : kind.rawValue,
                                                           query: query.isEmpty ? nil : query)
            results = page.items
        } catch is CancellationError {
        } catch {
            if (error as? URLError)?.code == .cancelled { return }
            self.error = error.localizedDescription
        }
    }
}

struct WatchlistView: View {
    @Environment(WatchlistStore.self) private var watchlist
    @State private var lots: [Auction] = []
    @State private var loading = true

    private let columns = [GridItem(.flexible(), spacing: MM.Space.card), GridItem(.flexible(), spacing: MM.Space.card)]

    var body: some View {
        ScrollView {
            if loading {
                LoadingState()
            } else if lots.isEmpty {
                EmptyStateView(symbol: "heart", title: "Your watchlist is empty", message: "Tap the heart on any lot to follow its price and get the final call.")
            } else {
                LazyVGrid(columns: columns, spacing: MM.Space.card) {
                    ForEach(lots) { lot in NavigationLink(value: Router.Route.auction(lot.id)) { LotCard(auction: lot, width: nil) } }
                }
                .padding(MM.Space.screen)
            }
        }
        .buttonStyle(.plain)
        .navigationTitle("Watchlist")
        .task(id: watchlist.ids) {
            let all = (try? await APIClient.shared.auctions(limit: 200).items) ?? []
            lots = all.filter { watchlist.contains($0.id) }
            loading = false
        }
        .mmScreen()
    }
}
