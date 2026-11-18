import SwiftUI

/// What the signed-in buyer has on file and who they blocked; shared by the live room, lot pages and Profile.
@MainActor
@Observable
final class BuyerState {
    static let shared = BuyerState()
    private(set) var addresses: [BuyerAddress] = []
    private(set) var blocked: Set<String> = []
    private(set) var loaded = false

    var hasAddress: Bool { !addresses.isEmpty }
    var defaultAddress: BuyerAddress? { addresses.first(where: \.isDefault) ?? addresses.first }

    func load() async {
        if let list = try? await APIClient.shared.addresses() { addresses = list.items }
        if let ids = try? await APIClient.shared.myBlocks() { blocked = Set(ids.ids) }
        loaded = true
    }

    func reset() {
        addresses = []
        blocked = []
        loaded = false
    }

    func set(_ list: [BuyerAddress]) { addresses = list }
    func setBlocked(_ userId: String, _ on: Bool) {
        if on { blocked.insert(userId) } else { blocked.remove(userId) }
    }
}

/// The address form, used from Profile and from the first-bid sheet.
struct AddressForm: View {
    var title: LocalizedStringKey = "Shipping address"
    var onSaved: ([BuyerAddress]) -> Void
    @Environment(SessionStore.self) private var session
    @State private var fullName = ""
    @State private var line1 = ""
    @State private var line2 = ""
    @State private var city = ""
    @State private var region = ""
    @State private var postalCode = ""
    @State private var country = "US"
    @State private var phone = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                TextField("Full name", text: $fullName).textContentType(.name).accessibilityIdentifier("address-name")
                TextField("Street address", text: $line1).textContentType(.streetAddressLine1).accessibilityIdentifier("address-line1")
                TextField("Apartment, suite (optional)", text: $line2).textContentType(.streetAddressLine2)
                TextField("City", text: $city).textContentType(.addressCity).accessibilityIdentifier("address-city")
                TextField("State / region", text: $region).textContentType(.addressState).accessibilityIdentifier("address-region")
                TextField("Postal code", text: $postalCode).textContentType(.postalCode).accessibilityIdentifier("address-postal")
                Picker("Country", selection: $country) {
                    ForEach(Markets.shared.buyingCountries) { Text("\($0.flag) \($0.name)").tag($0.code) }
                }
                TextField("Phone for the courier (optional)", text: $phone).textContentType(.telephoneNumber).keyboardType(.phonePad)
            } header: { Text(title) } footer: {
                Text("Use the name on your door or mailbox. Only the seller of something you win sees this address.")
            }
            if let error { Text(error).foregroundStyle(MM.Color.errorText) }
            Section {
                Button { Task { await save() } } label: {
                    if saving { ProgressView() } else { Text("Save address").frame(maxWidth: .infinity) }
                }
                .disabled(saving || fullName.isEmpty || line1.isEmpty || city.isEmpty)
                .accessibilityIdentifier("address-save")
            }
        }
        .scrollContentBackground(.hidden)
        .onAppear {
            if fullName.isEmpty { fullName = session.user?.displayName ?? "" }
            if let code = session.user?.countryCode, Markets.shared.buyingCountries.contains(where: { $0.code == code }) { country = code }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            let result = try await APIClient.shared.addAddress(.init(fullName: fullName, line1: line1, line2: line2.isEmpty ? nil : line2, city: city, region: region, postalCode: postalCode, countryCode: country, phone: phone.isEmpty ? nil : phone, isDefault: true))
            BuyerState.shared.set(result.items)
            onSaved(result.items)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Shown the first time a buyer bids or buys without a shipping address.
struct ShippingInfoSheet: View {
    var onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var showForm = false

    var body: some View {
        NavigationStack {
            if showForm {
                AddressForm(title: "Where should we ship?") { _ in
                    dismiss()
                    onDone()
                }
                .navigationTitle("Shipping address")
                .navigationBarTitleDisplayMode(.inline)
                .mmScreen()
            } else {
                VStack(spacing: 16) {
                    Image(systemName: "shippingbox.and.arrow.backward.fill").font(.system(size: 44)).foregroundStyle(MM.Color.gold)
                    Text("Before your first bid").font(MM.Font.display(22)).foregroundStyle(MM.Color.ink)
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Add where we should ship what you win.", systemImage: "house.fill")
                        Label("Nothing is charged until you win.", systemImage: "creditcard")
                        Label("Every bid is a promise to buy, so bid with care.", systemImage: "hand.raised.fill")
                    }
                    .font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2)
                    Button { showForm = true } label: { Text("Add shipping address").frame(maxWidth: .infinity) }
                        .buttonStyle(.gold)
                        .accessibilityIdentifier("gate-add-address")
                    Button("Not now") { dismiss() }.foregroundStyle(MM.Color.ink3)
                }
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .mmScreen()
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Profile › Addresses.
struct AddressesView: View {
    @State private var items: [BuyerAddress] = []
    @State private var adding = false
    @State private var error: String?

    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(MM.Color.errorText).listRowBackground(Color.clear) }
            if items.isEmpty {
                EmptyStateView(symbol: "house", title: "No address yet", message: "Add where you’d like your wins shipped.").listRowBackground(Color.clear)
            }
            ForEach(items) { address in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: address.isDefault ? "checkmark.circle.fill" : "circle").foregroundStyle(address.isDefault ? MM.Color.gold : MM.Color.ink3)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(address.fullName).font(MM.Font.body(15, weight: .semibold)).foregroundStyle(MM.Color.ink)
                        Text(address.oneLine).font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2)
                        if address.isDefault { Text("Default").font(MM.Font.body(11, weight: .bold)).foregroundStyle(MM.Color.gold) }
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture { Task { await makeDefault(address) } }
                .swipeActions {
                    Button("Delete", role: .destructive) { Task { await remove(address) } }
                }
                .listRowBackground(MM.Color.card)
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Addresses")
        .toolbar { Button { adding = true } label: { Image(systemName: "plus") }.accessibilityIdentifier("addresses-add") }
        .task { await load() }
        .sheet(isPresented: $adding) {
            NavigationStack {
                AddressForm { list in items = list; adding = false }
                    .navigationTitle("New address").navigationBarTitleDisplayMode(.inline).mmScreen()
            }
        }
        .mmScreen()
    }

    private func load() async {
        do { items = try await APIClient.shared.addresses().items; BuyerState.shared.set(items); error = nil } catch { self.error = error.localizedDescription }
    }
    private func makeDefault(_ address: BuyerAddress) async {
        guard !address.isDefault else { return }
        if let list = try? await APIClient.shared.makeDefaultAddress(address.id) { items = list.items; BuyerState.shared.set(list.items) }
    }
    private func remove(_ address: BuyerAddress) async {
        if let list = try? await APIClient.shared.deleteAddress(address.id) { items = list.items; BuyerState.shared.set(list.items) }
    }
}
