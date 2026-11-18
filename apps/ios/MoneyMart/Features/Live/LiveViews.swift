import SwiftUI
import AVKit
import Translation

struct LiveListView: View {
    @State private var feed = MarketFeed()

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                if feed.loading {
                    LoadingState()
                } else if let error = feed.error {
                    ErrorState(message: error) { Task { await feed.load() } }
                } else if feed.streams.isEmpty {
                    EmptyStateView(symbol: "dot.radiowaves.left.and.right", title: "No shows right now", message: "Live channels appear here the moment they go on air.")
                } else {
                    ForEach(feed.liveStreams + feed.upcomingStreams) { stream in
                        NavigationLink(value: Router.Route.stream(stream.id)) {
                            StreamCard(stream: stream, width: nil, height: 360)
                        }
                        .accessibilityIdentifier("stream-card-\(stream.id)")
                    }
                }
            }
            .padding(MM.Space.screen)
        }
        .buttonStyle(.plain)
        .navigationTitle("Live")
        .refreshable { await feed.load() }
        .task { if feed.streams.isEmpty { await feed.load() } }
        .mmScreen()
    }
}

// MARK: - Stream room

@MainActor
@Observable
final class StreamRoom {
    let streamId: String
    var stream: LiveStream?
    var chat: [ChatMessage] = []
    var queue: [Auction] = []
    var lot: BidController?
    var error: String?
    /// The viewer saved this scheduled show for a reminder.
    var reminded = false
    /// The message the host or a moderator pinned.
    var pinned: ChatMessage?

    @ObservationIgnored private var subscriptions: [RealtimeSubscription] = []

    init(streamId: String) { self.streamId = streamId }

    func load() async {
        do {
            let detail = try await APIClient.shared.stream(id: streamId)
            stream = detail.stream
            chat = detail.chat
            pinned = detail.chat.last(where: { $0.isPinned == true })
            queue = detail.queue
            reminded = detail.reminded ?? false
            await focus(on: detail.stream.activeAuctionId ?? detail.stream.activeAuction?.id)
            attach()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func focus(on auctionId: String?) async {
        guard let auctionId, lot?.auctionId != auctionId else { return }
        lot?.detach()
        let controller = BidController(auctionId: auctionId)
        lot = controller
        await controller.load()
    }

    private func attach() {
        guard subscriptions.isEmpty else { return }
        let realtime = Realtime.shared
        realtime.join("stream:join", streamId)
        let id = streamId
        subscriptions = [
            realtime.on("chat:message", as: ChatMessage.self) { [weak self] message in
                guard let self, message.streamId == id, !self.chat.contains(where: { $0.id == message.id }) else { return }
                self.chat.append(message)
                if self.chat.count > 200 { self.chat.removeFirst(self.chat.count - 200) }
            },
            realtime.on("chat:removed", as: ChatRemovedPayload.self) { [weak self] payload in
                guard let self, payload.streamId == id else { return }
                self.chat.removeAll { $0.id == payload.messageId }
            },
            realtime.on("chat:pin", as: ChatPinPayload.self) { [weak self] payload in
                guard let self, payload.streamId == id else { return }
                for index in self.chat.indices { self.chat[index].isPinned = self.chat[index].id == payload.message?.id }
                self.pinned = payload.message
            },
            realtime.on("stream:viewers", as: ViewersPayload.self) { [weak self] payload in
                guard payload.streamId == id else { return }
                self?.stream?.viewerCount = payload.viewerCount
            },
            realtime.on("stream:item", as: StreamItemPayload.self) { [weak self] payload in
                guard let self, payload.streamId == id else { return }
                Task { await self.focus(on: payload.auctionId) }
            },
            // The host started (or moved) the broadcast: reload so viewers join the video.
            realtime.on("stream:started", as: StreamStatePayload.self) { [weak self] payload in
                guard let self, payload.streamId == id else { return }
                Task { await self.load() }
            },
            realtime.on("stream:ended", as: StreamStatePayload.self) { [weak self] payload in
                guard let self, payload.streamId == id else { return }
                self.stream?.status = "ended"
                self.stream?.liveVideoProvider = nil
            },
        ]
    }

    /// Host or one of the show's moderators.
    func canModerate(_ userId: String?) -> Bool {
        guard let userId, let stream else { return false }
        return stream.creatorId == userId || (stream.moderators ?? []).contains { $0.id == userId }
    }

    func pin(_ message: ChatMessage?) async {
        _ = try? await APIClient.shared.pin(streamId: streamId, messageId: message?.id)
        pinned = message
    }

    func remove(_ message: ChatMessage) async {
        if (try? await APIClient.shared.removeMessage(streamId: streamId, messageId: message.id)) != nil {
            chat.removeAll { $0.id == message.id }
        }
    }

    func timeout(_ message: ChatMessage) async {
        _ = try? await APIClient.shared.timeout(streamId: streamId, userId: message.userId, minutes: 10)
    }

    func leave() {
        Realtime.shared.leave(join: "stream:join", leave: "stream:leave", streamId)
        subscriptions.removeAll()
        lot?.detach()
    }

    func send(_ text: String) {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        Realtime.shared.emit("chat:send", ["streamId": streamId, "body": String(body.prefix(400))])
    }
}

private struct StreamStatePayload: Decodable { var streamId: String }
private struct ChatRemovedPayload: Decodable { var streamId: String; var messageId: String }
private struct ChatPinPayload: Decodable { var streamId: String; var message: ChatMessage? }

struct HLSPlayerView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        let player = AVPlayer(url: url)
        player.isMuted = false
        player.automaticallyWaitsToMinimizeStalling = true
        controller.player = player
        controller.showsPlaybackControls = false
        controller.videoGravity = .resizeAspectFill
        controller.allowsPictureInPicturePlayback = true
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        player.play()
        context.coordinator.observe(player)
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if (controller.player?.currentItem?.asset as? AVURLAsset)?.url != url {
            controller.player?.replaceCurrentItem(with: AVPlayerItem(url: url))
            controller.player?.play()
        }
    }

