import SwiftUI

/// One order, for the buyer (pay, track, confirm receipt, open a claim) or the seller (ship with tracking).
struct OrderDetailView: View {
    let orderId: String
    @Environment(SessionStore.self) private var session
    @State private var detail: OrderDetailResponse?
    @State private var error: String?
    @State private var working = false
    @State private var notice: String?
    @State private var confirmPay = false
    @State private var confirmReceipt = false
    @State private var showClaim = false
    @State private var showShip = false

    private var order: Order? { detail?.order }
    private var isBuyer: Bool { order?.buyerId == session.user?.id }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if let detail {
                    header(detail)
                    progress(detail.order)
                    breakdown(detail.order)
                    shipTo(detail.order)
                    actions(detail.order)
                    if let notice { Text(notice).font(MM.Font.body(13, weight: .semibold)).foregroundStyle(MM.Color.green).accessibilityIdentifier("order-notice") }
                    if let error { Text(error).font(MM.Font.body(13)).foregroundStyle(MM.Color.errorText) }
                    protection
                } else if let error {
                    ErrorState(message: error) { Task { await load() } }
                } else {
                    LoadingState()
                }
            }
            .padding(MM.Space.screen)
        }
        .navigationTitle("Order")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog("Pay for this order?", isPresented: $confirmPay, titleVisibility: .visible) {
            Button("Pay \(Format.money(order?.totalAmount ?? 0, order?.currency ?? "USD"))") { Task { await act { try await APIClient.shared.payOrder(id: orderId) } done: { String(localized: "Paid. Your money is held safely until you confirm the item arrived.") } } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("The seller is paid only after you confirm it arrived as described.") }
        .confirmationDialog("Did it arrive as described?", isPresented: $confirmReceipt, titleVisibility: .visible) {
            Button("Yes — release payment to the seller") { Task { await act { try await APIClient.shared.confirmOrder(id: orderId) } done: { String(localized: "Thanks! The seller has been paid.") } } }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(isPresented: $showClaim) { ClaimSheet { reason in Task { await act { try await APIClient.shared.disputeOrder(id: orderId, reason: reason) } done: { String(localized: "Claim opened. Payment is on hold while we look into it.") } } } }
        .sheet(isPresented: $showShip) { ShipSheet { courier, tracking in Task { await act { try await APIClient.shared.shipOrder(id: orderId, courier: courier, tracking: tracking) } done: { String(localized: "Marked as shipped. The buyer has been told.") } } } }
        .mmScreen()
    }

    private func header(_ d: OrderDetailResponse) -> some View {
        HStack(spacing: 12) {
            ArtworkView(source: d.auction?.coverImage, symbol: "shippingbox.fill")
                .frame(width: 72, height: 72).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(d.auction?.title ?? d.order.title ?? d.order.id).font(MM.Font.body(16, weight: .semibold)).foregroundStyle(MM.Color.ink).lineLimit(2)
                let other = isBuyer ? d.seller : d.buyer
                if let other { Text(isBuyer ? "Sold by @\(other.handle)" : "Bought by @\(other.handle)").font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2) }
                Text(Format.relative(d.order.createdAt)).font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
            }
            Spacer()
        }
        .padding(14).mmCard()
    }

    private func progress(_ o: Order) -> some View {
        let steps: [(String, LocalizedStringKey)] = [("paid", "Paid"), ("shipped", "Shipped"), ("delivered", "Arrived"), ("complete", "Complete")]
        let reached: Int = {
            switch o.orderStatus {
            case "complete": 4
            case "delivered": 3
            case "shipped": 2
            default: o.paymentStatus == "paid" ? 1 : 0
            }
        }()
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                    VStack(spacing: 4) {
                        Circle().fill(index < reached ? MM.Color.gold : MM.Color.divider).frame(width: 12, height: 12)
                        Text(step.1).font(MM.Font.body(11, weight: .semibold)).foregroundStyle(index < reached ? MM.Color.ink : MM.Color.ink3)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            if o.orderStatus == "disputed" {
                Label("Claim open — payment on hold", systemImage: "exclamationmark.shield.fill").font(MM.Font.body(13, weight: .semibold)).foregroundStyle(MM.Color.errorText)
            }
            if let tracking = o.trackingNumber {
                Label("\(o.courierName ?? String(localized: "Tracking")) \(tracking)", systemImage: "shippingbox.fill").font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2)
                    .textSelection(.enabled)
            }
        }
        .padding(14).mmCard()
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("order-status")
    }

    private func breakdown(_ o: Order) -> some View {
        VStack(spacing: 8) {
            row("Item", o.hammerPrice ?? 0, o.currency)
            if let premium = o.buyersPremium, premium > 0 { row("Buyer’s premium", premium, o.currency) }
            row("Shipping", o.shipping ?? 0, o.currency, note: o.shippingNote)
            if let tax = o.tax, tax > 0 { row("Tax", tax, o.currency) }
            if let credit = o.creditApplied, credit > 0 { row("MoneyMart credit", -credit, o.currency) }
            Divider().overlay(MM.Color.divider)
            HStack {
                Text("Total").font(MM.Font.body(15, weight: .bold)).foregroundStyle(MM.Color.ink)
                Spacer()
                Text(Format.money(o.totalAmount, o.currency)).font(MM.Font.data(18)).foregroundStyle(MM.Color.gold)
            }
            if let approx = Markets.shared.approx(o.totalAmount, from: o.currency, to: SessionStore.viewerCurrency) {
                HStack { Spacer(); Text("\(approx) in your currency").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink2) }
            }
        }
        .padding(14).mmCard()
    }

    private func row(_ label: LocalizedStringKey, _ amount: Double, _ currency: String, note: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(label).font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2)
                Spacer()
                Text(amount == 0 && label == "Shipping" ? String(localized: "Free") : Format.money(amount, currency)).font(MM.Font.data(14)).foregroundStyle(MM.Color.ink)
            }
            if let note { Text(note).font(MM.Font.body(11)).foregroundStyle(MM.Color.ink3) }
        }
    }

    @ViewBuilder
    private func shipTo(_ o: Order) -> some View {
        if let address = o.shippingAddress {
            VStack(alignment: .leading, spacing: 4) {
                Text("Ship to").font(MM.Font.body(12, weight: .bold)).foregroundStyle(MM.Color.ink3)
                Text(o.shipToName ?? "").font(MM.Font.body(14, weight: .semibold)).foregroundStyle(MM.Color.ink)
                Text(address.oneLine).font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2).textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14).mmCard()
        }
    }

    @ViewBuilder
    private func actions(_ o: Order) -> some View {
        VStack(spacing: 10) {
            if isBuyer {
                if o.paymentStatus != "paid" && o.paymentStatus != "refunded" && (o.creditApplied ?? 0) == 0 && credit > 0 {
                    Button { Task { await act { _ = try await APIClient.shared.applyCredit(orderId: orderId); return OkOrCreated() } done: { String(localized: "Credit applied.") } } } label: {
                        Text("Use \(Format.money(credit, "USD")) credit").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass).disabled(working).accessibilityIdentifier("order-credit")
                }
                if o.paymentStatus != "paid" && o.paymentStatus != "refunded" {
                    Button { confirmPay = true } label: { Text("Pay \(Format.money(o.totalAmount, o.currency))").frame(maxWidth: .infinity) }
                        .buttonStyle(.gold).disabled(working).accessibilityIdentifier("order-pay")
                }
                if o.paymentStatus == "paid" && ["shipped", "delivered"].contains(o.orderStatus) {
                    Button { confirmReceipt = true } label: { Text("It arrived — confirm").frame(maxWidth: .infinity) }
                        .buttonStyle(.gold).disabled(working).accessibilityIdentifier("order-confirm")
                }
                if o.paymentStatus == "paid" && !["complete", "disputed"].contains(o.orderStatus) {
                    Button { showClaim = true } label: { Text("Problem with this order").frame(maxWidth: .infinity) }
                        .buttonStyle(.glass).disabled(working).accessibilityIdentifier("order-claim")
                }
            } else {
                if o.paymentStatus == "paid" && ["pending", "processing"].contains(o.orderStatus) {
                    Button { showShip = true } label: { Text("Mark as shipped").frame(maxWidth: .infinity) }
                        .buttonStyle(.gold).disabled(working).accessibilityIdentifier("order-ship")
                } else if o.paymentStatus != "paid" {
                    Text("Waiting for the buyer to pay.").font(MM.Font.body(13)).foregroundStyle(MM.Color.ink3)
                }
            }
        }
    }

    private var protection: some View {
        NavigationLink(value: Router.Route.protection) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "checkmark.shield.fill").foregroundStyle(MM.Color.gold)
                Text("MoneyMart Protection: payment is held until the buyer confirms the item arrived as described. Problems can be raised from this screen.")
                    .font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
                    .multilineTextAlignment(.leading)
                Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(MM.Color.ink3)
            }
        }
        .buttonStyle(.plain)
    }

    @State private var credit: Double = 0

    private func load() async {
        do { detail = try await APIClient.shared.order(id: orderId); error = nil } catch { self.error = error.localizedDescription }
        if isBuyer, detail?.order.paymentStatus != "paid" { credit = (try? await APIClient.shared.coinWallet().creditUSD) ?? 0 }
    }

    private func act(_ call: () async throws -> OkOrCreated, done: () -> String) async {
        working = true
        defer { working = false }
        do {
            _ = try await call()
            notice = done()
            error = nil
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct ClaimSheet: View {
    var onSend: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var reason = "not_received"
    @State private var detail = ""
    private let reasons: [(String, LocalizedStringKey)] = [("not_received", "It hasn’t arrived"), ("damaged", "It arrived damaged"), ("not_as_described", "It isn’t as described"), ("counterfeit", "I think it’s not authentic")]

    var body: some View {
        NavigationStack {
            Form {
                Picker("What happened?", selection: $reason) { ForEach(reasons, id: \.0) { Text($0.1).tag($0.0) } }.pickerStyle(.inline)
                Section("Details") { TextField("Tell us what you see (photos can be sent to support)", text: $detail, axis: .vertical).lineLimit(3...6) }
                Section { Button("Open claim") { onSend("\(reason): \(detail)".prefix(400).description); dismiss() }.accessibilityIdentifier("claim-send") }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("Problem with order").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Cancel") { dismiss() } }
            .mmScreen()
        }
    }
}

private struct ShipSheet: View {
    var onSend: (String, String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var courier = "USPS"
    @State private var tracking = ""

    var body: some View {
        NavigationStack {
            Form {
                Picker("Courier", selection: $courier) { ForEach(["USPS", "UPS", "FedEx", "DHL", "Royal Mail", "Canada Post", "GIG Logistics", "Other"], id: \.self) { Text($0) } }
                TextField("Tracking number", text: $tracking).textInputAutocapitalization(.characters).autocorrectionDisabled().accessibilityIdentifier("ship-tracking")
                Section { Button("Mark as shipped") { onSend(courier, tracking.trimmingCharacters(in: .whitespaces)); dismiss() }.disabled(tracking.count < 4).accessibilityIdentifier("ship-send") }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("Ship order").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Cancel") { dismiss() } }
            .mmScreen()
        }
    }
}
