import SwiftUI

// MARK: - Buttons

struct GoldButtonStyle: ButtonStyle {
    var compact = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(MM.Font.body(compact ? 14 : 16, weight: .bold))
            .foregroundStyle(MM.Color.navy)
            .padding(.horizontal, compact ? 14 : 20)
            .frame(minHeight: compact ? 40 : 52)
            .frame(maxWidth: compact ? nil : .infinity)
            .background(MM.Gradient.gold, in: RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous).stroke(.white.opacity(0.18), lineWidth: 1))
            .shadow(color: MM.Color.gold.opacity(configuration.isPressed ? 0.1 : 0.35), radius: 14, y: 6)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(isEnabled ? 1 : 0.45)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

struct GlassButtonStyle: ButtonStyle {
    var compact = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(MM.Font.body(compact ? 14 : 16, weight: .semibold))
            .foregroundStyle(MM.Color.ink)
            .padding(.horizontal, compact ? 14 : 20)
            .frame(minHeight: compact ? 40 : 52)
            .frame(maxWidth: compact ? nil : .infinity)
            .background(MM.Color.glass, in: RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous).stroke(MM.Color.border, lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
    }
}

extension ButtonStyle where Self == GoldButtonStyle {
    static var gold: GoldButtonStyle { GoldButtonStyle() }
    static var goldCompact: GoldButtonStyle { GoldButtonStyle(compact: true) }
}

extension ButtonStyle where Self == GlassButtonStyle {
    static var glass: GlassButtonStyle { GlassButtonStyle() }
    static var glassCompact: GlassButtonStyle { GlassButtonStyle(compact: true) }
}

// MARK: - Badges

struct LiveBadge: View {
    var viewers: Int?
    @State private var pulse = false

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(MM.Color.navy).frame(width: 6, height: 6)
                .opacity(pulse ? 0.35 : 1)
                .onAppear { withAnimation(.easeInOut(duration: 0.9).repeatForever()) { pulse = true } }
            Text("LIVE").font(MM.Font.body(11, weight: .heavy)).tracking(0.8)
            if let viewers {
                Text("· \(Format.count(viewers))").font(MM.Font.data(11, weight: .semibold))
            }
        }
        .foregroundStyle(MM.Color.navy)
        .lineLimit(1)
        .fixedSize()
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(MM.Color.green, in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

struct Pill: View {
    let text: LocalizedStringKey
    var systemImage: String?
    var tint: Color = MM.Color.gold

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage { Image(systemName: systemImage).font(.system(size: 10, weight: .bold)) }
            Text(text).font(MM.Font.body(11, weight: .bold))
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(tint.opacity(0.14), in: Capsule())
        .overlay(Capsule().stroke(tint.opacity(0.3), lineWidth: 1))
    }
}

struct VerifiedMark: View {
    var body: some View {
        Image(systemName: "checkmark.seal.fill")
            .font(.system(size: 12))
            .foregroundStyle(MM.Color.gold)
            .accessibilityLabel(Text("Verified"))
    }
}

// MARK: - Countdown

struct CountdownText: View {
    let end: Date
    var size: CGFloat = 13

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let text = Format.countdown(to: end, now: context.date)
            let urgent = end.timeIntervalSince(context.date) < 60
            Label {
                Text(text ?? String(localized: "Ended")).font(MM.Font.data(size, weight: .bold))
            } icon: {
                Image(systemName: "timer").font(.system(size: size - 2, weight: .bold))
            }
            .foregroundStyle(text == nil ? MM.Color.ink3 : (urgent ? MM.Color.errorText : MM.Color.ink))
            .contentTransition(.numericText(countsDown: true))
        }
    }
}

// MARK: - Avatar

struct AvatarView: View {
    let url: String?
    let name: String
    var size: CGFloat = 36

