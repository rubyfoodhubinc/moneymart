import PhotosUI
import SwiftUI

/// Guided scheduler: plan a run of shows for the next two weeks in a few taps.
/// Creates them in one all-or-nothing request, so a seller never ends up with
/// half a schedule.
struct ScheduleWizard: View {
    var onCreated: ([LiveStream]) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session

    enum Step: Int, CaseIterable { case frequency, days, time, calendar, title, category, thumbnail, review }

    enum Frequency: String, CaseIterable, Identifiable {
        case once, weekly1, weekly2, weekly3
        var id: String { rawValue }
        var title: LocalizedStringKey {
            switch self {
            case .once: return "A one-off show"
            case .weekly1: return "Once a week"
            case .weekly2: return "Twice a week"
            case .weekly3: return "Three or more a week"
            }
        }
        var suggestedDays: Int { switch self { case .once: 0; case .weekly1: 1; case .weekly2: 2; case .weekly3: 3 } }
    }

    @State private var step: Step = .frequency
    @State private var frequency: Frequency = .weekly1
    @State private var weekdays: Set<Int> = []
    @State private var time = Calendar.current.date(bySettingHour: 19, minute: 0, second: 0, of: .now) ?? .now
    @State private var oneOffDate = Calendar.current.date(byAdding: .day, value: 1, to: .now) ?? .now
    @State private var dates: [Date] = []
    @State private var excluded: Set<Date> = []
    @State private var title = ""
    @State private var category = "collectibles"
    @State private var subcategory: String?
    @State private var format = "auction"
    @State private var posterUrl: String?
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ProgressView(value: Double(step.rawValue + 1), total: Double(Step.allCases.count))
                    .tint(MM.Color.gold).padding(.horizontal, MM.Space.screen)
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) { content }
                        .padding(MM.Space.screen)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .scrollDismissesKeyboard(.interactively)
                footer
            }
            .mmScreen()
            .navigationTitle("Plan your shows")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if step == .frequency { Button("Cancel") { dismiss() } }
                    else { Button { back() } label: { Image(systemName: "chevron.left") }.accessibilityLabel("Back") }
                }
            }
            .onAppear {
                if let main = session.user?.sellerProfile?.mainCategory, category == "collectibles" { category = main }
            }
        }
        .interactiveDismissDisabled(step != .frequency)
    }

    // MARK: Steps

    @ViewBuilder
    private var content: some View {
        switch step {
        case .frequency:
            heading("How often will you go live?", "Plan the next two weeks. You can change or cancel any show later.")
            ForEach(Frequency.allCases) { option in
                choiceRow(option.title, detail: option == .weekly1 ? "Recommended for new sellers" : nil, selected: frequency == option) {
                    frequency = option
                }
                .accessibilityIdentifier("wizard-frequency-\(option.rawValue)")
            }
            tip("Buyers come back to sellers they can count on. A steady slot beats a busy one.")
        case .days:
            heading("Which days suit you?", frequency.suggestedDays > 1 ? "Pick \(frequency.suggestedDays) or more days." : "Pick at least one day.")
            ForEach(orderedWeekdays, id: \.self) { weekday in
                choiceRow(LocalizedStringKey(Calendar.current.weekdaySymbols[weekday - 1]), selected: weekdays.contains(weekday), multi: true) {
                    if weekdays.contains(weekday) { weekdays.remove(weekday) } else { weekdays.insert(weekday) }
                }
                .accessibilityIdentifier("wizard-day-\(weekday)")
            }
        case .time:
            heading(frequency == .once ? "When is the show?" : "What time do you start?", "Shown to buyers in their own time zone.")
            if frequency == .once {
                DatePicker("Date", selection: $oneOffDate, in: Date.now..., displayedComponents: .date)
                    .datePickerStyle(.graphical).tint(MM.Color.gold)
            }
            DatePicker("Start time", selection: $time, displayedComponents: .hourAndMinute)
                .datePickerStyle(.wheel).labelsHidden().frame(maxWidth: .infinity)
            tip("Pick a time you can keep. Regulars plan around it.")
        case .calendar:
            heading("Here’s your schedule", "Untick any date you can’t make.")
            if dates.isEmpty {
                EmptyStateView(symbol: "calendar.badge.exclamationmark", title: "No dates left", message: "Every time in the next two weeks has passed. Pick different days or a later time.")
            }
            ForEach(dates, id: \.self) { date in
                choiceRow(LocalizedStringKey(date.formatted(.dateTime.weekday(.wide).month().day().hour().minute())),
                          selected: !excluded.contains(date), multi: true) {
                    if excluded.contains(date) { excluded.remove(date) } else { excluded.insert(date) }
                }
            }
            Text("\(chosenDates.count) shows").font(MM.Font.data(13, weight: .semibold)).foregroundStyle(MM.Color.gold)
        case .title:
            heading("Name your show", "Short and specific works best — buyers should know what you sell at a glance.")
            InputField(title: "Show title", text: $title, prompt: "e.g. $1 start sneaker night")
                .accessibilityIdentifier("wizard-title")
            Text("\(title.count)/150").font(MM.Font.data(11)).foregroundStyle(title.count > 150 ? MM.Color.errorText : MM.Color.ink3)
            if chosenDates.count > 1 {
                Text("All \(chosenDates.count) shows use this title. You can rename any of them later.").font(MM.Font.body(13)).foregroundStyle(MM.Color.ink3)
            }
        case .category:
            heading("Category and format", "This is where buyers will find you.")
            CategoryField(category: $category, subcategory: $subcategory, title: "Main category")
            Text("Selling format").font(MM.Font.body(12, weight: .semibold)).foregroundStyle(MM.Color.ink2)
            Picker("Selling format", selection: $format) {
                Text("Auctions").tag("auction")
                Text("Buy It Now").tag("buy_now")
                Text("Both").tag("mixed")
            }
            .pickerStyle(.segmented)
        case .thumbnail:
            heading("Add a cover image", "This is what buyers see before they tap in. A photo of your best item works well.")
            ShowThumbnailPicker(posterUrl: $posterUrl, title: title, category: category)
        case .review:
            heading("Ready to schedule", nil)
            VStack(alignment: .leading, spacing: 8) {
                Text(title.trimmed).font(MM.Font.display(20)).foregroundStyle(MM.Color.ink)
                Label(String(localized: Catalog.category(category).label), systemImage: Catalog.category(category).symbol)
                    .font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2)
                ForEach(chosenDates, id: \.self) { date in
                    Label(date.formatted(.dateTime.weekday(.abbreviated).month().day().hour().minute()), systemImage: "calendar")
                        .font(MM.Font.body(14)).foregroundStyle(MM.Color.ink)
                }
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading).mmCard()
            Text("Next: add the items you’ll sell to each show.").font(MM.Font.body(13)).foregroundStyle(MM.Color.ink3)
        }
        if let message {
            Label(message, systemImage: "exclamationmark.triangle.fill").font(MM.Font.body(13, weight: .medium)).foregroundStyle(MM.Color.errorText)
        }
    }

    private var footer: some View {
        HStack {
            Text("\(step.rawValue + 1) of \(Step.allCases.count)").font(MM.Font.data(12)).foregroundStyle(MM.Color.ink3)
            Spacer()
            Button(action: next) {
                if busy { ProgressView().tint(MM.Color.navy) }
                else if step == .review { Text(chosenDates.count == 1 ? "Schedule show" : "Schedule \(chosenDates.count) shows") }
                else if step == .thumbnail && posterUrl == nil { Text("Add later") }
                else { Text("Next") }
            }
            .buttonStyle(.goldCompact)
            .disabled(!canContinue || busy)
            .accessibilityIdentifier("wizard-next")
        }
        .padding(MM.Space.screen)
    }

    // MARK: Logic

    /// Weekdays in the user's calendar order (Monday first where that is the custom).
    private var orderedWeekdays: [Int] {
        let first = Calendar.current.firstWeekday
        return (0..<7).map { (first - 1 + $0) % 7 + 1 }
    }

    private var chosenDates: [Date] { dates.filter { !excluded.contains($0) } }

    private var canContinue: Bool {
        switch step {
        case .frequency, .thumbnail, .category: return true
        case .days: return !weekdays.isEmpty
        case .time: return frequency != .once || combined(oneOffDate) > Date.now.addingTimeInterval(5 * 60)
        case .calendar: return !chosenDates.isEmpty
        case .title: return title.trimmed.count >= 3 && title.count <= 150
        case .review: return !chosenDates.isEmpty
        }
    }

    /// `day` at the chosen start time.
    private func combined(_ day: Date) -> Date {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: time)
        return Calendar.current.date(bySettingHour: parts.hour ?? 19, minute: parts.minute ?? 0, second: 0, of: day) ?? day
    }

    /// Every chosen weekday over the next 14 days at the start time, skipping times
    /// already past. At most 20, matching the server's batch limit.
    private func buildDates() {
        excluded = []
        if frequency == .once {
            dates = [combined(oneOffDate)]
            return
        }
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: .now)
        let earliest = Date.now.addingTimeInterval(10 * 60)
        dates = (0..<14).compactMap { offset -> Date? in
            guard let day = calendar.date(byAdding: .day, value: offset, to: today),
                  weekdays.contains(calendar.component(.weekday, from: day)) else { return nil }
            let start = combined(day)
            return start > earliest ? start : nil
        }
        .prefix(20)
        .map { $0 }
    }

    private func next() {
        message = nil
        switch step {
        case .frequency:
            go(frequency == .once ? .time : .days)
        case .time:
            buildDates()
            go(frequency == .once ? .title : .calendar)
        case .review:
            save()
        default:
            go(Step(rawValue: step.rawValue + 1) ?? .review)
        }
    }

    private func back() {
        message = nil
        switch step {
        case .time: go(frequency == .once ? .frequency : .days)
        case .title: go(frequency == .once ? .time : .calendar)
        default: go(Step(rawValue: step.rawValue - 1) ?? .frequency)
        }
    }

    private func go(_ target: Step) { withAnimation(.snappy) { step = target } }

    private func save() {
        busy = true
        let show = APIClient.ShowInput(
            title: title.trimmed, categoryId: category, subcategoryId: subcategory,
            format: format, visibility: "public", language: Locale.current.language.languageCode?.identifier,
            posterUrl: posterUrl)
        let times = chosenDates.map { $0.ISO8601Format() }
        Task {
            defer { busy = false }
            do {
                let result = try await APIClient.shared.createStreams(show, startTimes: times)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                onCreated(result.streams)
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
    }

    private func tip(_ text: LocalizedStringKey) -> some View {
        Label(text, systemImage: "lightbulb.fill")
            .font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2)
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(MM.Color.goldSoft, in: RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous))
    }

    private func choiceRow(_ title: LocalizedStringKey, detail: LocalizedStringKey? = nil, selected: Bool, multi: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(MM.Font.body(16, weight: .semibold)).foregroundStyle(MM.Color.ink)
                    if let detail { Text(detail).font(MM.Font.body(12, weight: .semibold)).foregroundStyle(MM.Color.gold) }
                }
                Spacer()
                Image(systemName: multi ? (selected ? "checkmark.square.fill" : "square") : (selected ? "largecircle.fill.circle" : "circle"))
                    .font(.system(size: 20)).foregroundStyle(selected ? MM.Color.gold : MM.Color.ink3)
            }
            .padding(14)
            .background(MM.Color.raised, in: RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous).stroke(selected ? MM.Color.borderStrong : MM.Color.border, lineWidth: selected ? 1.5 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Picks a show cover from the library, previewed as buyers will see it.
struct ShowThumbnailPicker: View {
    @Binding var posterUrl: String?
    var title: String
    var category: String
    @Environment(SessionStore.self) private var session
    @State private var pick: PhotosPickerItem?
    @State private var failed = false
    @State private var choosing = false

    var body: some View {
        VStack(spacing: 12) {
            // A plain button plus the picker modifier keeps the preview on the main actor.
            Button { choosing = true } label: {
                ZStack(alignment: .bottomLeading) {
                    ArtworkView(source: posterUrl, symbol: Catalog.category(category).symbol)
                        .frame(maxWidth: .infinity)
                        .frame(height: 300)
                        .clipShape(RoundedRectangle(cornerRadius: MM.Radius.lg, style: .continuous))
                    if posterUrl == nil {
                        Label("Choose a cover image", systemImage: "photo.badge.plus")
                            .font(MM.Font.body(15, weight: .semibold)).foregroundStyle(MM.Color.gold)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(session.user?.displayName ?? "").font(MM.Font.body(12, weight: .semibold)).foregroundStyle(.white.opacity(0.8))
                        Text(title.isEmpty ? String(localized: "Your show") : title).font(MM.Font.body(16, weight: .bold)).foregroundStyle(.white).lineLimit(2)
                    }
                    .padding(12)
                }
                .overlay(RoundedRectangle(cornerRadius: MM.Radius.lg, style: .continuous).stroke(MM.Color.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .photosPicker(isPresented: $choosing, selection: $pick, matching: .images)
            .accessibilityIdentifier("show-thumbnail")
            if posterUrl != nil {
                Button("Remove image", role: .destructive) { posterUrl = nil }.font(MM.Font.body(14, weight: .medium))
            }
            if failed {
                Text("That image could not be used. Try another.").font(MM.Font.body(13)).foregroundStyle(MM.Color.errorText)
            }
        }
        .onChange(of: pick) { _, item in
            guard let item else { return }
            Task {
                // Covers appear in every show list, so they are kept small.
                if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data),
                   let encoded = ListingImage.encode(image, maxDimension: 720) {
                    posterUrl = encoded
                    failed = false
                } else {
                    failed = true
                }
                pick = nil
            }
        }
    }
}
