import SwiftUI

/// Seller Studio › My shows: upcoming and past shows, scheduling, and the run order.
struct MyShowsView: View {
    @State private var upcoming: [LiveStream] = []
    @State private var past: [LiveStream] = []
    @State private var loading = true
    @State private var error: String?
    @State private var showSchedule = false
    @State private var segment = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Picker("Shows", selection: $segment) {
                    Text("Upcoming").tag(0)
                    Text("Past").tag(1)
                }
                .pickerStyle(.segmented)

                if loading && upcoming.isEmpty && past.isEmpty {
                    LoadingState()
                } else if let error {
                    ErrorState(message: error) { Task { await load() } }
                } else {
                    let list = segment == 0 ? upcoming : past
                    if list.isEmpty {
                        EmptyStateView(symbol: "calendar.badge.plus",
                                       title: segment == 0 ? "No shows scheduled" : "No past shows",
                                       message: segment == 0 ? "Schedule a show, then add the items you’ll sell on air." : "Shows you’ve hosted will appear here.")
                        if segment == 0 {
                            Button("Schedule a show") { showSchedule = true }.buttonStyle(.gold)
                        }
                    }
                    ForEach(list) { show in
                        NavigationLink {
                            ShowManagerView(streamId: show.id, onChange: { Task { await load() } })
                        } label: { ShowRow(show: show) }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(MM.Space.screen)
        }
        .refreshable { await load() }
        .navigationTitle("My shows")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showSchedule = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Schedule a show")
                    .accessibilityIdentifier("shows-new")
            }
        }
        .sheet(isPresented: $showSchedule) { ScheduleShowSheet { _ in Task { await load() } } }
        .mmScreen()
        .task { await load() }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let result = try await APIClient.shared.myStreams()
            upcoming = result.upcoming
            past = result.past
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ShowRow: View {
    let show: LiveStream

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(MM.Color.raised)
                Image(systemName: Catalog.category(show.category).symbol).font(.system(size: 22)).foregroundStyle(MM.Color.gold)
            }
            .frame(width: 58, height: 58)
            VStack(alignment: .leading, spacing: 4) {
                Text(show.title).font(MM.Font.body(16, weight: .semibold)).foregroundStyle(MM.Color.ink).lineLimit(2)
                Text(subtitle).font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2)
                HStack(spacing: 8) {
                    if show.isLive { LiveBadge(viewers: show.viewerCount) }
                    Pill(text: LocalizedStringKey(String(localized: Catalog.category(show.category).label)), tint: MM.Color.ink2)
                    Text("\(show.queuedCount ?? show.itemQueue?.count ?? 0) items").font(MM.Font.data(12)).foregroundStyle(MM.Color.ink3)
                }
            }
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(MM.Color.ink3)
        }
        .padding(12)
        .mmCard()
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("show-\(show.id)")
    }

    private var subtitle: String {
        if show.status == "ended" { return String(localized: "Ended") }
        guard let date = show.startDate else { return "" }
        return date.formatted(.dateTime.weekday(.abbreviated).month().day().hour().minute())
    }
}

/// Schedules a show. The guided multi-step scheduler arrives in phase 2; this covers
/// everything the server needs today.
struct ScheduleShowSheet: View {
    var onCreated: (LiveStream) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session

