import SwiftUI

/// Follow / unfollow with the live count, shared by the host sheet and the seller profile.
@MainActor
@Observable
final class FollowModel {
    let userId: String
    var following = false
    var blocked = false
    var followers = 0
    var busy = false

    init(userId: String, followers: Int = 0) {
        self.userId = userId
        self.followers = followers
    }

    func load() async {
        guard let r = try? await APIClient.shared.relationship(userId) else { return }
        following = r.following
        blocked = r.blocked
        followers = r.followersCount ?? followers
    }

    func toggle() async {
        busy = true
        defer { busy = false }
        let target = !following
        following = target
        followers += target ? 1 : -1
        do {
            let r = try await APIClient.shared.follow(userId, on: target)
            following = r.following
            followers = r.followersCount ?? followers
        } catch {
            following = !target
            followers += target ? -1 : 1
        }
    }

    func setBlocked(_ on: Bool) async {
        if (try? await APIClient.shared.block(userId, on: on)) != nil {
            blocked = on
            if on { following = false }
            BuyerState.shared.setBlocked(userId, on)
        }
    }
}

/// Tap the host in a live show.
struct HostSheet: View {
    let host: PublicProfile
    var shareURL: URL?
    var showTitle: String = ""
    var showId: String?
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    @State private var model: FollowModel
    @State private var reporting = false
    @State private var confirmBlock = false

    init(host: PublicProfile, shareURL: URL? = nil, showTitle: String = "", showId: String? = nil) {
        self.host = host
        self.shareURL = shareURL
        self.showTitle = showTitle
        self.showId = showId
        _model = State(initialValue: FollowModel(userId: host.id, followers: host.followersCount ?? 0))
    }

    private var isMe: Bool { session.user?.id == host.id }

