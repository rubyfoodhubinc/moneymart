import SwiftUI

// MARK: - Offers

/// Offers you made and offers on your listings.
struct OffersView: View {
    @State private var data: OffersResponse?
    @State private var tab = 0
    @State private var error: String?
    @State private var counterFor: Offer?
    @Environment(Router.self) private var router

    var body: some View {
        List {
            Picker("", selection: $tab) {
                Text("Received").tag(0)
                Text("Sent").tag(1)
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)
            if let error { Text(error).foregroundStyle(MM.Color.errorText).listRowBackground(Color.clear) }
            let list = tab == 0 ? data?.received ?? [] : data?.sent ?? []
            if data != nil, list.isEmpty {
                EmptyStateView(symbol: "tag", title: "No offers yet", message: tab == 0 ? "Buyers can offer on your Buy It Now listings." : "Make an offer from any Buy It Now listing.")
                    .listRowBackground(Color.clear)
            }
            ForEach(list) { o in row(o).listRowBackground(MM.Color.card) }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Offers")
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $counterFor) { o in CounterSheet(offer: o) { amount in Task { await act(o, "counter", amount: amount) } } }
        .mmScreen()
    }

    private func row(_ o: Offer) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(o.title).font(MM.Font.body(15, weight: .semibold)).foregroundStyle(MM.Color.ink).lineLimit(1)
                Spacer()
                Text(statusLabel(o)).font(MM.Font.body(11, weight: .bold)).foregroundStyle(o.status == "accepted" ? MM.Color.green : MM.Color.ink3)
            }
            HStack(spacing: 6) {
                Text(Format.money(o.amount, o.currency)).font(MM.Font.data(15)).foregroundStyle(MM.Color.gold)
                if let counter = o.counterAmount { Text("→ " + String(localized: "counter \(Format.money(counter, o.currency))")).font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2) }
                if let bin = o.buyItNowPrice { Text("· " + String(localized: "price \(Format.money(bin, o.currency))")).font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3) }
            }
            if let who = o.youAreSeller ? o.buyer : o.seller { Text("@\(who.handle)").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink2) }
            if let m = o.message { Text("“\(m)”").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink2) }
            HStack(spacing: 8) {
                if o.youAreSeller && o.status == "pending" {
                    Button("Accept") { Task { await act(o, "accept") } }.buttonStyle(.goldCompact).accessibilityIdentifier("offer-accept")
                    Button("Counter") { counterFor = o }.buttonStyle(.glassCompact)
                    Button("Decline") { Task { await act(o, "decline") } }.buttonStyle(.glassCompact)
                } else if !o.youAreSeller && o.status == "countered" {
                    Button("Accept counter") { Task { await act(o, "accept") } }.buttonStyle(.goldCompact)
                    Button("Decline") { Task { await act(o, "decline") } }.buttonStyle(.glassCompact)
                } else if !o.youAreSeller && o.status == "pending" {
                    Button("Withdraw") { Task { await act(o, "withdraw") } }.buttonStyle(.glassCompact)
                }
                if let orderId = o.orderId {
                    Button("View order") { router.profilePath = [.orders, .order(orderId)]; router.tab = .profile }.buttonStyle(.glassCompact)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func statusLabel(_ o: Offer) -> String {
        switch o.status {
        case "pending": String(localized: "Waiting")
        case "countered": String(localized: "Countered")
        case "accepted": String(localized: "Accepted")
        case "declined": String(localized: "Declined")
        case "expired": String(localized: "Expired")
        case "withdrawn": String(localized: "Withdrawn")
        default: o.status
        }
    }

    private func load() async {
        do { data = try await APIClient.shared.offers(); error = nil } catch { self.error = error.localizedDescription }
    }

    private func act(_ o: Offer, _ action: String, amount: Double? = nil) async {
        do { _ = try await APIClient.shared.offerAction(o.id, action, amount: amount); error = nil; await load() } catch { self.error = error.localizedDescription }
    }
}

private struct CounterSheet: View {
    let offer: Offer
    var onSend: (Double) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var amount = ""
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Your price", text: $amount).keyboardType(.decimalPad)
                } footer: { Text("Above \(Format.money(offer.amount, offer.currency))" + (offer.buyItNowPrice.map { " " + String(localized: "and below \(Format.money($0, offer.currency))") } ?? "") + ".") }
                Button("Send counter") { if let v = Double(amount) { onSend(v); dismiss() } }.disabled(Double(amount) == nil)
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("Counter-offer").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Cancel") { dismiss() } }
            .mmScreen()
        }
        .presentationDetents([.medium])
    }
}

