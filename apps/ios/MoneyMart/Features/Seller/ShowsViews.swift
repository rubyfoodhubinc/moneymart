import SwiftUI

/// Seller Studio › My shows: upcoming and past shows, scheduling, and the run order.
struct MyShowsView: View {
    @State private var upcoming: [LiveStream] = []
    @State private var past: [LiveStream] = []
    @State private var loading = true
    @State private var error: String?
    @State private var showSchedule = false
    @State private var showWizard = false
    @State private var segment = 0
    @State private var promoting: LiveStream?

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
                            Button("Plan your shows") { showWizard = true }
                                .buttonStyle(.gold)
                                .accessibilityIdentifier("shows-plan")
                            Button("Schedule a single show") { showSchedule = true }.buttonStyle(.glass)
                        }
                    }
                    ForEach(list) { show in
                        NavigationLink {
                            ShowManagerView(streamId: show.id, onChange: { Task { await load() } })
                        } label: { ShowRow(show: show) }
                        .buttonStyle(.plain)
                        .contextMenu {
                            if show.status != "ended" {
                                Button { promoting = show } label: { Label("Promote this show", systemImage: "megaphone.fill") }
                            }
                        }
                    }
                }
            }
            .padding(MM.Space.screen)
        }
        .refreshable { await load() }
        .navigationTitle("My shows")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button { showWizard = true } label: { Label("Plan your shows", systemImage: "calendar.badge.plus") }
                    Button { showSchedule = true } label: { Label("Single show", systemImage: "plus") }
                        .accessibilityIdentifier("shows-new-single")
                } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Schedule a show")
                    .accessibilityIdentifier("shows-new")
            }
        }
        .sheet(isPresented: $showSchedule) { ScheduleShowSheet { _ in Task { await load() } } }
        .sheet(isPresented: $showWizard) { ScheduleWizard { _ in Task { await load() } } }
        .sheet(item: $promoting) { show in PromoteSheet(kind: "stream", targetId: show.id, title: show.title) }
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
                if let cover = show.posterUrl, !cover.isEmpty {
                    ArtworkView(source: cover, symbol: Catalog.category(show.category).symbol)
                } else {
                    Image(systemName: Catalog.category(show.category).symbol).font(.system(size: 22)).foregroundStyle(MM.Color.gold)
                }
            }
            .frame(width: 58, height: 58)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
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

/// The full show form: every option in one place. Creates a single show, or edits
/// one that has not started when `existing` is given.
struct ScheduleShowSheet: View {
    var existing: LiveStream? = nil
    var onSaved: (LiveStream) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session

    @State private var title = ""
    @State private var category = "collectibles"
    @State private var subcategory: String?
    @State private var start = Calendar.current.date(byAdding: .hour, value: 1, to: .now) ?? .now
    @State private var format = "auction"
    @State private var description = ""
    @State private var posterUrl: String?
    @State private var isPrivate = false
    @State private var explicit = false
    @State private var language = Locale.current.language.languageCode?.identifier ?? "en"
    @State private var moderators = ""
    @State private var mutedWords = ""
    @State private var freePickup = false
    @State private var shippingCap = ""
    @State private var busy = false
    @State private var message: String?
    @State private var prefilled = false

    private static let languages = ["en", "es", "fr", "pt", "de", "ar", "zh", "yo"]

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

                    group("Cover image") {
                        ShowThumbnailPicker(posterUrl: $posterUrl, title: title, category: category)
                    }

                    group("Audience") {
                        Toggle(isOn: $isPrivate) {
                            optionLabel("Private show", "Only people with the link can find it.")
                        }
                        Toggle(isOn: $explicit) {
                            optionLabel("Mature content", "Viewers see a warning before joining.")
                        }
                        HStack {
                            optionLabel("Language you’ll speak", "Helps buyers who speak it find you.")
                            Spacer()
                            Picker("Language", selection: $language) {
                                ForEach(Self.languages, id: \.self) { code in
                                    Text(Locale.current.localizedString(forLanguageCode: code) ?? code).tag(code)
                                }
                            }
                            .pickerStyle(.menu).tint(MM.Color.gold)
                        }
                    }

                    group("Chat") {
                        InputField(title: "Moderators (optional)", text: $moderators, prompt: "@handle, @handle")
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                        InputField(title: "Muted words (optional)", text: $mutedWords, prompt: "Comma separated")
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                        Text("Messages containing a muted word are quietly held back.").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
                    }

                    group("Shipping") {
                        Toggle(isOn: $freePickup) {
                            optionLabel("Local pickup", "Buyers can collect from you instead of paying shipping.")
                        }
                        InputField(title: "Shipping cap per buyer (optional)", text: $shippingCap, prompt: "e.g. 10", keyboard: .decimalPad)
                        Text("The most one buyer pays in shipping for everything they win in this show.").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
                    }