    static func dismantleUIViewController(_ controller: AVPlayerViewController, coordinator: Coordinator) {
        controller.player?.pause()
        controller.player = nil
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    /// Loops a finished demo manifest so a room never freezes on its last frame.
    final class Coordinator {
        private var token: NSObjectProtocol?
        func observe(_ player: AVPlayer) {
            token = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak player] _ in
                player?.seek(to: .zero); player?.play()
            }
        }
        deinit { if let token { NotificationCenter.default.removeObserver(token) } }
    }
}

struct StreamView: View {
    let streamId: String
    @State private var room: StreamRoom
    @State private var draft = ""
    @State private var showBidSheet = false
    @State private var showChat = true
    @State private var video = LiveVideoSession(role: .viewer)
    @State private var confirmBuy = false
    @State private var showHost = false
    @State private var showShop = false
    @State private var showQuote = false
    @State private var reportTarget: ChatMessage?
    @Environment(SessionStore.self) private var session
    @Environment(BuyerState.self) private var buyer
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    init(streamId: String) {
        self.streamId = streamId
        _room = State(initialValue: StreamRoom(streamId: streamId))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if broadcasting {
                LiveVideoSurface(view: video.videoView).ignoresSafeArea()
                    .overlay { if !video.isLive { joiningCard } }
            } else if let url = room.stream?.playbackURL {
                HLSPlayerView(url: url).ignoresSafeArea()
            } else {
                ArtworkView(source: room.stream?.posterUrl, symbol: "dot.radiowaves.left.and.right").ignoresSafeArea()
                    .overlay { if room.stream != nil { offlineCard } }
            }
            LinearGradient(colors: [.black.opacity(0.55), .clear, .clear, .black.opacity(0.85)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea().allowsHitTesting(false)

            VStack(spacing: 10) {
                topBar
                roomBanners
                Spacer()
                if showChat {
                    ChatList(messages: room.chat.filter { !buyer.blocked.contains($0.userId) },
                             canModerate: room.canModerate(session.user?.id),
                             myId: session.user?.id,
                             onPin: { m in Task { await room.pin(m) } },
                             onRemove: { m in Task { await room.remove(m) } },
                             onTimeout: { m in Task { await room.timeout(m) } },
                             onReport: { m in RequiresSignIn.run(session, router) { reportTarget = m } })
                        .frame(maxHeight: 260)
                }
                if let lot = room.lot, let auction = lot.auction {
                    LiveLotBar(controller: lot, auction: auction,
                               onBid: { quickBid(lot) }, onCustom: { openBid() }, onBuy: { confirmBuy = true },
                               onCosts: { showQuote = true })
                        .confirmationDialog("Buy this item now?", isPresented: $confirmBuy, titleVisibility: .visible) {
                            Button("Buy for \(Format.money(auction.buyItNowPrice ?? 0, auction.currency))") { Task { await lot.buyNow() } }
                            Button("Cancel", role: .cancel) {}
                        } message: {
                            Text("All sales are final. It ships to your default address; pay from your orders.")
                        }
                } else if broadcasting {
                    Label("Awaiting the next item…", systemImage: "hourglass")
                        .font(MM.Font.body(13, weight: .semibold)).foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(.ultraThinMaterial, in: Capsule())
                }
                composer
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 6)

            if room.stream?.status == "ended" { endedCard }

            if let error = room.error, room.stream == nil {
                ErrorState(message: error) { Task { await room.load() } }.background(MM.Color.surface)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .task { await room.load() }
        .task(id: broadcastKey) { await joinVideo() }
        .onDisappear {
            video.stop()
            room.leave()
        }
        .sheet(isPresented: $showBidSheet) {
            if let lot = room.lot { BidSheet(controller: lot).presentationDetents([.medium, .large]) }
        }
        .sheet(isPresented: $showHost) {
            if let creator = room.stream?.creator {
                HostSheet(host: creator, shareURL: room.stream?.shareUrl.flatMap(URL.init(string:)), showTitle: room.stream?.title ?? "", showId: streamId)
            }
        }
        .sheet(isPresented: $showShop) { ShowShopSheet(items: room.queue, active: room.lot?.auctionId).presentationDetents([.medium, .large]) }
        .sheet(isPresented: $showQuote) {
            if let lot = room.lot, let auction = lot.auction {
                QuoteSheet(auctionId: auction.id, price: auction.buyItNowPrice.flatMap { lot.canBuyNow ? $0 : nil } ?? lot.minimumBid, currency: auction.currency)
                    .presentationDetents([.medium])
            }
        }
        .sheet(item: $reportTarget) { message in
            ReportSheet(kind: "message", targetId: message.id, contextId: streamId, subject: message.displayName)
        }
        .sheet(isPresented: Binding(get: { room.lot?.needsShippingInfo == true && !showBidSheet }, set: { if !$0 { room.lot?.needsShippingInfo = false } })) {
            ShippingInfoSheet { Task { await room.lot?.resumeAfterShippingInfo() } }
        }
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left").font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 38, height: 38).background(.ultraThinMaterial, in: Circle())
            }
            .accessibilityLabel("Back")
            if let creator = room.stream?.creator {
                Button { showHost = true } label: {
                HStack(spacing: 8) {
                AvatarView(url: creator.avatarUrl, name: creator.displayName, size: 34)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Text(creator.displayName).font(MM.Font.body(14, weight: .bold)).foregroundStyle(.white).lineLimit(1)
                        if creator.isVerified == true { VerifiedMark() }
                    }
                    Text(room.stream?.playback?.mode == "demo" ? String(localized: "Demo feed") : (room.stream?.title ?? ""))
                        .font(MM.Font.body(11)).foregroundStyle(.white.opacity(0.75)).lineLimit(1)
                }
                }
                }
                .buttonStyle(.plain)
                .layoutPriority(1)
                .accessibilityIdentifier("stream-host")
            }
            Spacer(minLength: 4)
            if let stream = room.stream, stream.isLive { LiveBadge(viewers: stream.viewerCount) }
            if !room.queue.isEmpty {
                Button { showShop = true } label: {
                    Image(systemName: "storefront.fill").foregroundStyle(.white)
                        .frame(width: 38, height: 38).background(.ultraThinMaterial, in: Circle())
                        .overlay(alignment: .topTrailing) {
                            Text("\(room.queue.count)").font(.system(size: 10, weight: .bold)).foregroundStyle(MM.Color.navy)
                                .padding(.horizontal, 4).background(MM.Color.gold, in: Capsule()).offset(x: 4, y: -2)
                        }
                }
                .accessibilityLabel("Shop this show")
                .accessibilityIdentifier("stream-shop")
            }
            Button { withAnimation { showChat.toggle() } } label: {
                Image(systemName: showChat ? "bubble.left.fill" : "bubble.left").foregroundStyle(.white)
                    .frame(width: 38, height: 38).background(.ultraThinMaterial, in: Circle())
            }
            .accessibilityLabel(showChat ? Text("Hide chat") : Text("Show chat"))
        }
    }

    @ViewBuilder
    private var roomBanners: some View {
        VStack(alignment: .leading, spacing: 6) {
            if room.stream?.explicit == true {
                Label("This show may contain mature content", systemImage: "exclamationmark.triangle.fill")
                    .font(MM.Font.body(11, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 10).padding(.vertical, 6).background(MM.Color.errorText.opacity(0.75), in: Capsule())
            }
            if let pinned = room.pinned {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "pin.fill").font(.system(size: 11)).foregroundStyle(MM.Color.gold)
                    Text("\(pinned.displayName): \(pinned.body)").font(MM.Font.body(12, weight: .medium)).foregroundStyle(.white).lineLimit(2)
                    if room.canModerate(session.user?.id) {
                        Button { Task { await room.pin(nil) } } label: { Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundStyle(.white.opacity(0.7)) }
                            .accessibilityLabel("Unpin")
                    }
                }
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityIdentifier("stream-pinned")
            }
            if let notes = room.stream?.description, !notes.isEmpty, room.stream?.isLive == true {
                DisclosureGroup {
                    Text(notes).font(MM.Font.body(12)).foregroundStyle(.white).frame(maxWidth: .infinity, alignment: .leading)
                } label: {
                    Label("Show notes", systemImage: "note.text").font(MM.Font.body(12, weight: .semibold)).foregroundStyle(MM.Color.gold)
                }
                .tint(MM.Color.gold)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .frame(maxWidth: 260, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var endedCard: some View {
        VStack(spacing: 12) {
            Image(systemName: "flag.checkered").font(.system(size: 34)).foregroundStyle(MM.Color.gold)
            Text("This show has ended").font(MM.Font.display(22)).foregroundStyle(.white)
            if let creator = room.stream?.creator {
                Button {
                    router.profilePath = [.seller(creator.handle)]
                    router.tab = .profile
                } label: { Label("See @\(creator.handle)’s upcoming shows", systemImage: "calendar") }
                    .buttonStyle(.goldCompact)
                    .accessibilityIdentifier("stream-ended-upcoming")
            }
            Button("Browse live shows") { router.livePath = []; router.tab = .live; dismiss() }
                .buttonStyle(.glassCompact)
        }
        .padding(24)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: MM.Radius.xl))
        .accessibilityIdentifier("stream-ended")
    }

    /// A real broadcast (IVS or Cloudflare) rather than an HLS feed.
    private var broadcasting: Bool { room.stream?.isLive == true && room.stream?.liveVideoProvider != nil }
    private var broadcastKey: String { "\(broadcasting)-\(room.stream?.liveVideoProvider ?? "")" }

    private func joinVideo() async {
        guard broadcasting else { video.stop(endState: .idle); return }
        do {
            let watch = try await APIClient.shared.watch(streamId: streamId)
            video.startWatching(watch.viewer)
        } catch {
            video.stop(endState: .failed(error.localizedDescription))
        }
    }

    private var joiningCard: some View {
        VStack(spacing: 10) {
            if case .failed(let reason) = video.state {
                Image(systemName: "wifi.exclamationmark").font(.system(size: 30)).foregroundStyle(MM.Color.gold)
                Text(reason).font(MM.Font.body(14)).foregroundStyle(.white).multilineTextAlignment(.center)
                Button("Try again") { Task { await joinVideo() } }.buttonStyle(.goldCompact)
            } else {
                ProgressView().tint(MM.Color.gold)
                Text("Joining the show…").font(MM.Font.body(14)).foregroundStyle(.white)
            }
        }
        .padding(22).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: MM.Radius.xl))
    }

    private var offlineCard: some View {
        VStack(spacing: 8) {
            Image(systemName: "calendar.badge.clock").font(.system(size: 36)).foregroundStyle(MM.Color.gold)
            Text(room.stream?.playback?.label ?? String(localized: "Starts soon")).font(MM.Font.display(22)).foregroundStyle(.white)
            if let start = room.stream?.scheduledStartTime.flatMap(ISODate.parse) {
                Text(start.formatted(date: .abbreviated, time: .shortened)).font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2)
                if start > .now { CountdownText(end: start) }
            }
            if let stream = room.stream, stream.isScheduled {
                if stream.creatorId != session.user?.id {
                    Button(action: toggleReminder) {
                        Label(room.reminded ? "Saved — we’ll remind you" : "Remind me", systemImage: room.reminded ? "bell.fill" : "bell")
                    }
                    .buttonStyle(.goldCompact)
                    .accessibilityIdentifier("stream-remind")
                }
                if let link = stream.shareUrl.flatMap(URL.init(string:)) {
                    ShareLink(item: link, subject: Text(stream.title), message: Text(stream.title)) {
                        Label("Share show", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(.glassCompact)
                }
            }
        }
        .padding(24).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: MM.Radius.xl))
    }

    private var composer: some View {
        HStack(spacing: 8) {
            TextField("Say something…", text: $draft)
                .font(MM.Font.body(15)).foregroundStyle(.white)
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(.ultraThinMaterial, in: Capsule())
                .submitLabel(.send)
                .onSubmit(sendChat)
                .disabled(room.stream?.chatEnabled == false)
                .accessibilityIdentifier("stream-chat-input")
            Button(action: sendChat) {
                Image(systemName: "paperplane.fill").foregroundStyle(MM.Color.navy)
                    .frame(width: 42, height: 42).background(MM.Gradient.gold, in: Circle())
            }
            .accessibilityLabel("Send message")
        }
    }

    private func sendChat() {
        RequiresSignIn.run(session, router) {
            room.send(draft)
            draft = ""
        }
    }

    private func toggleReminder() {
        RequiresSignIn.run(session, router) {
            let target = !room.reminded
            room.reminded = target
            Task {
                do {
                    let result = try await APIClient.shared.setReminder(streamId: streamId, on: target)
                    room.reminded = result.reminded
                    room.stream?.reminderCount = result.reminderCount
                } catch {
                    room.reminded = !target
                }
            }
        }
    }

    /// One-tap bid at the next amount, the way live auctions are run.
    private func quickBid(_ lot: BidController) {
        RequiresSignIn.run(session, router) {
            Task { await lot.place(lot.minimumBid) }
        }
    }

    private func openBid() {
        RequiresSignIn.run(session, router) { showBidSheet = true }
    }
}