    @State private var title = ""
    @State private var category = "collectibles"
    @State private var subcategory: String?
    @State private var start = Calendar.current.date(byAdding: .hour, value: 1, to: .now) ?? .now
    @State private var format = "auction"
    @State private var description = ""
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    InputField(title: "Show title", text: $title, prompt: "Short and clear — what are you selling?")
                        .accessibilityIdentifier("show-title")
                    Text("\(title.count)/150").font(MM.Font.data(11)).foregroundStyle(title.count > 150 ? MM.Color.errorText : MM.Color.ink3)
                    CategoryField(category: $category, subcategory: $subcategory, title: "Main category")
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Starts").font(MM.Font.body(12, weight: .semibold)).foregroundStyle(MM.Color.ink2)
                        DatePicker("Starts", selection: $start, in: Date.now..., displayedComponents: [.date, .hourAndMinute])
                            .labelsHidden().tint(MM.Color.gold)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Selling format").font(MM.Font.body(12, weight: .semibold)).foregroundStyle(MM.Color.ink2)
                        Picker("Selling format", selection: $format) {
                            Text("Auctions").tag("auction")
                            Text("Buy It Now").tag("buy_now")
                            Text("Both").tag("mixed")
                        }
                        .pickerStyle(.segmented)
                    }
                    InputField(title: "Show notes (optional)", text: $description, prompt: "What buyers should know: shipping, specials, house rules", axis: .vertical)
                        .lineLimit(3...6)
                    if let message {
                        Label(message, systemImage: "exclamationmark.triangle.fill").font(MM.Font.body(13, weight: .medium)).foregroundStyle(MM.Color.errorText)
                    }
                    Button(action: save) {
                        if busy { ProgressView().tint(MM.Color.navy) } else { Text("Schedule show") }
                    }
                    .buttonStyle(.gold)
                    .disabled(busy || title.trimmed.count < 3 || title.count > 150)
                    .accessibilityIdentifier("show-save")
                }
                .padding(MM.Space.screen)
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Schedule a show")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .mmScreen()
            .onAppear {
                if let main = session.user?.sellerProfile?.mainCategory, category == "collectibles" { category = main }
            }
        }
    }

    private func save() {
        busy = true; message = nil
        let input = APIClient.ShowInput(
            title: title.trimmed, categoryId: category, subcategoryId: subcategory,
            scheduledStartTime: start.ISO8601Format(), description: description.trimmed.isEmpty ? nil : description.trimmed,
            format: format, visibility: "public", language: Locale.current.language.languageCode?.identifier)
        Task {
            defer { busy = false }
            do {
                let result = try await APIClient.shared.createStream(input)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                onCreated(result.stream)
                dismiss()
            } catch {
                message = error.localizedDescription
            }
        }
    }
}

/// One show: details, the run order, adding products from the seller's shop, cancelling.
struct ShowManagerView: View {
    let streamId: String
    var onChange: () -> Void = {}
    @Environment(\.dismiss) private var dismiss