/// Make an offer on a Buy It Now listing.
struct MakeOfferSheet: View {
    let auction: Auction
    @Environment(\.dismiss) private var dismiss
    @State private var amount = ""
    @State private var message = ""
    @State private var sent: Offer?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if let sent {
                    Label("Offer sent: \(Format.money(sent.amount, sent.currency))", systemImage: "checkmark.circle.fill").foregroundStyle(MM.Color.green)
                    Text("The seller has 24 hours to accept, counter or decline. If they accept, the order is made and you pay from Orders.").font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2)
                } else {
                    Section {
                        TextField("Your offer", text: $amount).keyboardType(.decimalPad).accessibilityIdentifier("offer-amount")
                        TextField("Message (optional)", text: $message)
                    } header: { Text(auction.title) } footer: {
                        Text("Buy It Now is \(Format.money(auction.buyItNowPrice ?? 0, auction.currency)). Offers start at half the price. An accepted offer is a promise to buy.")
                    }
                    if let error { Text(error).foregroundStyle(MM.Color.errorText) }
                    Button("Send offer") { Task { await send() } }.disabled(Double(amount) == nil).accessibilityIdentifier("offer-send")
                }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("Make an offer").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button(sent == nil ? "Cancel" : "Done") { dismiss() } }
            .mmScreen()
        }
        .presentationDetents([.medium, .large])
    }

    private func send() async {
        guard let value = Double(amount) else { return }
        do { sent = try await APIClient.shared.makeOffer(auctionId: auction.id, amount: value, message: message.isEmpty ? nil : message).offer } catch { self.error = error.localizedDescription }
    }
}

// MARK: - Messages

struct MessagesView: View {
    @State private var data: ThreadsResponse?
    @State private var friends: [MiniUser] = []
    @State private var error: String?

    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(MM.Color.errorText).listRowBackground(Color.clear) }
            if !friends.isEmpty {
                Section("Friends") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 14) {
                            ForEach(friends) { f in
                                NavigationLink(value: Router.Route.thread(f.id)) {
                                    VStack(spacing: 4) {
                                        AvatarView(url: f.avatarUrl, name: f.displayName, size: 44)
                                        Text("@\(f.handle)").font(MM.Font.body(11)).foregroundStyle(MM.Color.ink2).lineLimit(1)
                                    }
                                    .frame(width: 64)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .listRowBackground(Color.clear)
            }
            Section {
                if data?.items.isEmpty == true {
                    EmptyStateView(symbol: "bubble.left.and.bubble.right", title: "No messages yet", message: "Ask a seller a question from their profile, or message friends (people you follow who follow you back).")
                        .listRowBackground(Color.clear)
                }
                ForEach(data?.items ?? []) { t in
                    NavigationLink(value: Router.Route.thread(t.user.id)) {
                        HStack(spacing: 12) {
                            AvatarView(url: t.user.avatarUrl, name: t.user.displayName, size: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t.user.displayName).font(MM.Font.body(15, weight: t.unread > 0 ? .bold : .semibold)).foregroundStyle(MM.Color.ink)
                                Text(t.last.body).font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2).lineLimit(1)
                            }
                            Spacer()
                            if t.unread > 0 {
                                Text("\(t.unread)").font(MM.Font.body(11, weight: .bold)).foregroundStyle(MM.Color.navy).padding(.horizontal, 7).padding(.vertical, 2).background(MM.Color.gold, in: Capsule())
                            }
                        }
                    }
                    .listRowBackground(MM.Color.card)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Messages")
        .task { await load() }
        .refreshable { await load() }
        .mmScreen()
    }

    private func load() async {
        do {
            data = try await APIClient.shared.threads()
            friends = (try? await APIClient.shared.friends().items) ?? []
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct FriendsResponse: Codable, Sendable { var items: [MiniUser] }
extension APIClient {
    func friends() async throws -> FriendsResponse { try await get("/api/me/friends") }
}

struct ThreadView: View {
    let userId: String
    @Environment(SessionStore.self) private var session
    @State private var thread: ThreadResponse?
    @State private var draft = ""
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(thread?.messages ?? []) { m in
                            let mine = m.fromId == session.user?.id
                            HStack {
                                if mine { Spacer(minLength: 40) }
                                Text(m.body).font(MM.Font.body(15)).foregroundStyle(mine ? MM.Color.navy : MM.Color.ink)
                                    .padding(.horizontal, 12).padding(.vertical, 8)
                                    .background(mine ? AnyShapeStyle(MM.Gradient.gold) : AnyShapeStyle(MM.Color.raised), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                                if !mine { Spacer(minLength: 40) }
                            }
                            .id(m.id)
                        }
                    }
                    .padding(MM.Space.screen)
                }
                .onChange(of: thread?.messages.count) { _, _ in if let last = thread?.messages.last { proxy.scrollTo(last.id, anchor: .bottom) } }
            }
            if let error { Text(error).font(MM.Font.body(12)).foregroundStyle(MM.Color.errorText).padding(.horizontal) }
            if thread?.canSend == false, let reason = thread?.reason {
                Text(reason).font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3).padding()
            } else {
                HStack(spacing: 8) {
                    TextField("Message", text: $draft, axis: .vertical).lineLimit(1...4)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(MM.Color.raised, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .accessibilityIdentifier("thread-input")
                    Button { Task { await send() } } label: {
                        Image(systemName: "paperplane.fill").foregroundStyle(MM.Color.navy).frame(width: 40, height: 40).background(MM.Gradient.gold, in: Circle())
                    }
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel("Send message")
                    .accessibilityIdentifier("thread-send")
                }
                .padding(MM.Space.screen)
            }
        }
        .navigationTitle(thread.map { "@\($0.user.handle)" } ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .mmScreen()
    }

    private func load() async {
        do { thread = try await APIClient.shared.thread(with: userId); error = nil } catch { self.error = error.localizedDescription }
    }

    private func send() async {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        do {
            let sent = try await APIClient.shared.sendMessage(to: userId, body: body).message
            thread?.messages.append(sent)
            draft = ""
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