struct ChatList: View {
    let messages: [ChatMessage]
    var canModerate = false
    var myId: String?
    var onPin: (ChatMessage) -> Void = { _ in }
    var onRemove: (ChatMessage) -> Void = { _ in }
    var onTimeout: (ChatMessage) -> Void = { _ in }
    var onReport: (ChatMessage) -> Void = { _ in }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(showsIndicators: false) {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(messages) { message in
                        ChatRow(message: message).id(message.id)
                            .contextMenu {
                                if canModerate {
                                    Button("Pin", systemImage: "pin") { onPin(message) }
                                    Button("Remove message", systemImage: "trash", role: .destructive) { onRemove(message) }
                                    if message.userId != myId && message.isCreator != true {
                                        Button("Time out for 10 minutes", systemImage: "timer") { onTimeout(message) }
                                    }
                                }
                                if message.userId != myId {
                                    Button("Report message", systemImage: "flag") { onReport(message) }
                                }
                            }
                    }
                }
                .padding(.vertical, 6)
            }
            .mask(LinearGradient(colors: [.clear, .black, .black], startPoint: .top, endPoint: .init(x: 0.5, y: 0.25)))
            .onChange(of: messages.count) {
                if let last = messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
            }
            .onAppear { if let last = messages.last { proxy.scrollTo(last.id, anchor: .bottom) } }
        }
    }
}

