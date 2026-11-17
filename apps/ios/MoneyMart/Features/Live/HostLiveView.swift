import SwiftUI

/// The host's live console: camera, going live, running items, chat, ending.
/// Works the same on either video provider; if one will not connect the host can
/// move the show to the backup without leaving the screen.
struct HostLiveView: View {
    let streamId: String
    var onEnded: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @State private var room: StreamRoom
    @State private var video = LiveVideoSession(role: .host)
    @State private var working = false
    @State private var message: String?
    @State private var notice: String?
    @State private var confirmExit = false
    @State private var showChat = true
    @State private var draft = ""
    @State private var runTarget: Auction?

    init(streamId: String, onEnded: @escaping () -> Void = {}) {
        self.streamId = streamId
        self.onEnded = onEnded
        _room = State(initialValue: StreamRoom(streamId: streamId))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if video.videoView != nil {
                LiveVideoSurface(view: video.videoView).ignoresSafeArea()
            } else {
                ArtworkView(source: room.stream?.posterUrl, symbol: "video.fill").ignoresSafeArea().opacity(0.35)
            }
            LinearGradient(colors: [.black.opacity(0.6), .clear, .clear, .black.opacity(0.85)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea().allowsHitTesting(false)

            VStack(spacing: 10) {
                topBar
                if let notice { banner(notice, symbol: "arrow.triangle.2.circlepath", tint: MM.Color.gold) }
                Spacer()
                if video.state == .idle { preLive } else { liveControls }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        }
        .statusBarHidden()
        .sheet(item: $runTarget) { lot in
            RunItemSheet(lot: lot) { seconds, price, suddenDeath in run(lot, seconds: seconds, price: price, suddenDeath: suddenDeath) }
                .presentationDetents([.medium])
        }
        .task { await room.load() }
        .onDisappear {
            video.stop()
            room.leave()
        }
        .confirmationDialog("Leave the show?", isPresented: $confirmExit, titleVisibility: .visible) {
            Button("End show for everyone", role: .destructive) { endShow() }
            Button("Leave, keep the show open") { video.stop(); dismiss() }
            Button("Stay", role: .cancel) {}
        } message: {
            Text("Ending closes the show for every viewer. Leaving lets you come back and keep going.")
        }
    }

    // MARK: Top

    private var topBar: some View {
        HStack(spacing: 10) {
            Button { video.state == .idle ? dismiss() : (confirmExit = true) } label: {
                Image(systemName: "xmark").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 38, height: 38).background(.ultraThinMaterial, in: Circle())
            }
            .accessibilityLabel(video.state == .idle ? Text("Close") : Text("Leave or end the show"))
            .accessibilityIdentifier("host-close")

            VStack(alignment: .leading, spacing: 1) {
                Text(room.stream?.title ?? "").font(MM.Font.body(14, weight: .bold)).foregroundStyle(.white).lineLimit(1)
                Text(providerLabel).font(MM.Font.body(11)).foregroundStyle(.white.opacity(0.7))
            }
            Spacer(minLength: 4)
            if video.isLive { LiveBadge(viewers: room.stream?.viewerCount) }
            if video.state != .idle {
                circleButton(video.micMuted ? "mic.slash.fill" : "mic.fill", label: video.micMuted ? "Unmute microphone" : "Mute microphone") { video.toggleMicrophone() }
                circleButton("arrow.triangle.2.circlepath.camera.fill", label: "Flip camera") { video.flipCamera() }
                Menu {
                    Button { switchToBackup() } label: { Label("Switch to backup video", systemImage: "arrow.left.arrow.right") }
                    Button { withAnimation { showChat.toggle() } } label: { Label(showChat ? "Hide chat" : "Show chat", systemImage: "bubble.left") }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 38, height: 38).background(.ultraThinMaterial, in: Circle())
                }
                .accessibilityLabel("More")
            }
        }
    }

