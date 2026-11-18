import SwiftUI

/// Seller Studio: orders to ship, payouts, account health, commission, promotions and vacation mode.
struct SellerStudioView: View {
    @Environment(SessionStore.self) private var session
    @State private var studio: SellerStudio?
    @State private var error: String?
    @State private var vacationOn = false
    @State private var vacationNote = ""
    @State private var savingVacation = false
    @State private var showRates = false

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if let studio {
                    toShip(studio)
                    payouts(studio)
                    health(studio.health)
                    commission(studio.commission)
                    vacation
                    NavigationLink(value: Router.Route.offers) {
                        Label("Offers on your listings", systemImage: "tag.fill").frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14).mmCard()
                    }
                    .buttonStyle(.plain)
                } else if let error {
                    ErrorState(message: error) { Task { await load() } }
                } else {
                    LoadingState()
                }
            }
            .padding(MM.Space.screen)
        }
        .navigationTitle("Seller Studio")
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showRates) { if let studio { RatesSheet(commission: studio.commission) } }
        .mmScreen()
    }

    private func card<Content: View>(_ title: LocalizedStringKey, symbol: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: symbol).font(MM.Font.body(15, weight: .bold)).foregroundStyle(MM.Color.ink)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).mmCard()
    }

    private func toShip(_ s: SellerStudio) -> some View {
        card("Orders to ship", symbol: "shippingbox.fill") {
            if s.toShip.isEmpty {
                Text("Nothing to ship right now.").font(MM.Font.body(13)).foregroundStyle(MM.Color.ink3)
            }
            ForEach(s.toShip) { o in
                NavigationLink(value: Router.Route.order(o.id)) {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(o.title).font(MM.Font.body(14, weight: .semibold)).foregroundStyle(MM.Color.ink).lineLimit(1)
                            Text("@\(o.buyerHandle)" + (o.source == "prize_drop" ? " · " + String(localized: "Prize Drop") : "")).font(MM.Font.body(12)).foregroundStyle(MM.Color.ink2)
                        }
                        Spacer()
                        Text(o.paidAt.map { Format.relative($0) } ?? "").font(MM.Font.body(11)).foregroundStyle(MM.Color.ink3)
                        Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(MM.Color.ink3)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("studio-ship-\(o.id)")
            }
            if !s.awaitingPayment.isEmpty {
                Text("\(s.awaitingPayment.count) waiting for the buyer to pay").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
            }
        }
        .accessibilityIdentifier("studio-to-ship")
    }

    private func payouts(_ s: SellerStudio) -> some View {
        card("Payouts", symbol: "banknote.fill") {
            HStack {
                stat("Held for you", Format.money(s.payouts.held, s.currency))
                stat("Paid out", Format.money(s.payouts.paid, s.currency))
                stat("Tips", Format.money(s.payouts.tips, s.currency))
            }
            Text(s.payouts.note).font(MM.Font.body(11)).foregroundStyle(MM.Color.ink3)
        }
    }

    private func stat(_ label: LocalizedStringKey, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(MM.Font.data(16)).foregroundStyle(MM.Color.gold)
            Text(label).font(MM.Font.body(11)).foregroundStyle(MM.Color.ink2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func health(_ h: SellerStudio.Health) -> some View {
        card("Account health", symbol: "heart.text.square.fill") {
            Text(h.status == "great" ? "Great — keep it up" : h.status == "good" ? "Good" : "At risk — check the measures below")
                .font(MM.Font.body(13, weight: .semibold))
                .foregroundStyle(h.status == "at_risk" ? MM.Color.errorText : MM.Color.green)
            ForEach(h.metrics) { m in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(m.label).font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2)
                        Spacer()
                        Text("\(m.value)%").font(MM.Font.data(13)).foregroundStyle(m.value >= m.target ? MM.Color.ink : MM.Color.errorText)
                    }
                    ProgressView(value: Double(m.value), total: 100).tint(m.value >= m.target ? MM.Color.gold : MM.Color.errorText)
                }
            }
            if h.lateToShip > 0 {
                Text("\(h.lateToShip) paid orders are more than 3 days old. Ship them to protect your rating.").font(MM.Font.body(12, weight: .semibold)).foregroundStyle(MM.Color.errorText)
            }
        }
        .accessibilityIdentifier("studio-health")
    }

    private func commission(_ c: SellerStudio.Commission) -> some View {
        card("Commission", symbol: "percent") {
            HStack(alignment: .firstTextBaseline) {
                Text(c.tier.label).font(MM.Font.display(20)).foregroundStyle(MM.Color.ink)
                Text(percent(c.tier.rate)).font(MM.Font.data(18)).foregroundStyle(MM.Color.gold)
            }
            if let next = c.next, let gap = c.toNextUSD {
                Text("Sell \(Format.money(gap, "USD")) more in 30 days to reach \(next.label) (\(percent(next.rate))).").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink2)
                ProgressView(value: c.salesUSD30, total: max(next.fromUSD, 1)).tint(MM.Color.gold)
            } else {
                Text("You have the lowest rate.").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink2)
            }
            Button("Rates by category") { showRates = true }.buttonStyle(.glassCompact)
        }
        .accessibilityIdentifier("studio-commission")
    }

    private var vacation: some View {
        card("Vacation mode", symbol: "sun.max.fill") {
            Toggle("I’m away", isOn: $vacationOn).tint(MM.Color.gold).accessibilityIdentifier("studio-vacation")
            if vacationOn {
                TextField("Message for buyers (optional)", text: $vacationNote).textFieldStyle(.roundedBorder)
            }
            Text("While you’re away, new listings, shows and offers are paused and your profile says when you’re back.").font(MM.Font.body(11)).foregroundStyle(MM.Color.ink3)
            Button(savingVacation ? "Saving…" : "Save") { Task { await saveVacation() } }.buttonStyle(.goldCompact).disabled(savingVacation)
        }
    }

    private func percent(_ rate: Double) -> String { "\(Int((rate * 100).rounded()))%" }

    private func load() async {
        do {
            studio = try await APIClient.shared.sellerStudio()
            vacationOn = session.user?.vacation?.on ?? vacationOn
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func saveVacation() async {
        savingVacation = true
        defer { savingVacation = false }
        if let result = try? await APIClient.shared.setVacation(on: vacationOn, message: vacationNote.isEmpty ? nil : vacationNote) {
            vacationOn = result.vacation.on
        }
    }
}

private struct RatesSheet: View {
    let commission: SellerStudio.Commission
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section("Tiers (last 30 days of sales)") {
                    ForEach(commission.tiers) { t in
                        LabeledContent(t.label, value: "\(Int((t.rate * 100).rounded()))% · " + String(localized: "from \(Format.money(t.fromUSD, "USD"))"))
                    }
                }
                Section("Your rate by category") {
                    ForEach(commission.byCategory) { c in LabeledContent(c.label, value: "\(Int((c.rate * 100).rounded()))%") }
                }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("Commission").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
            .mmScreen()
        }
    }
}

