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

    @ObservationIgnored private var subscriptions: [RealtimeSubscription] = []

    init(streamId: String) { self.streamId = streamId }

    func load() async {
        do {
            let detail = try await APIClient.shared.stream(id: streamId)
            stream = detail.stream
            chat = detail.chat
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
    @Environment(SessionStore.self) private var session
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
                Spacer()
                if showChat { ChatList(messages: room.chat).frame(maxHeight: 260) }
                if let lot = room.lot, let auction = lot.auction { LiveLotBar(controller: lot, auction: auction) { openBid() } }
                composer
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 6)

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
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left").font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 38, height: 38).background(.ultraThinMaterial, in: Circle())
            }
            .accessibilityLabel("Back")
            if let creator = room.stream?.creator {
                AvatarView(url: creator.avatarUrl, name: creator.displayName, size: 34)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Text(creator.displayName).font(MM.Font.body(14, weight: .bold)).foregroundStyle(.white).lineLimit(1)
                        if creator.isVerified == true { VerifiedMark() }
                    }
                    Text(room.stream?.playback?.mode == "demo" ? String(localized: "Demo feed") : (room.stream?.title ?? ""))
                        .font(MM.Font.body(11)).foregroundStyle(.white.opacity(0.75)).lineLimit(1)
                }
                .layoutPriority(1)
            }
            Spacer(minLength: 4)
            if let stream = room.stream, stream.isLive { LiveBadge(viewers: stream.viewerCount) }
            Button { withAnimation { showChat.toggle() } } label: {
                Image(systemName: showChat ? "bubble.left.fill" : "bubble.left").foregroundStyle(.white)
                    .frame(width: 38, height: 38).background(.ultraThinMaterial, in: Circle())
            }
            .accessibilityLabel(showChat ? Text("Hide chat") : Text("Show chat"))
        }
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

    private func openBid() {
        RequiresSignIn.run(session, router) { showBidSheet = true }
    }
}

struct ChatList: View {
    let messages: [ChatMessage]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(showsIndicators: false) {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(messages) { ChatRow(message: $0).id($0.id) }
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
    var onBid: () -> Void

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
                        Text(Format.money(auction.displayPrice, auction.currency)).font(MM.Font.data(20)).foregroundStyle(MM.Color.gold)
                            .contentTransition(.numericText()).animation(.snappy, value: auction.currentBid)
                        if controller.isOpen { CountdownText(end: auction.endDate, size: 12) }
                    }
                    Text("\(auction.bidCount) bids").font(MM.Font.body(11)).foregroundStyle(.white.opacity(0.7))
                }
                Spacer()
                Button(controller.isOpen ? "Bid \(Format.money(controller.minimumBid, auction.currency, compact: true))" : String(localized: "View lot"), action: onBid)
                    .buttonStyle(.goldCompact)
                    .disabled(controller.placing)
                    .accessibilityIdentifier("stream-bid")
            }
        }
        .padding(12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: MM.Radius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: MM.Radius.lg, style: .continuous).stroke(MM.Color.goldLine, lineWidth: 1))
        .animation(.spring, value: controller.banner)
    }
}
