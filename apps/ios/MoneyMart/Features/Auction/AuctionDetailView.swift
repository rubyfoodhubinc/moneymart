import SwiftUI
import Charts
import Translation

struct AuctionDetailView: View {
    let auctionId: String
    @State private var controller: BidController
    @State private var showBid = false
    @State private var page = 0
    @State private var translate = false
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(WatchlistStore.self) private var watchlist

    init(auctionId: String) {
        self.auctionId = auctionId
        _controller = State(initialValue: BidController(auctionId: auctionId))
    }

    var body: some View {
        Group {
            if controller.loading {
                LoadingState()
            } else if let auction = controller.auction {
                content(auction)
            } else {
                ErrorState(message: controller.error ?? String(localized: "This lot could not be loaded.")) { Task { await controller.load() } }
            }
        }
        .mmScreen()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let auction = controller.auction {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { watchlist.toggle(auction.id) } label: {
                        Image(systemName: watchlist.contains(auction.id) ? "heart.fill" : "heart")
                    }
                    .accessibilityLabel(watchlist.contains(auction.id) ? Text("Remove from watchlist") : Text("Add to watchlist"))
                    ShareLink(item: URL(string: "https://www.moneymart.app/lot/\(auction.id)")!, subject: Text(auction.title)) {
                        Image(systemName: "square.and.arrow.up")
                    }
                }
            }
        }
        .task { await controller.load() }
        .onDisappear { controller.detach() }
        .sheet(isPresented: $showBid) { BidSheet(controller: controller).presentationDetents([.medium, .large]) }
    }

    private func content(_ auction: Auction) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                gallery(auction)
                VStack(alignment: .leading, spacing: 18) {
                    titleBlock(auction)
                    priceCard(auction)
                    if let banner = controller.banner {
                        Label(banner.text, systemImage: banner.kind == .warning ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                            .font(MM.Font.body(14, weight: .semibold))
                            .foregroundStyle(banner.kind == .warning ? MM.Color.errorText : MM.Color.green)
                            .accessibilityIdentifier("bid-banner")
                    }
                    sellerCard(auction)
                    details(auction)
                    if let breakdown = controller.breakdown { costCard(breakdown) }
                    if !controller.priceHistory.isEmpty { historyChart(auction) }
                    bidLadder(auction)
                }
                .padding(.horizontal, MM.Space.screen)
                if !controller.related.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeader(title: "You may also like")
                        ScrollView(.horizontal, showsIndicators: false) {
                            LazyHStack(spacing: MM.Space.card) {
                                ForEach(controller.related) { lot in NavigationLink(value: Router.Route.auction(lot.id)) { LotCard(auction: lot) } }
                            }
                            .padding(.horizontal, MM.Space.screen)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.bottom, 110)
        }
        .refreshable { await controller.load() }
        .safeAreaInset(edge: .bottom) { actionBar(auction) }
    }

    private func gallery(_ auction: Auction) -> some View {
        let images = auction.item?.images ?? []
        return TabView(selection: $page) {
            ForEach(Array((images.isEmpty ? [""] : images).enumerated()), id: \.offset) { index, image in
                ArtworkView(source: image.isEmpty ? nil : image, symbol: Catalog.category(auction.categoryId).symbol, initialsSize: 0.15)
                    .tag(index)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: images.count > 1 ? .always : .never))
        .aspectRatio(1, contentMode: .fit)
        .overlay(alignment: .topLeading) {
            HStack(spacing: 6) {
                if auction.status == .live && auction.auctionType != .buyNow { LiveBadge(viewers: auction.watchers) }
                if auction.item?.isVerified == true { Pill(text: "MoneyMart Verified", systemImage: "checkmark.seal.fill") }
            }
            .padding(12)
        }
    }

    private func titleBlock(_ auction: Auction) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Pill(text: LocalizedStringKey(String(localized: Catalog.category(auction.categoryId).label)), systemImage: Catalog.category(auction.categoryId).symbol, tint: MM.Color.ink2)
                Pill(text: LocalizedStringKey(String(localized: Catalog.condition(auction.item?.condition).label)), tint: MM.Color.ink2)
                if let lotNumber = auction.lotNumber { Pill(text: "Lot \(lotNumber)", tint: MM.Color.ink2) }
            }
            Text(auction.title).font(MM.Font.display(26)).foregroundStyle(MM.Color.ink)
                .accessibilityIdentifier("lot-title")
        }
    }

    private func priceCard(_ auction: Auction) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(auction.currentBid > 0 ? (auction.status == .sold ? "Hammer price" : "Current bid") : "Starting at")
                        .font(MM.Font.body(12, weight: .semibold)).foregroundStyle(MM.Color.ink3)
                    Text(Format.money(auction.hammerPrice ?? auction.displayPrice, auction.currency))
                        .font(MM.Font.data(34)).foregroundStyle(MM.Color.gold)
                        .contentTransition(.numericText()).animation(.snappy, value: auction.currentBid)
                        .accessibilityIdentifier("lot-price")
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    if auction.status == .live { CountdownText(end: auction.endDate, size: 16) }
                    else { Pill(text: LotStatusText.label(auction), tint: auction.status == .sold ? MM.Color.green : MM.Color.ink2) }
                    Text("\(auction.bidCount) bids · \(auction.watchers ?? 0) watching").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
                }
            }
            if let reserveMet = auction.reserveMet, auction.reservePrice != nil {
                Label(reserveMet ? "Reserve met" : "Reserve not yet met", systemImage: reserveMet ? "checkmark.circle.fill" : "circle.dashed")
                    .font(MM.Font.body(13, weight: .semibold)).foregroundStyle(reserveMet ? MM.Color.green : MM.Color.ink2)
            }
            if let bin = auction.buyItNowPrice, auction.status == .live {
                Label("Buy It Now \(Format.money(bin, auction.currency))", systemImage: "bolt.fill")
                    .font(MM.Font.body(13, weight: .semibold)).foregroundStyle(MM.Color.goldBright)
            }
        }
        .padding(16)
        .mmCard()
    }

    private func sellerCard(_ auction: Auction) -> some View {
        HStack(spacing: 12) {
            AvatarView(url: auction.seller?.avatarUrl, name: auction.seller?.displayName ?? "S", size: 46)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    Text(auction.seller?.displayName ?? "").font(MM.Font.body(15, weight: .bold)).foregroundStyle(MM.Color.ink)
                    if auction.seller?.isVerified == true { VerifiedMark() }
                }
                HStack(spacing: 8) {
                    Label(String(format: "%.1f", auction.seller?.rating ?? 0), systemImage: "star.fill")
                    Text("\(auction.seller?.totalSales ?? 0) sales")
                    Text("\(Format.count(auction.seller?.followersCount ?? 0)) followers")
                }
                .font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            }
            Spacer()
            if let streamId = auction.streamId {
                NavigationLink(value: Router.Route.stream(streamId)) { Text("Show") }.buttonStyle(.glassCompact)
            }
        }
        .padding(14)
        .mmCard()
    }

    private func details(_ auction: Auction) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if let description = auction.item?.description, !description.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Description").font(MM.Font.display(18)).foregroundStyle(MM.Color.ink)
                        Spacer()
                        if let code = LanguageDetector.detect(description), LanguageDetector.isForeign(description) {
                            Button { translate = true } label: {
                                Label("Translate from \(LanguageDetector.displayName(code))", systemImage: "translate").font(MM.Font.body(12, weight: .semibold))
                            }
                        }
                    }
                    Text(description).font(MM.Font.body(15)).foregroundStyle(MM.Color.ink2)
                        .translationPresentation(isPresented: $translate, text: description)
                }
            }
            if let report = auction.item?.conditionReport {
                detailBlock("Condition report", report, symbol: "doc.text.magnifyingglass")
            }
            if let provenance = auction.item?.provenance {
                detailBlock("Provenance", provenance, symbol: "scroll")
            }
            Label("Escrow protected: your payment is held until you confirm the item arrived as described.", systemImage: "lock.shield.fill")
                .font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2)
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(MM.Color.greenSoft, in: RoundedRectangle(cornerRadius: MM.Radius.md))
        }
    }

    private func detailBlock(_ title: LocalizedStringKey, _ body: String, symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: symbol).font(MM.Font.body(14, weight: .bold)).foregroundStyle(MM.Color.ink)
            Text(body).font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2)
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading).mmCard(radius: MM.Radius.md)
    }

    private func costCard(_ b: CostBreakdown) -> some View {
        VStack(spacing: 10) {
            Text("If you win at this price").font(MM.Font.display(18)).foregroundStyle(MM.Color.ink).frame(maxWidth: .infinity, alignment: .leading)
            costRow("Hammer price", b.hammerPrice, b.currency)
            costRow("Buyer's premium (\(Int(b.buyersPremiumRate * 100))%)", b.buyersPremium, b.currency)
            costRow("Shipping", b.shipping, b.currency)
            costRow("Tax", b.tax, b.currency)
            Divider().overlay(MM.Color.divider)
            HStack {
                Text("Total").font(MM.Font.body(15, weight: .bold)).foregroundStyle(MM.Color.ink)
                Spacer()
                Text(Format.money(b.total, b.currency)).font(MM.Font.data(18)).foregroundStyle(MM.Color.gold)
            }
        }
        .padding(16).mmCard()
    }

    private func costRow(_ label: LocalizedStringKey, _ value: Double, _ currency: String) -> some View {
        HStack {
            Text(label).font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2)
            Spacer()
            Text(Format.money(value, currency)).font(MM.Font.data(14, weight: .semibold)).foregroundStyle(MM.Color.ink)
        }
    }

    private func historyChart(_ auction: Auction) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Market price history").font(MM.Font.display(18)).foregroundStyle(MM.Color.ink)
            Chart(controller.priceHistory, id: \.label) { point in
                AreaMark(x: .value("Month", point.label), y: .value("Price", point.value))
                    .foregroundStyle(LinearGradient(colors: [MM.Color.gold.opacity(0.35), .clear], startPoint: .top, endPoint: .bottom))
                    .interpolationMethod(.catmullRom)
                LineMark(x: .value("Month", point.label), y: .value("Price", point.value))
                    .foregroundStyle(MM.Color.gold).lineStyle(StrokeStyle(lineWidth: 2.5)).interpolationMethod(.catmullRom)
            }
            .chartYAxis { AxisMarks(position: .leading) { _ in AxisGridLine().foregroundStyle(MM.Color.divider); AxisValueLabel().foregroundStyle(MM.Color.ink3) } }
            .chartXAxis { AxisMarks { _ in AxisValueLabel().foregroundStyle(MM.Color.ink3) } }
            .frame(height: 170)
        }
        .padding(16).mmCard()
    }

    private func bidLadder(_ auction: Auction) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Bid history").font(MM.Font.display(18)).foregroundStyle(MM.Color.ink)
            if controller.bids.isEmpty {
                Text("No bids yet — be the first.").font(MM.Font.body(14)).foregroundStyle(MM.Color.ink3)
            }
            ForEach(controller.bids.prefix(12)) { bid in
                HStack {
                    Image(systemName: bid.isAutoBid == true ? "bolt.circle.fill" : "hammer.circle.fill")
                        .foregroundStyle(bid.status == "winning" ? MM.Color.green : MM.Color.ink3)
                    Text("@\(bid.bidderHandle)").font(MM.Font.body(14, weight: .semibold)).foregroundStyle(bid.bidderId == session.user?.id ? MM.Color.gold : MM.Color.ink)
                    Spacer()
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(Format.money(bid.amount, bid.currency)).font(MM.Font.data(14)).foregroundStyle(MM.Color.ink)
                        Text(Format.relative(bid.timestamp)).font(MM.Font.body(11)).foregroundStyle(MM.Color.ink3)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(16).mmCard()
    }

    @ViewBuilder
    private func actionBar(_ auction: Auction) -> some View {
        if controller.isOpen {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Next bid").font(MM.Font.body(11, weight: .semibold)).foregroundStyle(MM.Color.ink3)
                    Text(Format.money(controller.minimumBid, auction.currency)).font(MM.Font.data(18)).foregroundStyle(MM.Color.ink)
                }
                Spacer()
                Button {
                    RequiresSignIn.run(session, router) { showBid = true }
                } label: {
                    Label("Place bid", systemImage: "hammer.fill")
                }
                .buttonStyle(.goldCompact)
                .accessibilityIdentifier("lot-bid")
            }
            .padding(.horizontal, MM.Space.screen).padding(.vertical, 12)
            .background(.ultraThinMaterial)
            .overlay(alignment: .top) { MM.Color.border.frame(height: 1) }
        }
    }
}