    var body: some View {
        ZStack {
            if url != nil {
                ArtworkView(source: url, symbol: "person.fill", initialsSize: 0.39)
            } else {
                MM.Gradient.gold
                Text(String(name.prefix(1)).uppercased()).font(.system(size: size * 0.42, weight: .bold, design: .rounded)).foregroundStyle(MM.Color.navy)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().stroke(MM.Color.goldLine, lineWidth: 1))
        .accessibilityHidden(true)
    }
}

// MARK: - Section header

struct SectionHeader<Trailing: View>: View {
    let title: LocalizedStringKey
    var subtitle: LocalizedStringKey?
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(MM.Font.display(21)).foregroundStyle(MM.Color.ink)
                if let subtitle { Text(subtitle).font(MM.Font.body(13)).foregroundStyle(MM.Color.ink3) }
            }
            Spacer()
            trailing()
        }
        .padding(.horizontal, MM.Space.screen)
        .accessibilityAddTraits(.isHeader)
    }
}

extension SectionHeader where Trailing == EmptyView {
    init(title: LocalizedStringKey, subtitle: LocalizedStringKey? = nil) {
        self.init(title: title, subtitle: subtitle, trailing: { EmptyView() })
    }
}

// MARK: - Cards

struct CardBackground: ViewModifier {
    var radius: CGFloat = MM.Radius.lg
    func body(content: Content) -> some View {
        content
            .background(MM.Color.card, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(MM.Gradient.sheen).allowsHitTesting(false))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(MM.Color.border, lineWidth: 1))
    }
}

extension View {
    func mmCard(radius: CGFloat = MM.Radius.lg) -> some View { modifier(CardBackground(radius: radius)) }

    func mmScreen() -> some View {
        background(MM.Color.surface.ignoresSafeArea())
            .toolbarBackground(MM.Color.surface, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

enum LotStatusText {
    static func label(_ auction: Auction) -> LocalizedStringKey {
        switch auction.status {
        case .live: return auction.auctionType == .buyNow ? "Buy now" : "Live"
        case .scheduled: return "Upcoming"
        case .sold: return "Sold"
        case .ended: return "Ended"
        case .cancelled: return "Cancelled"
        default: return ""
        }
    }

    /// Spoken summary used by VoiceOver and UI tests.
    static func accessibility(_ auction: Auction) -> String {
        let price = Format.money(auction.displayPrice, auction.currency)
        let bids = auction.bidCount == 1 ? String(localized: "1 bid") : String(localized: "\(auction.bidCount) bids")
        let state: String
        switch auction.status {
        case .live:
            state = Format.countdown(to: auction.endDate).map { String(localized: "ends in \($0)") } ?? String(localized: "ending")
        case .scheduled: state = String(localized: "upcoming")
        case .sold: state = String(localized: "sold")
        default: state = String(localized: "ended")
        }
        return "\(auction.title), \(price), \(bids), \(state)"
    }
}

struct LotCard: View {
    let auction: Auction
    var width: CGFloat? = 172
    @Environment(WatchlistStore.self) private var watchlist

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                ArtworkView(source: auction.coverImage, symbol: Catalog.category(auction.categoryId).symbol)
                    .aspectRatio(1, contentMode: .fit)
                HStack {
                    if auction.status == .live && auction.auctionType != .buyNow { LiveBadge() }
                    else if auction.status != .live { Pill(text: LotStatusText.label(auction), tint: auction.status == .sold ? MM.Color.green : MM.Color.ink2) }
                    Spacer()
                    Button { watchlist.toggle(auction.id) } label: {
                        Image(systemName: watchlist.contains(auction.id) ? "heart.fill" : "heart")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(watchlist.contains(auction.id) ? MM.Color.gold : .white)
                            .frame(width: 30, height: 30)
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(watchlist.contains(auction.id) ? Text("Remove from watchlist") : Text("Add to watchlist"))
                }
                .padding(8)
            }
            .clipShape(UnevenRoundedRectangle(topLeadingRadius: MM.Radius.lg, topTrailingRadius: MM.Radius.lg, style: .continuous))

            VStack(alignment: .leading, spacing: 6) {
                Text(auction.title).font(MM.Font.body(14, weight: .semibold)).foregroundStyle(MM.Color.ink).lineLimit(2, reservesSpace: true)
                HStack(spacing: 4) {
                    Text(auction.seller?.displayName ?? "").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3).lineLimit(1)
                    if auction.seller?.isVerified == true { VerifiedMark() }
                }
                HStack(alignment: .firstTextBaseline) {
                    Text(Format.money(auction.displayPrice, auction.currency)).font(MM.Font.data(17)).foregroundStyle(MM.Color.gold)
                    Spacer(minLength: 4)
                    if auction.status == .live { CountdownText(end: auction.endDate, size: 11) }
                    else { Text("\(auction.bidCount) bids").font(MM.Font.body(11)).foregroundStyle(MM.Color.ink3) }
                }
            }
            .padding(10)
        }
        .frame(width: width)
        .mmCard()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(LotStatusText.accessibility(auction))
        .accessibilityHint(Text("Opens the lot"))
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("lot-\(auction.id)")
    }
}