    private var providerLabel: String {
        switch video.provider {
        case "ivs": return String(localized: "Amazon IVS")
        case "cloudflare": return String(localized: "Cloudflare Stream")
        default: return String(localized: "Not live yet")
        }
    }

    // MARK: Before going live

    private var preLive: some View {
        VStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 10) {
                checklistRow(done: true, "Show scheduled")
                checklistRow(done: !room.queue.isEmpty, room.queue.isEmpty ? "Add items to your run order" : "\(room.queue.count) items ready to sell")
                checklistRow(done: false, "Camera and microphone on")
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: MM.Radius.lg, style: .continuous))

            if let message { banner(message, symbol: "exclamationmark.triangle.fill", tint: MM.Color.errorText) }

            Button(action: goLive) {
                if working { ProgressView().tint(MM.Color.navy) } else { Label("Go live", systemImage: "dot.radiowaves.left.and.right") }
            }
            .buttonStyle(.gold)
            .disabled(working)
            .accessibilityIdentifier("host-go-live")
            Text("Viewers who saved your show are notified the moment you start.")
                .font(MM.Font.body(12)).foregroundStyle(.white.opacity(0.7)).multilineTextAlignment(.center)
        }
    }

    private func checklistRow(done: Bool, _ text: LocalizedStringKey) -> some View {
        Label { Text(text).font(MM.Font.body(15, weight: .medium)).foregroundStyle(.white) } icon: {
            Image(systemName: done ? "checkmark.circle.fill" : "circle").foregroundStyle(done ? MM.Color.green : .white.opacity(0.6))
        }
    }

    // MARK: Live

    private var liveControls: some View {
        VStack(spacing: 10) {
            statusBanner
            if showChat { ChatList(messages: room.chat).frame(maxHeight: 200) }
            if let lot = room.lot, let auction = lot.auction {
                LiveLotBar(controller: lot, auction: auction, onBid: {}, showsActions: false)
            }
            runOrder
            composer
        }
    }

    @ViewBuilder
    private var statusBanner: some View {
        switch video.state {
        case .connecting:
            banner(String(localized: "Connecting your video…"), symbol: "antenna.radiowaves.left.and.right", tint: MM.Color.gold)
        case .failed(let reason):
            VStack(spacing: 8) {
                banner(reason, symbol: "exclamationmark.triangle.fill", tint: MM.Color.errorText)
                HStack(spacing: 8) {
                    Button("Try again") { goLive() }.buttonStyle(.glassCompact)
                    Button("Switch to backup") { switchToBackup() }.buttonStyle(.goldCompact)
                }
            }
        default:
            EmptyView()
        }
    }

    private var runOrder: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(room.queue) { lot in
                    let onScreen = room.stream?.activeAuctionId == lot.id
                    Button { runTarget = lot } label: {
                        HStack(spacing: 8) {
                            ArtworkView(source: lot.coverImage, symbol: Catalog.category(lot.categoryId).symbol)
                                .frame(width: 36, height: 36)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            VStack(alignment: .leading, spacing: 1) {
                                Text(lot.title).font(MM.Font.body(12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                                Text(onScreen ? String(localized: "On screen") : lot.status == .sold ? String(localized: "Sold") : String(localized: "Tap to run"))
                                    .font(MM.Font.body(11)).foregroundStyle(onScreen ? MM.Color.green : .white.opacity(0.7))
                            }
                            .frame(maxWidth: 130, alignment: .leading)
                        }
                        .padding(6)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(onScreen ? MM.Color.green : .clear, lineWidth: 1.5))
                    }
                    .buttonStyle(.plain)
                    .disabled(working || onScreen || lot.status == .sold || !video.isLive)
                    .accessibilityLabel(Text("Run \(lot.title)"))
                }
                if room.queue.isEmpty {
                    Text("Your run order is empty. Add items from My shows.").font(MM.Font.body(12)).foregroundStyle(.white.opacity(0.7))
                }
            }
        }
    }

    private var composer: some View {
        HStack(spacing: 8) {
            TextField("Say something to your viewers…", text: $draft)
                .font(MM.Font.body(15)).foregroundStyle(.white)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(.ultraThinMaterial, in: Capsule())
                .submitLabel(.send)
                .onSubmit { room.send(draft); draft = "" }
            Button { endPrompt() } label: {
                Text("End").font(MM.Font.body(14, weight: .bold)).foregroundStyle(.white)
                    .padding(.horizontal, 16).padding(.vertical, 11)
                    .background(MM.Color.error, in: Capsule())
            }
            .accessibilityIdentifier("host-end")
        }
    }

    // MARK: Building blocks

    private func circleButton(_ symbol: String, label: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 38, height: 38).background(.ultraThinMaterial, in: Circle())
        }
        .accessibilityLabel(label)
    }

    private func banner(_ text: String, symbol: String, tint: Color) -> some View {
        Label(text, systemImage: symbol)
            .font(MM.Font.body(13, weight: .medium)).foregroundStyle(tint)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    // MARK: Actions

    private func goLive() { start(useBackup: false) }

    private func switchToBackup() { start(useBackup: true) }

    private func start(useBackup: Bool) {
        working = true
        message = nil
        Task {
            defer { working = false }
            do {
                let result = try await APIClient.shared.goLive(streamId: streamId, useBackup: useBackup)
                if let failover = result.failedOver {
                    notice = failover.reason == "host_requested"
                        ? String(localized: "Moved your show to the backup video service.")
                        : String(localized: "The main video service was unavailable, so your show is on the backup.")
                }
                await room.load()
                await video.startBroadcast(result.broadcast)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            } catch {
                message = error.localizedDescription
            }
        }
    }

    private func run(_ lot: Auction, seconds: Int, price: Double?, suddenDeath: Bool) {
        working = true
        Task {
            defer { working = false }
            do {
                _ = try await APIClient.shared.runItem(streamId: streamId, auctionId: lot.id, seconds: seconds,
                                                       startingPrice: price, suddenDeath: suddenDeath)
                await room.load()
            } catch {
                notice = error.localizedDescription
            }
        }
    }

    private func endPrompt() { confirmExit = true }

    private func endShow() {
        Task {
            _ = try? await APIClient.shared.endStream(id: streamId)
            video.stop()
            onEnded()
            dismiss()
        }
    }
}

