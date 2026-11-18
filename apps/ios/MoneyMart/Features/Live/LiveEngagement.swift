import SwiftUI

/// One emoji floating up the live room.
struct ReactionBurst: Identifiable, Hashable {
    let id = UUID()
    var emoji: String
    var x: CGFloat
}

/// A short line in the room: someone joined, tipped, bought for the first time, or won a Prize Drop.
struct RoomLine: Identifiable, Hashable {
    let id = UUID()
    var symbol: String
    var text: String
    var highlight = false
}

extension StreamRoom {
    static let reactions = ["🔥", "❤️", "😂", "👏", "😮", "💰"]

    func engagementSubscriptions() -> [RealtimeSubscription] {
        let realtime = Realtime.shared
        let id = streamId
        return [
            realtime.on("giveaway:update", as: Giveaway.self) { [weak self] g in
                guard let self, g.streamId == id else { return }
                // The broadcast copy has no viewer flags; keep this viewer's own.
                var next = g
                if let mine = self.giveaway, mine.id == g.id { next.entered = mine.entered }
                if g.winnerHandle != nil, g.winnerHandle == SessionStore.currentHandle {
                    next.youWon = true
                    // The broadcast doesn't carry the winner's order; fetch this viewer's copy.
                    Task { @MainActor [weak self] in
                        guard let self, let mine = try? await APIClient.shared.giveaways(streamId: id).items.first(where: { $0.id == g.id }) else { return }
                        self.giveaway = mine
                    }
                }
                self.giveaway = next
            },
            realtime.on("stream:reaction", as: ReactionPayload.self) { [weak self] p in
                guard let self, p.streamId == id else { return }
                self.burst(p.emoji)
            },
            realtime.on("stream:joined", as: JoinedPayload.self) { [weak self] p in
                guard let self, p.streamId == id else { return }
                self.line(RoomLine(symbol: "hand.wave.fill", text: String(localized: "@\(p.handle) joined")))
            },
            realtime.on("stream:tip", as: TipPayload.self) { [weak self] p in
                guard let self, p.streamId == id else { return }
                self.line(RoomLine(symbol: "dollarsign.circle.fill", text: String(localized: "@\(p.handle ?? "") tipped \(Format.money(p.amount, p.currency))"), highlight: true))
                self.burst("💰")
            },
            realtime.on("stream:celebrate", as: CelebratePayload.self) { [weak self] p in
                guard let self, p.streamId == id else { return }
                let who = "@\(p.handle ?? "")"
                let text = p.kind == "prize_drop" ? String(localized: "\(who) won the Prize Drop! 🎉") : String(localized: "\(who) made their first purchase! 🎉")
                self.line(RoomLine(symbol: "party.popper.fill", text: text, highlight: true))
                for _ in 0..<6 { self.burst("🎉") }
            },
        ]
    }

    func burst(_ emoji: String) {
        let b = ReactionBurst(emoji: emoji, x: CGFloat.random(in: -24...24))
        bursts.append(b)
        if bursts.count > 24 { bursts.removeFirst(bursts.count - 24) }
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(2.4))
            self?.bursts.removeAll { $0.id == b.id }
        }
    }

    func line(_ l: RoomLine) {
        ticker.append(l)
        if ticker.count > 3 { ticker.removeFirst(ticker.count - 3) }
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(6))
            self?.ticker.removeAll { $0.id == l.id }
        }
    }

    func react(_ emoji: String) async {
        burst(emoji)
        _ = try? await APIClient.shared.react(streamId: streamId, emoji: emoji)
    }

    func enterGiveaway() async -> String? {
        guard let g = giveaway else { return nil }
        do {
            giveaway = try await APIClient.shared.enterGiveaway(g.id).giveaway
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    /// Watch & Earn: a coin a minute while a live show is on screen (the server caps it).
    func watchAndEarn() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(60))
            guard !Task.isCancelled, stream?.isLive == true else { continue }
            if let tick = try? await APIClient.shared.watchTick(streamId: streamId), tick.earned > 0 {
                coinsEarned += tick.earned
            }
        }
    }
}

/// The Prize Drop card in the live room.
struct PrizeDropCard: View {
    let giveaway: Giveaway
    var onEnter: () -> Void
    var onOpenOrder: (String) -> Void