/// A chat line with on-device language detection and Apple Translation.
struct ChatRow: View {
    let message: ChatMessage
    @State private var translate = false

    var body: some View {
        let foreign = LanguageDetector.isForeign(message.body)
        HStack(alignment: .top, spacing: 8) {
            AvatarView(url: nil, name: message.displayName, size: 24)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(message.displayName).font(MM.Font.body(12, weight: .bold)).foregroundStyle(message.isCreator == true ? MM.Color.gold : .white.opacity(0.85))
                    if message.isCreator == true { Pill(text: "Host", tint: MM.Color.gold) }
                    if message.isModerator == true { Pill(text: "Mod", tint: MM.Color.green) }
                }
                Text(message.body).font(MM.Font.body(14)).foregroundStyle(.white)
                if foreign, let code = LanguageDetector.detect(message.body) {
                    Button { translate = true } label: {
                        Label("Translate from \(LanguageDetector.displayName(code))", systemImage: "translate")
                            .font(MM.Font.body(11, weight: .semibold)).foregroundStyle(MM.Color.gold)
                    }
                    .translationPresentation(isPresented: $translate, text: message.body)
                }
            }
            Spacer(minLength: 40)
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(.black.opacity(0.28), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

struct LiveLotBar: View {
    let controller: BidController
    let auction: Auction
    /// One tap: bid the next amount.
    var onBid: () -> Void
    /// Choose an amount or set a maximum.
    var onCustom: () -> Void = {}
    var onBuy: () -> Void = {}
    /// Show item price, shipping, tax and total.
    var onCosts: () -> Void = {}
    /// The host sees the item, never the buttons.
    var showsActions = true

    var body: some View {
        VStack(spacing: 10) {
            if let banner = controller.banner {
                Text(banner.text).font(MM.Font.body(13, weight: .semibold))
                    .foregroundStyle(banner.kind == .warning ? MM.Color.errorText : MM.Color.green)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            HStack(spacing: 12) {
                ArtworkView(source: auction.coverImage, symbol: Catalog.category(auction.categoryId).symbol)
                    .frame(width: 54, height: 54).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(auction.title).font(MM.Font.body(13, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(Format.money(auction.displayPrice, auction.currency)).font(MM.Font.data(20)).foregroundStyle(MM.Color.gold)
                                .contentTransition(.numericText()).animation(.snappy, value: auction.currentBid)
                            if let approx = Markets.shared.approx(auction.displayPrice, from: auction.currency, to: SessionStore.viewerCurrency) {
                                Text(approx).font(MM.Font.body(10, weight: .medium)).foregroundStyle(.white.opacity(0.7))
                            }
                        }
                        if controller.isOpen { CountdownText(end: auction.endDate, size: 12) }
                        if auction.suddenDeath == true && controller.isOpen {
                            Label("Sudden death", systemImage: "bolt.fill").font(MM.Font.body(10, weight: .bold)).foregroundStyle(MM.Color.errorText)
                        }
                    }
                    HStack(spacing: 8) {
                        Text(statusLine).font(MM.Font.body(11)).foregroundStyle(.white.opacity(0.75)).lineLimit(1)
                        if let left = auction.unitsLeft {
                            Text(left == 0 ? String(localized: "Sold out") : String(localized: "\(left) left"))
                                .font(MM.Font.body(11, weight: .bold)).foregroundStyle(MM.Color.errorText)
                        }
                    }
                    if showsActions {
                        Button(action: onCosts) {
                            Label("Shipping & total", systemImage: "chevron.right").labelStyle(TrailingIcon())
                                .font(MM.Font.body(11, weight: .semibold)).foregroundStyle(MM.Color.gold)
                        }
                        .accessibilityIdentifier("stream-costs")
                    }
                }
                Spacer()
                if showsActions && controller.isOpen {
                    VStack(spacing: 6) {
                        Button("Bid \(Format.money(controller.minimumBid, auction.currency, compact: true))", action: onBid)
                            .buttonStyle(.goldCompact)
                            .disabled(controller.placing)
                            .accessibilityIdentifier("stream-bid")
                        Button("Custom", action: onCustom)
                            .font(MM.Font.body(12, weight: .semibold)).foregroundStyle(.white)
                            .accessibilityIdentifier("stream-bid-custom")
                    }
                }
            }
            if showsActions && controller.canBuyNow, let price = auction.buyItNowPrice {
                Button(action: onBuy) {
                    Label("Buy now \(Format.money(price, auction.currency))", systemImage: "bolt.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassCompact)
                .disabled(controller.placing)
                .accessibilityIdentifier("stream-buy-now")
            }
        }
        .padding(12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: MM.Radius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: MM.Radius.lg, style: .continuous).stroke(MM.Color.goldLine, lineWidth: 1))
        .animation(.spring, value: controller.banner)
    }

    private var statusLine: String {
        switch auction.status {
        case .sold:
            if let winner = controller.leaderHandle, auction.unitsLeft == nil {
                return String(localized: "@\(winner) won · \(Format.money(auction.hammerPrice ?? auction.currentBid, auction.currency))")
            }
            return String(localized: "Sold for \(Format.money(auction.hammerPrice ?? auction.currentBid, auction.currency))")
        case .ended:
            return String(localized: "No sale")
        default:
            if auction.bidCount == 0 { return String(localized: "No bids yet — starts at \(Format.money(auction.startingPrice, auction.currency))") }
            if let leader = controller.leaderHandle { return String(localized: "@\(leader) is winning · \(auction.bidCount) bids") }
            return auction.bidCount == 1 ? String(localized: "1 bid") : String(localized: "\(auction.bidCount) bids")
        }
    }
}


/// Label with the icon after the text ("Shipping & total ›").
struct TrailingIcon: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 2) { configuration.title; configuration.icon.font(.system(size: 9, weight: .bold)) }
    }
}