/// How an item runs on screen: its clock, its opening price and whether late bids add time.
struct RunItemSheet: View {
    let lot: Auction
    var onRun: (Int, Double?, Bool) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var seconds = 15
    @State private var price = ""
    @State private var suddenDeath = false

    private static let timers = [10, 15, 30, 60, 90]

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Text(lot.title).font(MM.Font.display(20)).foregroundStyle(MM.Color.ink).lineLimit(2)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Timer").font(MM.Font.body(12, weight: .semibold)).foregroundStyle(MM.Color.ink2)
                    Picker("Timer", selection: $seconds) {
                        ForEach(Self.timers, id: \.self) { Text("\($0)s").tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                if lot.bidCount == 0 {
                    InputField(title: "Starting price", text: $price, prompt: "e.g. 1", keyboard: .decimalPad)
                        .accessibilityIdentifier("run-price")
                }
                Toggle(isOn: $suddenDeath) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Sudden death").font(MM.Font.body(15, weight: .medium)).foregroundStyle(MM.Color.ink)
                        Text("Late bids don’t add time. Otherwise a bid in the last seconds resets the clock to 5 seconds.")
                            .font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
                    }
                }
                .tint(MM.Color.gold)
                Spacer()
                Button {
                    let value = Double(price.replacingOccurrences(of: ",", with: "."))
                    onRun(seconds, value, suddenDeath)
                    dismiss()
                } label: { Label("Run item", systemImage: "play.fill") }
                .buttonStyle(.gold)
                .accessibilityIdentifier("run-item")
            }
            .padding(MM.Space.screen)
            .navigationTitle("Run item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .mmScreen()
            .onAppear { price = String(format: "%g", lot.startingPrice) }
        }
    }
}