struct BidSheet: View {
    let controller: BidController
    @Environment(\.dismiss) private var dismiss
    @State private var custom = ""
    @State private var autoMax = ""
    @State private var aggressive = false
    @State private var mode = 0

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let auction = controller.auction {
                        HStack(spacing: 12) {
                            ArtworkView(source: auction.coverImage, symbol: Catalog.category(auction.categoryId).symbol)
                                .frame(width: 60, height: 60).clipShape(RoundedRectangle(cornerRadius: 12))
                            VStack(alignment: .leading, spacing: 4) {
                                Text(auction.title).font(MM.Font.body(15, weight: .semibold)).foregroundStyle(MM.Color.ink).lineLimit(2)
                                HStack {
                                    Text(Format.money(auction.displayPrice, auction.currency)).font(MM.Font.data(18)).foregroundStyle(MM.Color.gold)
                                    if controller.isOpen { CountdownText(end: auction.endDate, size: 12) }
                                }
                            }
                        }
                        Picker("Mode", selection: $mode) {
                            Text("Bid now").tag(0)
                            Text("Auto-bid").tag(1)
                        }
                        .pickerStyle(.segmented)

                        if mode == 0 { quick(auction) } else { auto(auction) }

                        if let banner = controller.banner {
                            Text(banner.text).font(MM.Font.body(13, weight: .semibold))
                                .foregroundStyle(banner.kind == .warning ? MM.Color.errorText : MM.Color.green)
                        }
                        Text("Bids are binding. A bid in the final 10 seconds extends the clock by 30 seconds.")
                            .font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
                    }
                }
                .padding(20)
            }
            .mmScreen()
            .navigationTitle("Place a bid")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }

    private func quick(_ auction: Auction) -> some View {
        VStack(spacing: 12) {
            ForEach(Array(controller.quickAmounts.enumerated()), id: \.offset) { index, amount in
                Button {
                    Task { if await controller.place(amount) { dismiss() } }
                } label: {
                    HStack {
                        Text(index == 0 ? "Minimum" : (index == 1 ? "Strong" : "Jump"))
                        Spacer()
                        Text(Format.money(amount, auction.currency)).font(MM.Font.data(17))
                    }
                }
                .buttonStyle(GoldButtonStyle())
                .opacity(index == 0 ? 1 : 0.9)
                .disabled(controller.placing || !controller.isOpen)
                .accessibilityIdentifier("bid-quick-\(index)")
            }
            HStack(spacing: 10) {
                InputField(title: "Custom amount", text: $custom, prompt: LocalizedStringKey(Format.money(controller.minimumBid, auction.currency)), keyboard: .decimalPad)
                Button("Bid") {
                    if let value = Double(custom.replacingOccurrences(of: ",", with: ".")) {
                        Task { if await controller.place(value) { dismiss() } }
                    }
                }
                .buttonStyle(.goldCompact)
                .padding(.top, 22)
                .disabled(controller.placing || Double(custom.replacingOccurrences(of: ",", with: ".")) == nil)
            }
        }
    }

    private func auto(_ auction: Auction) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("MoneyMart bids for you, one increment at a time, up to your maximum. Nobody sees your limit.")
                .font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2)
            InputField(title: "Your maximum", text: $autoMax, prompt: LocalizedStringKey(Format.money(controller.minimumBid * 1.5, auction.currency)), keyboard: .decimalPad)
            Toggle(isOn: $aggressive) {
                VStack(alignment: .leading) {
                    Text("Aggressive increments").font(MM.Font.body(15, weight: .semibold)).foregroundStyle(MM.Color.ink)
                    Text("Jump by \(Format.money(controller.increments.mid, auction.currency)) to discourage rivals.").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
                }
            }
            .tint(MM.Color.gold)
            Button("Turn on auto-bid") {
                if let value = Double(autoMax.replacingOccurrences(of: ",", with: ".")) {
                    Task { if await controller.setAutoBid(max: value, aggressive: aggressive) { dismiss() } }
                }
            }
            .buttonStyle(.gold)
            .disabled(controller.placing || (Double(autoMax.replacingOccurrences(of: ",", with: ".")) ?? 0) < controller.minimumBid)
        }
    }
}