/// Everything the host has lined up for this show.
struct ShowShopSheet: View {
    let items: [Auction]
    var active: String?
    @State private var query = ""
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                let shown = items.filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) }
                if shown.isEmpty { Text("Nothing matches.").foregroundStyle(MM.Color.ink3).listRowBackground(Color.clear) }
                ForEach(shown) { lot in
                    HStack(spacing: 12) {
                        ArtworkView(source: lot.coverImage, symbol: Catalog.category(lot.categoryId).symbol)
                            .frame(width: 52, height: 52).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(lot.title).font(MM.Font.body(14, weight: .semibold)).foregroundStyle(MM.Color.ink).lineLimit(1)
                            HStack(spacing: 8) {
                                if lot.id == active { Pill(text: "ON NOW", tint: MM.Color.errorText) }
                                else if lot.status == .sold { Text("Sold").foregroundStyle(MM.Color.ink3) }
                                else if let price = lot.buyItNowPrice { Text("Buy now \(Format.money(price, lot.currency))").foregroundStyle(MM.Color.gold) }
                                else { Text("Starts \(Format.money(lot.startingPrice, lot.currency))").foregroundStyle(MM.Color.ink2) }
                                if let left = lot.unitsLeft { Text("\(left) left").foregroundStyle(MM.Color.errorText) }
                                if lot.bidCount > 0 { Text("\(lot.bidCount) bids").foregroundStyle(MM.Color.ink3) }
                            }
                            .font(MM.Font.body(12, weight: .semibold))
                        }
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { dismiss(); router.livePath.append(.auction(lot.id)) }
                    .listRowBackground(MM.Color.card)
                }
            }
            .scrollContentBackground(.hidden)
            .searchable(text: $query, prompt: "Search this show")
            .navigationTitle("Shop this show (\(items.count))").navigationBarTitleDisplayMode(.inline)
            .mmScreen()
        }
    }
}