    var body: some View {
        VStack(spacing: 16) {
            AvatarView(url: host.avatarUrl, name: host.displayName, size: 72)
            HStack(spacing: 6) {
                Text(host.displayName).font(MM.Font.display(22)).foregroundStyle(MM.Color.ink)
                if host.isVerified == true { VerifiedMark() }
            }
            Text("@\(host.handle)").font(MM.Font.body(13)).foregroundStyle(MM.Color.ink3)
            HStack {
                stat(String(format: "%.1f★", host.rating ?? 0), "Rating")
                stat("\(host.totalSales ?? 0)", "Sold")
                stat(Format.count(model.followers), "Followers")
                stat(host.responseTimeMinutes.map { "\($0)m" } ?? "—", "Replies in")
            }
            .padding(.vertical, 10).mmCard()
            if !isMe {
                FollowButton(model: model, identifier: "host-follow")
            }
            HStack(spacing: 10) {
                Button {
                    dismiss()
                    router.profilePath.append(.seller(host.handle))
                    router.tab = .profile
                } label: { Label("Shop & shows", systemImage: "storefront").frame(maxWidth: .infinity) }
                    .buttonStyle(.glass)
                    .accessibilityIdentifier("host-profile")
                if let shareURL {
                    ShareLink(item: shareURL, subject: Text(showTitle), message: Text(showTitle)) {
                        Label("Share", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)
                }
            }
            if !isMe {
                HStack(spacing: 20) {
                    Button("Report") { RequiresSignIn.run(session, router) { reporting = true } }.accessibilityIdentifier("host-report")
                    Button(model.blocked ? "Unblock" : "Block", role: .destructive) { RequiresSignIn.run(session, router) { if model.blocked { Task { await model.setBlocked(false) } } else { confirmBlock = true } } }
                        .accessibilityIdentifier("host-block")
                }
                .font(MM.Font.body(13, weight: .semibold))
            }
        }
        .padding(22)
        .frame(maxWidth: .infinity)
        .task { if session.isSignedIn { await model.load() } }
        .sheet(isPresented: $reporting) { ReportSheet(kind: showId == nil ? "user" : "user", targetId: host.id, subject: "@\(host.handle)") }
        .confirmationDialog("Block @\(host.handle)?", isPresented: $confirmBlock, titleVisibility: .visible) {
            Button("Block", role: .destructive) { Task { await model.setBlocked(true) } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("You won’t see their messages, and you’ll stop following each other.") }
        .presentationDetents([.medium, .large])
        .presentationBackground(MM.Color.surface)
    }

    private func stat(_ value: String, _ label: LocalizedStringKey) -> some View {
        VStack(spacing: 2) {
            Text(value).font(MM.Font.data(16)).foregroundStyle(MM.Color.ink)
            Text(label).font(MM.Font.body(11)).foregroundStyle(MM.Color.ink3)
        }
        .frame(maxWidth: .infinity)
    }
}

/// A seller's public page: follow, shop, shows.
struct SellerProfileView: View {
    let handle: String
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @State private var detail: UserProfileResponse?
    @State private var shows: [LiveStream] = []
    @State private var model: FollowModel?
    @State private var tab = 0
    @State private var error: String?
    @State private var reporting = false
    @State private var confirmBlock = false
    @State private var ranks: RanksResponse?
    @State private var club: ClubInfo?

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if let detail, let model {
                    header(detail.profile, model)
                    extras
                    Picker("", selection: $tab) {
                        Text("Shop").tag(0)
                        Text("Shows").tag(1)
                    }
                    .pickerStyle(.segmented)
                    if tab == 0 {
                        let open = detail.listings.filter { $0.status == .live || $0.status == .scheduled }
                        if open.isEmpty { EmptyStateView(symbol: "storefront", title: "Nothing listed right now", message: "Follow to hear when new items and shows go up.") }
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                            ForEach(open) { lot in
                                NavigationLink(value: Router.Route.auction(lot.id)) { LotCard(auction: lot, width: nil) }
                            }
                        }
                    } else {
                        if shows.isEmpty { EmptyStateView(symbol: "dot.radiowaves.left.and.right", title: "No shows yet", message: "Upcoming and live shows appear here.") }
                        ForEach(shows) { show in
                            NavigationLink(value: Router.Route.stream(show.id)) { StreamCard(stream: show, width: nil, height: 220) }
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
        .navigationTitle("@\(handle)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let profile = detail?.profile, profile.id != session.user?.id {
                Menu {
                    Button("Report", systemImage: "flag") { RequiresSignIn.run(session, router) { reporting = true } }
                    Button(model?.blocked == true ? "Unblock" : "Block", systemImage: "hand.raised", role: .destructive) {
                        RequiresSignIn.run(session, router) { if model?.blocked == true { Task { await model?.setBlocked(false) } } else { confirmBlock = true } }
                    }
                } label: { Image(systemName: "ellipsis.circle") }
                .accessibilityIdentifier("seller-menu")
            }
        }
        .sheet(isPresented: $reporting) { if let p = detail?.profile { ReportSheet(kind: "user", targetId: p.id, subject: "@\(p.handle)") } }
        .confirmationDialog("Block @\(handle)?", isPresented: $confirmBlock, titleVisibility: .visible) {
            Button("Block", role: .destructive) { Task { await model?.setBlocked(true) } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("You won’t see their messages, and you’ll stop following each other.") }
        .task { await load() }
        .refreshable { await load() }
        .mmScreen()
    }

    private func header(_ p: PublicProfile, _ model: FollowModel) -> some View {
        VStack(spacing: 10) {
            AvatarView(url: p.avatarUrl, name: p.displayName, size: 84)
            HStack(spacing: 6) {
                Text(p.displayName).font(MM.Font.display(24)).foregroundStyle(MM.Color.ink)
                if p.isVerified == true { VerifiedMark() }
                if p.isLive == true { Pill(text: "LIVE", tint: MM.Color.errorText) }
            }
            if let bio = p.bio, !bio.isEmpty { Text(bio).font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2).multilineTextAlignment(.center) }
            HStack {
                VStack { Text(Format.count(model.followers)).font(MM.Font.data(17)); Text("Followers").font(MM.Font.body(11)).foregroundStyle(MM.Color.ink3) }.frame(maxWidth: .infinity)
                VStack { Text("\(p.totalSales ?? 0)").font(MM.Font.data(17)); Text("Sold").font(MM.Font.body(11)).foregroundStyle(MM.Color.ink3) }.frame(maxWidth: .infinity)
                VStack { Text(String(format: "%.1f", p.rating ?? 0)).font(MM.Font.data(17)); Text("Rating").font(MM.Font.body(11)).foregroundStyle(MM.Color.ink3) }.frame(maxWidth: .infinity)
            }
            .foregroundStyle(MM.Color.ink)
            .padding(.vertical, 10).mmCard()
            if p.id != session.user?.id {
                HStack(spacing: 10) {
                    FollowButton(model: model, identifier: "seller-follow")
                    Button { RequiresSignIn.run(session, router) { router.profilePath.append(.thread(p.id)); router.tab = .profile } } label: {
                        Label("Message", systemImage: "bubble.left.fill").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)
                    .accessibilityIdentifier("seller-message")
                }
            }
        }
    }

    @ViewBuilder
    private var extras: some View {
        if let vacation = ranks?.vacation, vacation.on {
            Label(vacation.message ?? String(localized: "This seller is away right now. New items and offers are paused."), systemImage: "sun.max.fill")
                .font(MM.Font.body(13, weight: .semibold)).foregroundStyle(MM.Color.ink)
                .frame(maxWidth: .infinity, alignment: .leading).padding(12).mmCard()
                .accessibilityIdentifier("seller-vacation")
        }
        if let items = ranks?.items, !items.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(items.prefix(4)) { r in
                        Pill(text: LocalizedStringKey("#\(r.rank) " + String(localized: "in \(r.label)")), systemImage: "trophy.fill", tint: MM.Color.gold)
                    }
                }
            }
            .accessibilityIdentifier("seller-ranks")
        }
        if let club, detail?.profile.id != session.user?.id {
            HStack(spacing: 10) {
                Image(systemName: "crown.fill").foregroundStyle(MM.Color.gold)
                VStack(alignment: .leading, spacing: 2) {
                    if let tier = club.you?.tier {
                        Text("You’re in the \(tier.label) club").font(MM.Font.body(14, weight: .semibold)).foregroundStyle(MM.Color.ink)
                        if let perk = tier.perk { Text(perk).font(MM.Font.body(12)).foregroundStyle(MM.Color.ink2) }
                    } else {
                        Text("Rewards club").font(MM.Font.body(14, weight: .semibold)).foregroundStyle(MM.Color.ink)
                        Text("Buy from this seller to join Bronze, Silver and Gold.").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink2)
                    }
                }
                Spacer()
                Text("\(club.tiers.reduce(0) { $0 + $1.members }) " + String(localized: "members")).font(MM.Font.body(11)).foregroundStyle(MM.Color.ink3)
            }
            .padding(12).mmCard()
            .accessibilityIdentifier("seller-club")
        }
    }

    private func load() async {
        do {
            let d = try await APIClient.shared.userProfile(handle: handle)
            detail = d
            if model == nil { model = FollowModel(userId: d.profile.id, followers: d.profile.followersCount ?? 0) }
            if session.isSignedIn { await model?.load() }
            shows = (try? await APIClient.shared.streams(creator: d.profile.id).items.filter { $0.status != "ended" }) ?? []
            ranks = try? await APIClient.shared.ranks(userId: d.profile.id)
            club = try? await APIClient.shared.club(sellerId: d.profile.id)
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

/// Report a member, listing, show or chat message to MoneyMart.
struct ReportSheet: View {
    let kind: String
    let targetId: String
    var contextId: String?
    var subject: String
    @Environment(\.dismiss) private var dismiss
    @State private var reason = "harassment"
    @State private var note = ""
    @State private var sent = false
    @State private var error: String?
    private let reasons: [(String, LocalizedStringKey)] = [
        ("harassment", "Harassment or hate"), ("scam", "Scam or fraud"), ("counterfeit", "Counterfeit or misrepresented item"),
        ("prohibited", "Prohibited item"), ("explicit", "Sexual or explicit content"), ("spam", "Spam"), ("other", "Something else"),
    ]

    var body: some View {
        NavigationStack {
            Form {
                if sent {
                    Label("Thanks — our team will review it. You can also block them.", systemImage: "checkmark.shield.fill").foregroundStyle(MM.Color.green)
                } else {
                    Section { Picker("Reason", selection: $reason) { ForEach(reasons, id: \.0) { Text($0.1).tag($0.0) } }.pickerStyle(.inline) } header: { Text("Report \(subject)") }
                    Section { TextField("Anything else we should know? (optional)", text: $note, axis: .vertical).lineLimit(2...5) }
                    if let error { Text(error).foregroundStyle(MM.Color.errorText) }
                    Section { Button("Send report") { Task { await send() } }.accessibilityIdentifier("report-send") }
                }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("Report").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button(sent ? "Done" : "Cancel") { dismiss() } }
            .mmScreen()
        }
        .presentationDetents([.medium, .large])
    }

    private func send() async {
        do {
            _ = try await APIClient.shared.report(kind: kind, targetId: targetId, contextId: contextId, reason: reason, note: note.isEmpty ? nil : note)
            sent = true
        } catch { self.error = error.localizedDescription }
    }
}

/// Follow / Following, gold until you follow.
struct FollowButton: View {
    let model: FollowModel
    var identifier: String
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router

    var body: some View {
        let action = { RequiresSignIn.run(session, router) { Task { await model.toggle() } } }
        Group {
            if model.following {
                Button(action: action) { Label("Following", systemImage: "checkmark").frame(maxWidth: .infinity) }.buttonStyle(.glass)
            } else {
                Button(action: action) { Label("Follow", systemImage: "plus").frame(maxWidth: .infinity) }.buttonStyle(.gold)
            }
        }
        .disabled(model.busy || model.blocked)
        .accessibilityIdentifier(identifier)
    }
}