struct StreamCard: View {
    let stream: LiveStream
    var width: CGFloat? = 240
    var height: CGFloat = 320

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            ArtworkView(source: stream.posterUrl, symbol: "dot.radiowaves.left.and.right")
            MM.Gradient.heroScrim
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    if stream.isLive { LiveBadge(viewers: stream.viewerCount) }
                    else { Pill(text: "Starts soon", systemImage: "calendar") }
                    Spacer()
                }
                Spacer()
                HStack(spacing: 8) {
                    AvatarView(url: stream.creator?.avatarUrl, name: stream.creator?.displayName ?? "M", size: 28)
                    Text(stream.creator?.displayName ?? "").font(MM.Font.body(13, weight: .semibold)).foregroundStyle(MM.Color.ink)
                    if stream.creator?.isVerified == true { VerifiedMark() }
                }
                Text(stream.title).font(MM.Font.display(18)).foregroundStyle(.white).lineLimit(2)
                if let category = stream.category {
                    Text(Catalog.category(category).label).font(MM.Font.body(12)).foregroundStyle(MM.Color.ink2)
                }
            }
            .padding(14)
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: MM.Radius.xl, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: MM.Radius.xl, style: .continuous).stroke(stream.isLive ? MM.Color.green.opacity(0.45) : MM.Color.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(stream.isLive
            ? String(localized: "Live show: \(stream.title), \(stream.creator?.displayName ?? ""), \(Format.count(stream.viewerCount)) watching")
            : String(localized: "Upcoming show: \(stream.title)")))
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("stream-\(stream.id)")
    }
}

// MARK: - States

struct LoadingState: View {
    var body: some View {
        VStack(spacing: 12) {
            ProgressView().tint(MM.Color.gold).controlSize(.large)
            Text("Loading…").font(MM.Font.body(13)).foregroundStyle(MM.Color.ink3)
        }
        .frame(maxWidth: .infinity, minHeight: 220)
    }
}

struct ErrorState: View {
    let message: String
    var retry: (() -> Void)?

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "wifi.exclamationmark").font(.system(size: 34)).foregroundStyle(MM.Color.gold)
            Text(message).font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2).multilineTextAlignment(.center)
            if let retry { Button("Try again", action: retry).buttonStyle(.glassCompact) }
        }
        .padding(32)
        .frame(maxWidth: .infinity)
    }
}

struct EmptyStateView: View {
    let symbol: String
    let title: LocalizedStringKey
    let message: LocalizedStringKey

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: symbol).font(.system(size: 34)).foregroundStyle(MM.Color.goldLine)
            Text(title).font(MM.Font.display(18)).foregroundStyle(MM.Color.ink)
            Text(message).font(MM.Font.body(14)).foregroundStyle(MM.Color.ink3).multilineTextAlignment(.center)
        }
        .padding(32)
        .frame(maxWidth: .infinity)
    }
}

struct InputField: View {
    let title: LocalizedStringKey
    @Binding var text: String
    var prompt: LocalizedStringKey = ""
    var keyboard: UIKeyboardType = .default
    var axis: Axis = .horizontal

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(MM.Font.body(12, weight: .semibold)).foregroundStyle(MM.Color.ink2)
            TextField(title, text: $text, prompt: Text(prompt).foregroundStyle(MM.Color.ink3), axis: axis)
                .keyboardType(keyboard)
                .font(MM.Font.body(16))
                .foregroundStyle(MM.Color.ink)
                .padding(.horizontal, 14).padding(.vertical, 13)
                .background(MM.Color.raised, in: RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous).stroke(MM.Color.border, lineWidth: 1))
        }
    }
}
