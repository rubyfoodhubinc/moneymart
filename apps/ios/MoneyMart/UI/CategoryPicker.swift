import SwiftUI

/// A tappable row showing the chosen category and subcategory; opens the picker.
struct CategoryField: View {
    @Binding var category: String
    @Binding var subcategory: String?
    var title: LocalizedStringKey = "Category"
    @State private var showPicker = false

    var body: some View {
        let chosen = Catalog.category(category)
        Button { showPicker = true } label: {
            HStack(spacing: 12) {
                Image(systemName: chosen.symbol)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(MM.Color.gold)
                    .frame(width: 36, height: 36)
                    .background(MM.Color.goldSoft, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(MM.Font.body(12, weight: .semibold)).foregroundStyle(MM.Color.ink2)
                    Text(chosen.label).font(MM.Font.body(16, weight: .medium)).foregroundStyle(MM.Color.ink)
                    if let sub = Catalog.subcategory(subcategory) {
                        Text(sub.label).font(MM.Font.body(13)).foregroundStyle(MM.Color.gold)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(MM.Color.ink3)
            }
            .padding(12)
            .background(MM.Color.raised, in: RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous).stroke(MM.Color.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("category-field")
        .sheet(isPresented: $showPicker) {
            CategoryPickerSheet(category: $category, subcategory: $subcategory)
        }
    }
}

/// Searchable category browser: A–Z or by live activity, expandable to subcategories,
/// with a way to ask for a category that is missing.
struct CategoryPickerSheet: View {
    @Binding var category: String
    @Binding var subcategory: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session

    enum Order: String, CaseIterable, Identifiable {
        case alphabetical, popular
        var id: String { rawValue }
        var label: LocalizedStringKey { self == .alphabetical ? "A–Z" : "Popular now" }
    }

    @State private var query = ""
    @State private var order: Order = .alphabetical
    @State private var expanded: String?
    @State private var activity: [String: CategoryActivity] = [:]
    @State private var showRequest = false

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    Picker("Order", selection: $order) {
                        ForEach(Order.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .padding(.bottom, 12)

                    ForEach(visible) { entry in
                        row(entry)
                        Divider().overlay(MM.Color.divider)
                    }

                    if visible.isEmpty {
                        EmptyStateView(symbol: "magnifyingglass", title: "No category matches", message: "Try another word, or ask us to add it.")
                    }

                    requestFooter.padding(.top, 24)
                }
                .padding(MM.Space.screen)
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search categories")
            .navigationTitle("Choose a category")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
            .mmScreen()
            .task { await loadActivity() }
            .onAppear { expanded = category }
            .sheet(isPresented: $showRequest) { CategoryRequestSheet(parentId: expanded) }
        }
        .presentationDetents([.large])
    }

    /// Categories filtered by the query (matching a category OR any of its subcategories).
    private var visible: [Catalog.Category] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        var list = Catalog.categories.filter { entry in
            guard !needle.isEmpty else { return true }
            if String(localized: entry.label).lowercased().contains(needle) { return true }
            return entry.subcategories.contains { String(localized: $0.label).lowercased().contains(needle) }
        }
        switch order {
        case .alphabetical:
            list.sort { String(localized: $0.label).localizedCompare(String(localized: $1.label)) == .orderedAscending }
        case .popular:
            list.sort { score($0.id) > score($1.id) }
        }
        return list
    }

    private func score(_ id: String) -> Int {
        let entry = activity[id]
        return (entry?.liveViewers ?? 0) * 10 + (entry?.liveShows ?? 0) * 100 + (entry?.listings ?? 0)
    }

    private func row(_ entry: Catalog.Category) -> some View {
        let isOpen = expanded == entry.id || !query.isEmpty
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        let subs = needle.isEmpty || String(localized: entry.label).lowercased().contains(needle)
            ? entry.subcategories
            : entry.subcategories.filter { String(localized: $0.label).lowercased().contains(needle) }
        return VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.snappy) { expanded = expanded == entry.id ? nil : entry.id }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: entry.symbol).frame(width: 26).foregroundStyle(MM.Color.gold)
                    Text(entry.label).font(MM.Font.body(16, weight: .medium)).foregroundStyle(MM.Color.ink)
                    if let viewers = activity[entry.id]?.liveViewers, viewers > 0 {
                        Label(Format.count(viewers), systemImage: "dot.radiowaves.left.and.right")
                            .font(MM.Font.data(11)).foregroundStyle(MM.Color.green)
                    }
                    Spacer()
                    if category == entry.id { Image(systemName: "checkmark.circle.fill").foregroundStyle(MM.Color.gold) }
                    Image(systemName: isOpen ? "chevron.up" : "chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(MM.Color.ink3)
                }
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("category-\(entry.id)")

            if isOpen {
                FlowLayout(spacing: 8) {
                    chip(String(localized: "All \(String(localized: entry.label))"), selected: category == entry.id && subcategory == nil) {
                        choose(entry.id, nil)
                    }
                    ForEach(subs) { child in
                        chip(String(localized: child.label), selected: subcategory == child.id) { choose(entry.id, child.id) }
                            .accessibilityIdentifier("subcategory-\(child.id)")
                    }
                }
                .padding(.bottom, 12)
            }
        }
    }

    private func chip(_ text: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .font(MM.Font.body(14, weight: .medium))
                .foregroundStyle(selected ? MM.Color.navy : MM.Color.ink)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(selected ? AnyShapeStyle(MM.Gradient.gold) : AnyShapeStyle(MM.Color.raised), in: Capsule())
                .overlay(Capsule().stroke(selected ? .clear : MM.Color.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func choose(_ categoryId: String, _ subcategoryId: String?) {
        category = categoryId
        subcategory = subcategoryId
        UISelectionFeedbackGenerator().selectionChanged()
        dismiss()
    }

    private var requestFooter: some View {
        VStack(spacing: 10) {
            Text("Can’t find your category?").font(MM.Font.display(17)).foregroundStyle(MM.Color.ink)
            Text("Tell us what you sell and we’ll consider adding it. Until then, pick the closest fit or Everything Else.")
                .font(MM.Font.body(13)).foregroundStyle(MM.Color.ink3).multilineTextAlignment(.center)
            Button("Request a category") { showRequest = true }
                .buttonStyle(.goldCompact)
                .disabled(!session.isSignedIn)
                .accessibilityIdentifier("category-request")
        }
        .frame(maxWidth: .infinity)
    }

    private func loadActivity() async {
        guard let response = try? await APIClient.shared.categories() else { return }
        activity = Dictionary(uniqueKeysWithValues: response.items.map { ($0.id, $0) })
    }
}

/// Files a request for a category the taxonomy does not have.
struct CategoryRequestSheet: View {
    var parentId: String?
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var note = ""
    @State private var busy = false
    @State private var message: String?
    @State private var sent = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                if sent {
                    Label("Thanks — we’ve got your request.", systemImage: "checkmark.seal.fill")
                        .font(MM.Font.body(16, weight: .semibold)).foregroundStyle(MM.Color.green)
                    Button("Done") { dismiss() }.buttonStyle(.gold)
                } else {
                    InputField(title: "Category name", text: $name, prompt: "e.g. Fountain Pens")
                    InputField(title: "Anything we should know? (optional)", text: $note, prompt: "What you sell, typical prices", axis: .vertical)
                        .lineLimit(2...4)
                    if let parentId {
                        Text("Suggested under \(String(localized: Catalog.category(parentId).label))")
                            .font(MM.Font.body(13)).foregroundStyle(MM.Color.ink3)
                    }
                    if let message {
                        Text(message).font(MM.Font.body(13)).foregroundStyle(MM.Color.errorText)
                    }
                    Button(action: submit) {
                        if busy { ProgressView().tint(MM.Color.navy) } else { Text("Send request") }
                    }
                    .buttonStyle(.gold)
                    .disabled(busy || name.trimmingCharacters(in: .whitespaces).count < 2)
                }
                Spacer()
            }
            .padding(MM.Space.screen)
            .navigationTitle("Request a category")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .mmScreen()
        }
        .presentationDetents([.medium, .large])
    }

    private func submit() {
        busy = true; message = nil
        Task {
            defer { busy = false }
            do {
                _ = try await APIClient.shared.requestCategory(
                    name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                    parentId: parentId,
                    note: note.isEmpty ? nil : note)
                sent = true
            } catch {
                message = error.localizedDescription
            }
        }
    }
}

/// Wrapping row layout for chips.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width {
                x = 0; y += rowHeight + spacing; rowHeight = 0
            }
            x += size.width + spacing
            maxX = max(maxX, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: min(maxX, width), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                x = bounds.minX; y += rowHeight + spacing; rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