/// Promote a show (or listing) to the top of the feed for a while.
struct PromoteSheet: View {
    let kind: String
    let targetId: String
    let title: String
    @Environment(\.dismiss) private var dismiss
    @State private var prices: PromoPrices?
    @State private var hours = 3
    @State private var done: PromoResult.Promo?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if let done {
                    Label("Promoted until \(Format.relative(done.endsAt))", systemImage: "checkmark.circle.fill").foregroundStyle(MM.Color.green)
                } else if let prices {
                    Section {
                        Picker("How long", selection: $hours) {
                            ForEach(prices.options, id: \.hours) { o in Text("\(o.hours)h · \(Format.money(o.amount, prices.currency))").tag(o.hours) }
                        }
                        .pickerStyle(.inline)
                    } header: { Text(title) } footer: { Text("Promoted shows appear first in the Live feed. Card payments are in test mode, so nothing is charged yet.") }
                    if let error { Text(error).foregroundStyle(MM.Color.errorText) }
                    Button("Promote") { Task { await promote() } }.accessibilityIdentifier("promote-confirm")
                } else {
                    ProgressView()
                }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("Promote").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
            .task { prices = try? await APIClient.shared.promoPrices() }
            .mmScreen()
        }
        .presentationDetents([.medium])
    }

    private func promote() async {
        do { done = try await APIClient.shared.promote(kind: kind, targetId: targetId, hours: hours).promo } catch { self.error = error.localizedDescription }
    }
}