    @State private var stream: LiveStream?
    @State private var queue: [Auction] = []
    @State private var error: String?
    @State private var showPicker = false
    @State private var confirmCancel = false
    @State private var working = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let stream {
                    header(stream)
                    SectionHeader(title: "Run order", subtitle: "Items go on screen in this order.").padding(.horizontal, -MM.Space.screen)
                    if queue.isEmpty {
                        EmptyStateView(symbol: "shippingbox", title: "No items yet", message: "Add listings from your shop. You can list new items from the Sell tab.")
                    }
                    ForEach(Array(queue.enumerated()), id: \.element.id) { index, lot in
                        queueRow(index: index, lot: lot, editable: stream.status != "ended")
                    }
                    if stream.status != "ended" {
                        Button { showPicker = true } label: { Label("Add items from my shop", systemImage: "plus.circle.fill") }
                            .buttonStyle(.gold)
                            .accessibilityIdentifier("show-add-items")
                    }
                    if stream.isScheduled {
                        Button(role: .destructive) { confirmCancel = true } label: { Text("Cancel show") }
                            .buttonStyle(.glass)
                    }
                } else if let error {
                    ErrorState(message: error) { Task { await load() } }
                } else {
                    LoadingState()
                }
            }
            .padding(MM.Space.screen)
        }
        .navigationTitle("Show")
        .navigationBarTitleDisplayMode(.inline)
        .mmScreen()
        .task { await load() }
        .sheet(isPresented: $showPicker) {
            ShowItemPicker(streamId: streamId, queued: Set(queue.map(\.id))) { updated in
                Task { await load() }
                _ = updated
            }
        }
        .confirmationDialog("Cancel this show?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Cancel show", role: .destructive) { cancelShow() }
            Button("Keep show", role: .cancel) {}
        } message: {
            Text("Followers who saved it will no longer be reminded. Your items stay in your shop.")
        }
    }

    private func header(_ stream: LiveStream) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if stream.isLive { LiveBadge(viewers: stream.viewerCount) }
                else { Pill(text: stream.status == "ended" ? "Ended" : "Scheduled", systemImage: "calendar") }
                Pill(text: LocalizedStringKey(String(localized: Catalog.category(stream.category).label)), systemImage: Catalog.category(stream.category).symbol, tint: MM.Color.ink2)
            }
            Text(stream.title).font(MM.Font.display(24)).foregroundStyle(MM.Color.ink)
            if let date = stream.startDate {
                Label(date.formatted(.dateTime.weekday(.wide).month().day().hour().minute()), systemImage: "clock")
                    .font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2)
            }
            if let notes = stream.description, !notes.isEmpty {
                Text(notes).font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2)
            }
            if stream.isScheduled {
                Label("Going live from your phone arrives in the next update. Build your run order now.", systemImage: "info.circle")
                    .font(MM.Font.body(13)).foregroundStyle(MM.Color.ink3)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .mmCard()
    }

    private func queueRow(index: Int, lot: Auction, editable: Bool) -> some View {
        HStack(spacing: 12) {
            Text("\(index + 1)").font(MM.Font.data(13, weight: .semibold)).foregroundStyle(MM.Color.gold).frame(width: 24)
            ArtworkView(source: lot.coverImage, symbol: Catalog.category(lot.categoryId).symbol)
                .frame(width: 52, height: 52)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(lot.title).font(MM.Font.body(15, weight: .semibold)).foregroundStyle(MM.Color.ink).lineLimit(2)
                Text(Format.money(lot.displayPrice, lot.currency)).font(MM.Font.data(13)).foregroundStyle(MM.Color.ink2)
            }
            Spacer()
            if editable {
                Button { remove(lot) } label: { Image(systemName: "minus.circle.fill").font(.system(size: 22)).foregroundStyle(MM.Color.errorText) }
                    .buttonStyle(.plain)
                    .disabled(working)
                    .accessibilityLabel("Remove \(lot.title)")
            }
        }
        .padding(10)
        .mmCard(radius: MM.Radius.md)
    }

    private func load() async {
        do {
            let detail = try await APIClient.shared.stream(id: streamId)
            stream = detail.stream
            queue = detail.queue
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func remove(_ lot: Auction) {
        working = true
        Task {
            defer { working = false }
            do {
                _ = try await APIClient.shared.removeFromShow(streamId: streamId, auctionId: lot.id)
                await load()
                onChange()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func cancelShow() {
        Task {
            do {
                _ = try await APIClient.shared.cancelStream(id: streamId)
                onChange()
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// Lists the seller's open listings so they can be added to a show's run order.
struct ShowItemPicker: View {
    let streamId: String
    let queued: Set<String>
    var onChange: (LiveStream) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var listings: [Auction] = []
    @State private var added: Set<String> = []
    @State private var loading = true
    @State private var message: String?
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List {
                if let message {
                    Text(message).font(MM.Font.body(13)).foregroundStyle(MM.Color.errorText).listRowBackground(MM.Color.surface)
                }
                if loading {
                    LoadingState().listRowBackground(MM.Color.surface)
                } else if filtered.isEmpty {
                    EmptyStateView(symbol: "tag", title: "No open listings", message: "List an item in the Sell tab, then add it here.")
                        .listRowBackground(MM.Color.surface)
                }
                ForEach(filtered) { lot in
                    let inShow = queued.contains(lot.id) || added.contains(lot.id)
                    HStack(spacing: 12) {
                        ArtworkView(source: lot.coverImage, symbol: Catalog.category(lot.categoryId).symbol)
                            .frame(width: 48, height: 48)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(lot.title).font(MM.Font.body(15, weight: .semibold)).foregroundStyle(MM.Color.ink).lineLimit(2)
                            Text(Format.money(lot.displayPrice, lot.currency)).font(MM.Font.data(13)).foregroundStyle(MM.Color.ink2)
                        }
                        Spacer()
                        if inShow {
                            Image(systemName: "checkmark.circle.fill").font(.system(size: 22)).foregroundStyle(MM.Color.green)
                        } else {
                            Button { add(lot) } label: { Image(systemName: "plus.circle.fill").font(.system(size: 22)).foregroundStyle(MM.Color.gold) }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Add \(lot.title)")
                                .accessibilityIdentifier("add-\(lot.id)")
                        }
                    }
                    .listRowBackground(MM.Color.raised)
                }
            }
            .scrollContentBackground(.hidden)
            .searchable(text: $query, prompt: "Search my shop")
            .navigationTitle("Add items")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .mmScreen()
            .task { await load() }
        }
    }

    private var filtered: [Auction] {
        let open = listings.filter { $0.status.isOpen }
        let needle = query.trimmed.lowercased()
        return needle.isEmpty ? open : open.filter { $0.title.lowercased().contains(needle) }
    }

    private func load() async {
        defer { loading = false }
        do { listings = try await APIClient.shared.myListings().items }
        catch { message = error.localizedDescription }
    }

    private func add(_ lot: Auction) {
        Task {
            do {
                let result = try await APIClient.shared.addToShow(streamId: streamId, auctionId: lot.id)
                added.insert(lot.id)
                message = nil
                onChange(result.stream)
            } catch {
                message = error.localizedDescription
            }
        }
    }
}
