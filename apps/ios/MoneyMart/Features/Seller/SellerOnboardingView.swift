import SwiftUI

/// One-time seller setup: who you are, what you sell, how big you are, and the
/// return address shipping is quoted from. Required before scheduling a show.
struct SellerOnboardingView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    var onFinished: () -> Void = {}

    enum Step: Int, CaseIterable {
        case welcome, entity, businessType, category, subcategories, channels, socials, revenue, inventory, team, hours, address
    }

    struct Option: Identifiable, Hashable {
        let id: String
        let title: LocalizedStringKey
        var detail: LocalizedStringKey? = nil
        static func == (a: Self, b: Self) -> Bool { a.id == b.id }
        func hash(into hasher: inout Hasher) { hasher.combine(id) }
    }

    @State private var step: Step = .welcome
    @State private var entity = ""
    @State private var businessType = ""
    @State private var mainCategory = ""
    @State private var subcategories: Set<String> = []
    @State private var channels: Set<String> = []
    @State private var socials: [String: String] = [:]
    @State private var revenue = ""
    @State private var inventory = ""
    @State private var team = ""
    @State private var hours = ""
    @State private var address = PostalAddress(fullName: "", line1: "", line2: "", city: "", region: "", postalCode: "", countryCode: "")
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ProgressView(value: progress).tint(MM.Color.gold).padding(.horizontal, MM.Space.screen)
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) { content }
                        .padding(MM.Space.screen)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .scrollDismissesKeyboard(.interactively)
                footer
            }
            .mmScreen()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if step == .welcome { Button("Close") { dismiss() } }
                    else { Button { back() } label: { Image(systemName: "chevron.left") }.accessibilityLabel("Back") }
                }
                ToolbarItem(placement: .principal) { Text("Start selling").font(MM.Font.body(16, weight: .semibold)).foregroundStyle(MM.Color.ink) }
            }
            .onAppear {
                if address.countryCode.isEmpty { address.countryCode = session.user?.countryCode ?? "US" }
                if address.fullName.isEmpty { address.fullName = session.user?.displayName ?? "" }
            }
        }
        .interactiveDismissDisabled(step != .welcome)
    }

    private var progress: Double { Double(step.rawValue) / Double(Step.allCases.count - 1) }

    // MARK: Steps

    @ViewBuilder
    private var content: some View {
        switch step {
        case .welcome:
            Image(systemName: "dot.radiowaves.left.and.right").font(.system(size: 46)).foregroundStyle(MM.Color.gold).padding(.top, 12)
            heading("Sell live to buyers who are ready to buy", "A few quick questions set up your shop. You can change any answer later.")
            point("bolt.fill", "Sell in minutes, not weeks", "Items go up on screen, buyers bid in real time, and the sale closes when the timer hits zero.")
            point("percent", "Fees that fall as you grow", "Your commission rate drops as your sales rise.")
            point("shippingbox.fill", "Buyers pay shipping", "We quote shipping from your return address and generate the label.")
            point("hand.raised.fill", "Sell honestly", "Describe condition accurately, honour every sale and prize, and never list counterfeits.")
        case .entity:
            heading("Who is selling?", nil)
            options([
                Option(id: "individual", title: "Just me", detail: "I sell under my own name."),
                Option(id: "business", title: "A registered business", detail: "I own or work for a registered company."),
            ], selection: $entity)
        case .businessType:
            heading("What kind of business?", "We use this to suggest tools that fit how you work.")
            options([
                Option(id: "reseller", title: "Reseller", detail: "I source and resell goods, including secondhand and collectibles."),
                Option(id: "liquidator", title: "Liquidation & pallets", detail: "Returns, overstock and bulk lots."),
                Option(id: "brand", title: "Brand", detail: "I make my own products."),
                Option(id: "retailer", title: "Retailer", detail: "I buy new stock from brands or wholesalers."),
                Option(id: "consignment", title: "Consignment", detail: "I sell for others and take a share."),
                Option(id: "other", title: "Something else"),
            ], selection: $businessType)
        case .category:
            heading("What will you sell most?", "Pick one to start. You can sell in any category later.")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 10)], spacing: 10) {
                ForEach(Catalog.categories) { entry in
                    Button {
                        if mainCategory != entry.id { subcategories = [] }
                        mainCategory = entry.id
                    } label: {
                        VStack(spacing: 8) {
                            Image(systemName: entry.symbol).font(.system(size: 22, weight: .semibold))
                            Text(entry.label).font(MM.Font.body(12, weight: .semibold)).multilineTextAlignment(.center).lineLimit(2)
                        }
                        .foregroundStyle(mainCategory == entry.id ? MM.Color.navy : MM.Color.ink)
                        .frame(maxWidth: .infinity, minHeight: 86)
                        .padding(6)
                        .background(mainCategory == entry.id ? AnyShapeStyle(MM.Gradient.gold) : AnyShapeStyle(MM.Color.raised),
                                    in: RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous).stroke(MM.Color.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("seller-category-\(entry.id)")
                }
            }
        case .subcategories:
            let chosen = Catalog.category(mainCategory)
            heading("Narrow it down", "Choose the \(String(localized: chosen.label)) subcategories you’ll sell most.")
            FlowLayout(spacing: 8) {
                ForEach(chosen.subcategories) { child in
                    toggleChip(String(localized: child.label), isOn: subcategories.contains(child.id)) {
                        if subcategories.contains(child.id) { subcategories.remove(child.id) } else { subcategories.insert(child.id) }
                    }
                }
            }
        case .channels:
            heading("Where do you sell today?", "Select all that apply.")
            multi([
                Option(id: "website", title: "My own website"),
                Option(id: "social", title: "Social media", detail: "Instagram, TikTok, YouTube and similar"),
                Option(id: "store", title: "A shop or warehouse", detail: "A physical location"),
                Option(id: "marketplaces", title: "Other marketplaces"),
                Option(id: "none", title: "Nowhere yet — I’m just starting"),
            ], selection: $channels, exclusive: "none")
        case .socials:
            heading("Your social accounts", "Optional. We’ll help you bring followers to your shows.")
            ForEach(["instagram", "tiktok", "youtube", "twitch", "x"], id: \.self) { network in
                InputField(title: LocalizedStringKey(network.capitalized), text: Binding(
                    get: { socials[network] ?? "" },
                    set: { socials[network] = $0 }), prompt: "@username")
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            }
        case .revenue:
            heading("Typical monthly sales", "Across everywhere you sell. This tailors rewards to your size.")
            options([
                Option(id: "lt_1k", title: "Under $1,000"), Option(id: "1k_5k", title: "$1,000 – $5,000"),
                Option(id: "5k_20k", title: "$5,000 – $20,000"), Option(id: "20k_50k", title: "$20,000 – $50,000"),
                Option(id: "50k_100k", title: "$50,000 – $100,000"), Option(id: "100k_1m", title: "$100,000 – $1M"),
                Option(id: "gt_1m", title: "Over $1M"),
            ], selection: $revenue)
        case .inventory:
            heading("How many items do you have ready?", "A rough number is fine.")
            options([
                Option(id: "lt_10", title: "Fewer than 10"), Option(id: "10_100", title: "10 – 100"),
                Option(id: "101_250", title: "101 – 250"), Option(id: "251_1000", title: "251 – 1,000"),
                Option(id: "1001_10000", title: "1,001 – 10,000"), Option(id: "gt_10000", title: "More than 10,000"),
            ], selection: $inventory)
        case .team:
            heading("How big is your team?", "Everyone who helps, full or part time.")
            options([
                Option(id: "1", title: "Just me"), Option(id: "2_3", title: "2 – 3"), Option(id: "4_10", title: "4 – 10"),
                Option(id: "11_50", title: "11 – 50"), Option(id: "gt_50", title: "More than 50"),
            ], selection: $team)
        case .hours:
            heading("How much could you go live each week?", "Going live consistently matters more than going live a lot.")
            options([
                Option(id: "1_2", title: "1 – 2 hours"), Option(id: "3_10", title: "3 – 10 hours"),
                Option(id: "11_20", title: "11 – 20 hours"), Option(id: "21_40", title: "21 – 40 hours"),
                Option(id: "gt_40", title: "More than 40 hours"),
            ], selection: $hours)
        case .address:
            heading("Return address", "Shipping is priced from here, and returns come back here. Use your legal name as it appears on your ID. No PO boxes.")
            InputField(title: "Full legal name", text: $address.fullName, prompt: "As on your ID").accessibilityIdentifier("addr-name")
            InputField(title: "Street address", text: $address.line1, prompt: "Number and street").accessibilityIdentifier("addr-line1")
            InputField(title: "Apartment, suite (optional)", text: Binding(get: { address.line2 ?? "" }, set: { address.line2 = $0 }), prompt: "")
            InputField(title: "City", text: $address.city, prompt: "").accessibilityIdentifier("addr-city")
            HStack(spacing: 12) {
                InputField(title: "State / region", text: $address.region, prompt: "").accessibilityIdentifier("addr-region")
                InputField(title: "Postal code", text: $address.postalCode, prompt: "").accessibilityIdentifier("addr-postal")
            }
            Picker("Country", selection: $address.countryCode) {
                ForEach(countryCodes, id: \.self) { code in
                    Text(Locale.current.localizedString(forRegionCode: code) ?? code).tag(code)
                }
            }
            .pickerStyle(.menu)
            .tint(MM.Color.gold)
        }

        if let message {
            Label(message, systemImage: "exclamationmark.triangle.fill").font(MM.Font.body(13, weight: .medium)).foregroundStyle(MM.Color.errorText)
        }
    }

    private var countryCodes: [String] {
        var codes = Catalog.markets.map(\.countryCode)
        if !address.countryCode.isEmpty, !codes.contains(address.countryCode) { codes.insert(address.countryCode, at: 0) }
        return codes
    }

    private var footer: some View {
        Button(action: next) {
            if busy { ProgressView().tint(MM.Color.navy) }
            else { Text(step == .address ? "Finish setup" : step == .welcome ? "Get started" : "Continue") }
        }
        .buttonStyle(.gold)
        .disabled(!canContinue || busy)
        .padding(MM.Space.screen)
        .accessibilityIdentifier("seller-next")
    }

    // MARK: Navigation

    private var canContinue: Bool {
        switch step {
        case .welcome, .socials, .subcategories: return true
        case .entity: return !entity.isEmpty
        case .businessType: return !businessType.isEmpty
        case .category: return !mainCategory.isEmpty
        case .channels: return !channels.isEmpty
        case .revenue: return !revenue.isEmpty
        case .inventory: return !inventory.isEmpty
        case .team: return !team.isEmpty
        case .hours: return !hours.isEmpty
        case .address:
            return address.fullName.trimmed.count >= 2 && address.line1.trimmed.count >= 3 && address.city.trimmed.count >= 2
                && !address.region.trimmed.isEmpty && address.postalCode.trimmed.count >= 2 && address.countryCode.count == 2
        }
    }

    private func next() {
        message = nil
        if step == .address { save(); return }
        var target = Step(rawValue: step.rawValue + 1) ?? .address
        if target == .businessType && entity != "business" { target = .category }
        if target == .socials && !channels.contains("social") { target = .revenue }
        withAnimation(.snappy) { step = target }
    }

    private func back() {
        message = nil
        var target = Step(rawValue: step.rawValue - 1) ?? .welcome
        if target == .socials && !channels.contains("social") { target = .channels }
        if target == .businessType && entity != "business" { target = .entity }
        withAnimation(.snappy) { step = target }
    }

    private func save() {
        busy = true
        var clean = address
        clean.fullName = clean.fullName.trimmed; clean.line1 = clean.line1.trimmed; clean.city = clean.city.trimmed
        clean.region = clean.region.trimmed; clean.postalCode = clean.postalCode.trimmed
        clean.line2 = clean.line2?.trimmed.isEmpty == false ? clean.line2?.trimmed : nil
        let input = APIClient.SellerProfileInput(
            entity: entity,
            businessType: entity == "business" ? businessType : nil,
            mainCategory: mainCategory,
            subcategories: Array(subcategories),
            channels: Array(channels),
            socials: socials.compactMapValues { $0.trimmed.isEmpty ? nil : $0.trimmed },
            monthlyRevenue: revenue, inventorySize: inventory, teamSize: team, weeklyLiveHours: hours,
            returnAddress: clean)
        Task {
            defer { busy = false }
            do {
                _ = try await APIClient.shared.saveSellerProfile(input)
                await session.refresh()
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                onFinished()
                dismiss()
            } catch {
                message = error.localizedDescription
            }
        }
    }

    // MARK: Building blocks

    private func heading(_ title: LocalizedStringKey, _ detail: LocalizedStringKey?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(MM.Font.display(26)).foregroundStyle(MM.Color.ink)
            if let detail { Text(detail).font(MM.Font.body(15)).foregroundStyle(MM.Color.ink2) }
        }
        .padding(.bottom, 4)
    }

    private func point(_ symbol: String, _ title: LocalizedStringKey, _ detail: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol).font(.system(size: 18, weight: .semibold)).foregroundStyle(MM.Color.gold).frame(width: 30)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(MM.Font.body(16, weight: .semibold)).foregroundStyle(MM.Color.ink)
                Text(detail).font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2)
            }
        }
    }

    private func options(_ list: [Option], selection: Binding<String>) -> some View {
        VStack(spacing: 10) {
            ForEach(list) { option in
                optionRow(option, selected: selection.wrappedValue == option.id, symbol: selection.wrappedValue == option.id ? "largecircle.fill.circle" : "circle") {
                    selection.wrappedValue = option.id
                }
            }
        }
    }

    private func multi(_ list: [Option], selection: Binding<Set<String>>, exclusive: String) -> some View {
        VStack(spacing: 10) {
            ForEach(list) { option in
                let on = selection.wrappedValue.contains(option.id)
                optionRow(option, selected: on, symbol: on ? "checkmark.square.fill" : "square") {
                    var value = selection.wrappedValue
                    if on { value.remove(option.id) }
                    else if option.id == exclusive { value = [exclusive] }
                    else { value.remove(exclusive); value.insert(option.id) }
                    selection.wrappedValue = value
                }
            }
        }
    }

    private func optionRow(_ option: Option, selected: Bool, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(option.title).font(MM.Font.body(16, weight: .semibold)).foregroundStyle(MM.Color.ink)
                    if let detail = option.detail { Text(detail).font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2) }
                }
                Spacer()
                Image(systemName: symbol).font(.system(size: 20)).foregroundStyle(selected ? MM.Color.gold : MM.Color.ink3)
            }
            .padding(14)
            .background(MM.Color.raised, in: RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous).stroke(selected ? MM.Color.borderStrong : MM.Color.border, lineWidth: selected ? 1.5 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("seller-option-\(option.id)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func toggleChip(_ text: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .font(MM.Font.body(14, weight: .medium))
                .foregroundStyle(isOn ? MM.Color.navy : MM.Color.ink)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(isOn ? AnyShapeStyle(MM.Gradient.gold) : AnyShapeStyle(MM.Color.raised), in: Capsule())
                .overlay(Capsule().stroke(isOn ? .clear : MM.Color.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