                    if let message {
                        Label(message, systemImage: "exclamationmark.triangle.fill").font(MM.Font.body(13, weight: .medium)).foregroundStyle(MM.Color.errorText)
                    }
                    Button(action: save) {
                        if busy { ProgressView().tint(MM.Color.navy) } else { Text(existing == nil ? "Schedule show" : "Save changes") }
                    }
                    .buttonStyle(.gold)
                    .disabled(busy || title.trimmed.count < 3 || title.count > 150)
                    .accessibilityIdentifier("show-save")
                }
                .padding(MM.Space.screen)
                .tint(MM.Color.gold)
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(existing == nil ? "Schedule a show" : "Edit show")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
                }
            }
            .mmScreen()
            .onAppear(perform: prefill)
        }
    }

    private func group<Content: View>(_ title: LocalizedStringKey, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(MM.Font.display(17)).foregroundStyle(MM.Color.ink)
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .mmCard()
    }

    private func optionLabel(_ title: LocalizedStringKey, _ detail: LocalizedStringKey) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(MM.Font.body(15, weight: .medium)).foregroundStyle(MM.Color.ink)
            Text(detail).font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
        }
    }

    private func prefill() {
        guard !prefilled else { return }
        prefilled = true
        guard let show = existing else {
            if let main = session.user?.sellerProfile?.mainCategory { category = main }
            return
        }
        title = show.title
        category = show.category ?? category
        subcategory = show.subcategory
        if let date = show.startDate { start = date }
        format = show.format ?? "auction"
        description = show.description ?? ""
        posterUrl = (show.posterUrl?.isEmpty == false) ? show.posterUrl : nil
        isPrivate = show.visibility == "private"
        explicit = show.explicit ?? false
        language = show.language ?? language
        moderators = (show.moderators ?? []).map { "@\($0.handle)" }.joined(separator: ", ")
        mutedWords = (show.mutedWords ?? []).joined(separator: ", ")
        freePickup = show.shipping?.freePickup ?? false
        shippingCap = show.shipping?.shippingCap.map { String(format: "%g", $0) } ?? ""
    }

    private static func list(_ text: String) -> [String] {
        text.split(separator: ",").map { String($0).trimmed }.filter { !$0.isEmpty }
    }

    private func save() {
        message = nil
        let cap = shippingCap.trimmed.replacingOccurrences(of: ",", with: ".")
        if !cap.isEmpty, Double(cap) == nil { message = String(localized: "The shipping cap must be a number."); return }
        busy = true
        let input = APIClient.ShowInput(
            title: title.trimmed, categoryId: category, subcategoryId: subcategory,
            scheduledStartTime: start.ISO8601Format(), description: description.trimmed,
            format: format, visibility: isPrivate ? "private" : "public", language: language,
            posterUrl: posterUrl ?? "",
            moderators: Self.list(moderators).map { $0.hasPrefix("@") ? String($0.dropFirst()) : $0 },
            mutedWords: Self.list(mutedWords),
            explicit: explicit,
            shipping: ShowShipping(freePickup: freePickup, shippingCap: cap.isEmpty ? nil : Double(cap)))
        Task {
            defer { busy = false }
            do {
                let result: StreamResponse
                if let existing { result = try await APIClient.shared.updateStream(id: existing.id, input) }
                else { result = try await APIClient.shared.createStream(input) }
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                onSaved(result.stream)
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
    @State private var editing = false
    @State private var hosting = false

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
        .toolbar {
            if let stream {
                if let link = stream.shareUrl.flatMap(URL.init(string:)) {
                    ToolbarItem(placement: .primaryAction) {
                        ShareLink(item: link, subject: Text(stream.title), message: Text(stream.title)) { Image(systemName: "square.and.arrow.up") }
                            .accessibilityLabel("Share show")
                    }
                }
                if stream.isScheduled {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Edit") { editing = true }.accessibilityIdentifier("show-edit")
                    }
                }
            }
        }
        .fullScreenCover(isPresented: $hosting, onDismiss: { Task { await load(); onChange() } }) {
            HostLiveView(streamId: streamId)
        }
        .sheet(isPresented: $editing) {
            if let stream { ScheduleShowSheet(existing: stream) { _ in Task { await load(); onChange() } } }
        }
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
            if let cover = stream.posterUrl, !cover.isEmpty {
                ArtworkView(source: cover, symbol: Catalog.category(stream.category).symbol)
                    .frame(maxWidth: .infinity).frame(height: 180)
                    .clipShape(RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous))
            }
            Text(stream.title).font(MM.Font.display(24)).foregroundStyle(MM.Color.ink)
            HStack(spacing: 12) {
                if let count = stream.reminderCount, stream.isScheduled {
                    Label("\(count) saved", systemImage: "bell.fill").font(MM.Font.body(13)).foregroundStyle(MM.Color.gold)
                }
                if stream.visibility == "private" { Label("Private", systemImage: "lock.fill").font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2) }
                if stream.seriesId != nil { Label("Part of a series", systemImage: "repeat").font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2) }
            }
            if let date = stream.startDate {
                Label(date.formatted(.dateTime.weekday(.wide).month().day().hour().minute()), systemImage: "clock")
                    .font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2)
            }
            if let notes = stream.description, !notes.isEmpty {
                Text(notes).font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2)
            }
            if stream.isScheduled || stream.isLive {
                Button { hosting = true } label: {
                    Label(stream.isLive ? "Return to your live show" : "Go live", systemImage: "dot.radiowaves.left.and.right")
                }
                .buttonStyle(.gold)
                .accessibilityIdentifier("show-go-live")
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