/// Item, premium, shipping, tax and total for the signed-in buyer, shipped to their default address.
struct QuoteSheet: View {
    let auctionId: String
    let price: Double
    let currency: String
    @State private var quote: PriceQuote?
    @State private var error: String?
    @Environment(BuyerState.self) private var buyer
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("At \(Format.money(price, currency))").font(MM.Font.display(20)).foregroundStyle(MM.Color.ink)
                Spacer()
                Button("Done") { dismiss() }.font(MM.Font.body(14, weight: .semibold)).foregroundStyle(MM.Color.gold)
                    .accessibilityIdentifier("quote-done")
            }
            if let q = quote {
                line("Item", q.hammerPrice)
                if q.buyersPremium > 0 { line("Buyer’s premium (\(Int((q.buyersPremiumRate * 100).rounded()))%)", q.buyersPremium) }
                line("Shipping", q.shipping)
                if let note = q.shippingNote { Text(note).font(MM.Font.body(11)).foregroundStyle(MM.Color.ink3) }
                line("Estimated tax", q.tax)
                Divider().overlay(MM.Color.divider)
                HStack { Text("Total").font(MM.Font.body(15, weight: .bold)); Spacer(); Text(Format.money(q.total, q.currency)).font(MM.Font.data(18)).foregroundStyle(MM.Color.gold) }
                    .foregroundStyle(MM.Color.ink)
                if let viewer = q.viewerCurrency, viewer != q.currency, let converted = q.viewerTotal {
                    HStack { Spacer(); Text("≈ \(Format.money(converted.rounded(), viewer)) in your currency").font(MM.Font.body(12, weight: .medium)).foregroundStyle(MM.Color.ink2) }
                }
                if let address = buyer.defaultAddress {
                    Label("Ships to \(address.city), \(address.countryCode)", systemImage: "house.fill").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink2)
                }
            } else if let error {
                Text(error).foregroundStyle(MM.Color.errorText)
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
            Text("Nothing is charged until you win. Payment is held until your item arrives.").font(MM.Font.body(11)).foregroundStyle(MM.Color.ink3)
        }
        .padding(22)
        .task {
            do { quote = try await APIClient.shared.quote(auctionId: auctionId, price: price) } catch { self.error = error.localizedDescription }
        }
        .presentationBackground(MM.Color.surface)
    }

    private func line(_ label: String, _ amount: Double) -> some View {
        HStack {
            Text(label).font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2)
            Spacer()
            Text(amount == 0 && label == "Shipping" ? String(localized: "Free") : Format.money(amount, currency)).font(MM.Font.data(14)).foregroundStyle(MM.Color.ink)
        }
    }
}
