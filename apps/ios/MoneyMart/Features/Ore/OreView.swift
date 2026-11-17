import SwiftUI

/// Ore — the member's own assistant (AI Company Standard §5).
///
/// She helps buyers and sellers with the app and passes requests, problems and feedback up to President Ore
/// (anonymously). The conversation lives only in memory on the device; the server keeps no chat history for members.
@MainActor
@Observable
final class OreStore {
    struct Message: Identifiable, Equatable {
        enum Role: String { case member, ore }
        let id = UUID()
        let role: Role
        let text: String
        var reported: [String] = []
        var failed = false
    }

    private(set) var enabled = false
    private(set) var available = false
    private(set) var presidentName = "Ore"
    private(set) var messages: [Message] = []
    private(set) var sending = false

    /// Ore shows in the app only when the Owner has her switched on and the server can reach her model.
    var visible: Bool { enabled && available }

    func refreshStatus() async {
        guard let status = try? await APIClient.shared.oreStatus() else { return }
        enabled = status.enabled
        available = status.available
        presidentName = status.president
    }

    func send(_ raw: String) async {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !sending else { return }
        let history = messages.filter { !$0.failed }.suffix(10).map { APIClient.OreTurn(role: $0.role.rawValue, text: $0.text) }
        messages.append(Message(role: .member, text: text))
        sending = true
        defer { sending = false }
        do {
            let reply = try await APIClient.shared.askOre(text: text, history: Array(history))
            messages.append(Message(role: .ore, text: reply.reply, reported: reply.reported.map(\.title)))
        } catch let error as APIError where error.code == "ore_off" {
            enabled = false
            messages.append(Message(role: .ore, text: String(localized: "Ore is switched off right now."), failed: true))
        } catch {
            messages.append(Message(role: .ore, text: String(localized: "I can't answer right now — please try again in a moment."), failed: true))
        }
    }

    func reset() { messages = [] }
}

/// The gold Ore button used in headers.
struct OreButton: View {
    @Environment(OreStore.self) private var ore
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router

    var body: some View {
        if ore.visible {
            Button { RequiresSignIn.run(session, router) { router.showOre = true } } label: {
                Image(systemName: "sparkles")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(MM.Color.navyDeep)
                    .frame(width: 40, height: 40)
                    .background(MM.Gradient.gold, in: Circle())
            }
            .accessibilityLabel("Ask Ore")
            .accessibilityIdentifier("ore-button")
        }
    }
}

struct OreChatView: View {
    @Environment(OreStore.self) private var ore
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""
    @FocusState private var focused: Bool

    private var suggestions: [LocalizedStringKey] {
        session.user?.sellerProfile != nil
            ? ["How do I run an item live?", "Help me price a listing", "When do I get paid?"]
            : ["How does bidding work?", "Find me a show to watch", "Where is my order?"]
    }
    private var suggestionText: [String] {
        session.user?.sellerProfile != nil
            ? [String(localized: "How do I run an item live?"), String(localized: "Help me price a listing"), String(localized: "When do I get paid?")]
            : [String(localized: "How does bidding work?"), String(localized: "Find me a show to watch"), String(localized: "Where is my order?")]
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            greeting
                            ForEach(ore.messages) { message in bubble(message).id(message.id) }
                            if ore.sending {
                                HStack(spacing: 8) {
                                    ProgressView().tint(MM.Color.gold).controlSize(.small)
                                    Text("Ore is thinking…").font(MM.Font.body(13)).foregroundStyle(MM.Color.ink3)
                                }
                                .id("thinking")
                            }
                        }
                        .padding(MM.Space.screen)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onChange(of: ore.messages.count) {
                        withAnimation { proxy.scrollTo(ore.sending ? AnyHashable("thinking") : AnyHashable(ore.messages.last?.id), anchor: .bottom) }
                    }
                    .onChange(of: ore.sending) {
                        if ore.sending { withAnimation { proxy.scrollTo("thinking", anchor: .bottom) } }
                    }
                }
                inputBar
            }
            .mmScreen()
            .navigationTitle("Ore")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if !ore.messages.isEmpty {
                        Button("New chat") { ore.reset() }.accessibilityIdentifier("ore-new")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("ore-done")
                }
            }
        }
    }

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(MM.Color.navyDeep)
                    .frame(width: 46, height: 46)
                    .background(MM.Gradient.gold, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("Hi, I'm Ore").font(MM.Font.display(20)).foregroundStyle(MM.Color.ink)
                    Text("Your MoneyMart assistant").font(MM.Font.body(13)).foregroundStyle(MM.Color.ink3)
                }
            }
            Text("Ask me about bidding, shows, selling, fees or your orders. If MoneyMart can't do something you need, I'll pass it to President \(ore.presidentName).")
                .font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2)
            if ore.messages.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(suggestions.enumerated()), id: \.offset) { index, label in
                        Button { Task { await ore.send(suggestionText[index]) } } label: {
                            Text(label)
                                .font(MM.Font.body(14, weight: .semibold))
                                .foregroundStyle(MM.Color.gold)
                                .padding(.horizontal, 14).padding(.vertical, 9)
                                .background(MM.Color.goldSoft, in: Capsule())
                                .overlay(Capsule().stroke(MM.Color.goldLine, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("ore-suggestion-\(index)")
                    }
                }
            }
        }
        .padding(.bottom, 6)
    }

    @ViewBuilder
    private func bubble(_ message: OreStore.Message) -> some View {
        let mine = message.role == .member
        HStack {
            if mine { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 6) {
                Text(message.text)
                    .font(MM.Font.body(15))
                    .foregroundStyle(message.failed ? MM.Color.errorText : MM.Color.ink)
                    .textSelection(.enabled)
                ForEach(message.reported, id: \.self) { title in
                    Label("Sent to President \(ore.presidentName): \(title)", systemImage: "arrow.up.forward.circle.fill")
                        .font(MM.Font.body(12, weight: .semibold))
                        .foregroundStyle(MM.Color.green)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(mine ? MM.Color.goldSoft : MM.Color.card, in: RoundedRectangle(cornerRadius: MM.Radius.lg, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: MM.Radius.lg, style: .continuous).stroke(mine ? MM.Color.goldLine : MM.Color.border, lineWidth: 1))
            if !mine { Spacer(minLength: 40) }
        }
        .accessibilityIdentifier(mine ? "ore-message-member" : "ore-message-ore")
    }

    private var inputBar: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Message Ore", text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .focused($focused)
                .font(MM.Font.body(16))
                .foregroundStyle(MM.Color.ink)
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(MM.Color.raised, in: RoundedRectangle(cornerRadius: MM.Radius.xl, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: MM.Radius.xl, style: .continuous).stroke(MM.Color.border, lineWidth: 1))
                .submitLabel(.send)
                .onSubmit(send)
                .accessibilityIdentifier("ore-input")
            Button(action: send) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(MM.Color.navyDeep)
                    .frame(width: 44, height: 44)
                    .background(MM.Gradient.gold, in: Circle())
                    .opacity(canSend ? 1 : 0.4)
            }
            .disabled(!canSend)
            .accessibilityLabel("Send")
            .accessibilityIdentifier("ore-send")
        }
        .padding(.horizontal, MM.Space.screen).padding(.vertical, 10)
        .background(MM.Color.surface)
        .overlay(alignment: .top) { Divider().overlay(MM.Color.divider) }
    }

    private var canSend: Bool { !ore.sending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func send() {
        guard canSend else { return }
        let text = draft
        draft = ""
        Task { await ore.send(text) }
    }
}