    var body: some View {
        HStack(spacing: 10) {
            Text("🎁").font(.system(size: 26))
            VStack(alignment: .leading, spacing: 2) {
                Text("Prize Drop").font(MM.Font.body(11, weight: .bold)).foregroundStyle(MM.Color.gold)
                Text(giveaway.title).font(MM.Font.body(13, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                Text(subtitle).font(MM.Font.body(11)).foregroundStyle(.white.opacity(0.75))
            }
            Spacer(minLength: 6)
            if giveaway.isOpen {
                if giveaway.entered {
                    Label("Entered", systemImage: "checkmark.circle.fill").font(MM.Font.body(12, weight: .bold)).foregroundStyle(MM.Color.green)
                } else {
                    Button("Enter", action: onEnter).buttonStyle(.goldCompact).accessibilityIdentifier("prize-enter")
                }
            } else if giveaway.youWon, let orderId = giveaway.orderId {
                Button("Your prize") { onOpenOrder(orderId) }.buttonStyle(.goldCompact)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(MM.Color.goldLine, lineWidth: 1))
        .frame(maxWidth: 320)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("prize-drop")
    }

    private var subtitle: String {
        if giveaway.isOpen {
            let who = giveaway.followersOnly ? String(localized: "Followers can enter") : String(localized: "Everyone can enter")
            return "\(who) · \(giveaway.entrantCount) " + String(localized: "entered")
        }
        if let winner = giveaway.winnerHandle { return giveaway.youWon ? String(localized: "You won! It ships free.") : String(localized: "Won by @\(winner)") }
        return String(localized: "Closed")
    }
}

/// Floating emoji and room lines, drawn over the video.
struct RoomEffects: View {
    let room: StreamRoom

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            ForEach(room.bursts) { b in FloatingEmoji(emoji: b.emoji, x: b.x) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
        .padding(.trailing, 30).padding(.bottom, 150)
        .allowsHitTesting(false)
    }
}

private struct FloatingEmoji: View {
    let emoji: String
    let x: CGFloat
    @State private var rise = false

    var body: some View {
        Text(emoji).font(.system(size: 30))
            .offset(x: x + (rise ? CGFloat.random(in: -18...18) : 0), y: rise ? -260 : 0)
            .opacity(rise ? 0 : 1)
            .scaleEffect(rise ? 1.3 : 0.8)
            .onAppear { withAnimation(.easeOut(duration: 2.3)) { rise = true } }
    }
}

struct RoomTicker: View {
    let lines: [RoomLine]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(lines) { l in
                Label(l.text, systemImage: l.symbol)
                    .font(MM.Font.body(12, weight: l.highlight ? .bold : .medium))
                    .foregroundStyle(l.highlight ? MM.Color.gold : .white)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(.black.opacity(0.45), in: Capsule())
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.35), value: lines)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("room-ticker")
    }
}

/// Reactions picker shown above the composer.
struct ReactionBar: View {
    var onReact: (String) -> Void
    var body: some View {
        HStack(spacing: 6) {
            ForEach(StreamRoom.reactions, id: \.self) { e in
                Button { onReact(e) } label: { Text(e).font(.system(size: 22)).frame(width: 40, height: 40) }
                    .background(.ultraThinMaterial, in: Circle())
                    .accessibilityLabel(Text(e))
            }
        }
        .accessibilityIdentifier("reaction-bar")
    }
}

/// Tip the host.
struct TipSheet: View {
    let streamId: String
    let hostHandle: String
    let currency: String
    @Environment(\.dismiss) private var dismiss
    @State private var amount: Double = 5
    @State private var note = ""
    @State private var sending = false
    @State private var error: String?
    @State private var confirm = false

    private var presets: [Double] {
        let usd: [Double] = [2, 5, 10, 20]
        return usd.map { Markets.shared.convert($0, from: "USD", to: currency).map { ($0).rounded() } ?? $0 }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Amount", selection: $amount) {
                        ForEach(presets, id: \.self) { Text(Format.money($0, currency)).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    TextField("Say something (optional)", text: $note).accessibilityIdentifier("tip-note")
                } header: { Text("Tip @\(hostHandle)") } footer: {
                    Text("Tips go to the host. Card payments are in test mode right now, so nothing is charged.")
                }
                if let error { Text(error).foregroundStyle(MM.Color.errorText) }
                Section {
                    Button { confirm = true } label: {
                        if sending { ProgressView() } else { Text("Send \(Format.money(amount, currency))").frame(maxWidth: .infinity) }
                    }
                    .disabled(sending)
                    .accessibilityIdentifier("tip-send")
                }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("Send a tip").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Cancel") { dismiss() } }
            .confirmationDialog("Send \(Format.money(amount, currency)) to @\(hostHandle)?", isPresented: $confirm, titleVisibility: .visible) {
                Button("Send tip") { Task { await send() } }
                Button("Cancel", role: .cancel) {}
            }
            .onAppear { amount = presets[1] }
            .mmScreen()
        }
        .presentationDetents([.medium])
    }

    private func send() async {
        sending = true
        defer { sending = false }
        do {
            _ = try await APIClient.shared.tip(streamId: streamId, amount: amount, note: note.isEmpty ? nil : note)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Host and moderators: start, draw or cancel a Prize Drop.
struct HostPrizeSheet: View {
    let room: StreamRoom
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var followersOnly = true
    @State private var working = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if let g = room.giveaway, g.isOpen {
                    Section("Running now") {
                        LabeledContent(g.title, value: "\(g.entrantCount) " + String(localized: "entered"))
                        Button("Draw a winner") { Task { await act { try await APIClient.shared.drawGiveaway(g.id) } } }
                            .disabled(working || g.entrantCount == 0)
                            .accessibilityIdentifier("prize-draw")
                        Button("Cancel Prize Drop", role: .destructive) { Task { await act { try await APIClient.shared.cancelGiveaway(g.id) } } }
                    }
                } else {
                    Section {
                        TextField("What’s the prize?", text: $title).accessibilityIdentifier("prize-title")
                        Toggle("Followers only", isOn: $followersOnly)
                    } header: { Text("New Prize Drop") } footer: {
                        Text("Entrants need a shipping address. The winner gets a free order; you ship it from Seller Studio like any sale.")
                    }
                    Section {
                        Button("Start Prize Drop") { Task { await act { try await APIClient.shared.startGiveaway(streamId: room.streamId, title: title, followersOnly: followersOnly) } } }
                            .disabled(working || title.trimmingCharacters(in: .whitespaces).count < 2)
                            .accessibilityIdentifier("prize-start")
                    }
                    if let g = room.giveaway, let winner = g.winnerHandle {
                        Section("Last Prize Drop") { LabeledContent(g.title, value: "@\(winner)") }
                    }
                }
                if let error { Text(error).foregroundStyle(MM.Color.errorText) }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("Prize Drop").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
            .mmScreen()
        }
        .presentationDetents([.medium, .large])
    }

    private func act(_ call: () async throws -> GiveawayResult) async {
        working = true
        defer { working = false }
        do {
            room.giveaway = try await call().giveaway
            error = nil
            title = ""
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Save the last 30 seconds of the show as a clip to share.
struct ClipSheet: View {
    let streamId: String
    let secondsIn: Int
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var saved: Clip?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if let saved {
                    Section {
                        Label("Clip saved", systemImage: "checkmark.circle.fill").foregroundStyle(MM.Color.green)
                        if let url = URL(string: saved.shareUrl) { ShareLink("Share clip", item: url) }
                    } footer: { Text("Clips play once show recordings are switched on for this show.") }
                } else {
                    Section {
                        TextField("Name this moment", text: $title).accessibilityIdentifier("clip-title")
                    } footer: { Text("Saves the last 30 seconds.") }
                    if let error { Text(error).foregroundStyle(MM.Color.errorText) }
                    Section {
                        Button("Save clip") { Task { await save() } }.disabled(title.count < 2).accessibilityIdentifier("clip-save")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("Clip").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
            .mmScreen()
        }
        .presentationDetents([.medium])
    }

    private func save() async {
        do {
            saved = try await APIClient.shared.clip(streamId: streamId, title: title, startSec: max(0, secondsIn - 30), endSec: max(30, secondsIn)).clip
        } catch {
            self.error = error.localizedDescription
        }
    }
}
