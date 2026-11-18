import SwiftUI
import SafariServices

/// Seller identity check, run by Didit on its own secure page. MoneyMart keeps only the outcome.
struct VerificationView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @State private var info: VerificationInfo?
    @State private var error: String?
    @State private var kind = "person"
    @State private var working = false
    @State private var page: IdentifiedURL?

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if let info {
                    statusCard(info)
                    if info.canStart { startCard(info) }
                    if info.status == "pending" { pendingCard(info) }
                    privacyNote
                } else if let error {
                    ErrorState(message: error) { Task { await load() } }
                } else {
                    LoadingState()
                }
                if let error, info != nil {
                    Text(error).font(MM.Font.body(13)).foregroundStyle(MM.Color.errorText).accessibilityIdentifier("verify-error")
                }
            }
            .padding(MM.Space.screen)
        }
        .navigationTitle("Verification")
        .task { await load() }
        .refreshable { await refresh() }
        .onChange(of: scenePhase) { _, phase in if phase == .active, info?.status == "pending" { Task { await refresh() } } }
        .sheet(item: $page, onDismiss: { Task { await refresh() } }) { SafariView(url: $0.url).ignoresSafeArea() }
        .mmScreen()
    }

    // MARK: Cards

    private func statusCard(_ info: VerificationInfo) -> some View {
        let look = Self.look(info.status)
        return VStack(spacing: 10) {
            Image(systemName: look.symbol).font(.system(size: 44, weight: .semibold)).foregroundStyle(look.tint)
            Text(look.title).font(MM.Font.display(22)).foregroundStyle(MM.Color.ink).accessibilityIdentifier("verify-status")
            Text(look.message).font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2).multilineTextAlignment(.center)
            if info.status == "rejected", let reason = info.reason {
                Text(reason).font(MM.Font.body(13, weight: .medium)).foregroundStyle(MM.Color.errorText)
            }
            if info.status == "verified" {
                Pill(text: info.kind == "business" ? "Business verified" : "Identity verified", systemImage: "checkmark.seal.fill", tint: MM.Color.green)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(20)
        .mmCard()
    }

    private func startCard(_ info: VerificationInfo) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Who is selling?").font(MM.Font.body(15, weight: .semibold)).foregroundStyle(MM.Color.ink)
            Picker("Seller type", selection: $kind) {
                Text("Just me").tag("person")
                Text("A business").tag("business")
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("verify-kind")
            Text(kind == "business"
                 ? "Have your company registration and an ID for a director ready. It takes about 10 minutes."
                 : "Have your passport, driving licence or national ID ready. You'll take a quick selfie. It takes about 3 minutes.")
                .font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2)
            Button { Task { await start() } } label: {
                Label(info.status == "rejected" ? "Try again" : "Verify my identity", systemImage: "person.badge.shield.checkmark.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.gold)
            .disabled(working)
            .accessibilityIdentifier("verify-start")
        }
        .padding(16)
        .mmCard()
    }

    private func pendingCard(_ info: VerificationInfo) -> some View {
        VStack(spacing: 10) {
            if let resume = info.resumeUrl, let url = URL(string: resume), info.providerStatus != "In Review" {
                Button { page = IdentifiedURL(url: url) } label: { Label("Continue verification", systemImage: "arrow.right.circle.fill").frame(maxWidth: .infinity) }
                    .buttonStyle(.gold)
                    .accessibilityIdentifier("verify-continue")
            }
            Button { Task { await refresh() } } label: { Label("Check status", systemImage: "arrow.clockwise").frame(maxWidth: .infinity) }
                .buttonStyle(.glass)
                .disabled(working)
                .accessibilityIdentifier("verify-refresh")
        }
        .padding(16)
        .mmCard()
    }

    private var privacyNote: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "lock.shield.fill").foregroundStyle(MM.Color.gold)
            Text("Checks are run by Didit, our verification partner, on its own secure page. Your documents and selfie go to Didit, not to MoneyMart — we only keep the result.")
                .font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
        }
        .padding(.horizontal, 4)
    }

    static func look(_ status: String) -> (symbol: String, tint: Color, title: LocalizedStringKey, message: LocalizedStringKey) {
        switch status {
        case "verified":
            ("checkmark.seal.fill", MM.Color.green, "You're verified", "Buyers see the verified badge on your shop and listings.")
        case "pending":
            ("hourglass", MM.Color.gold, "Check in progress", "Finish the steps on Didit's page. Once you're done, the result usually takes a few minutes; a review can take longer. We'll notify you.")
        case "rejected":
            ("xmark.seal.fill", MM.Color.errorText, "Not approved", "Your check didn't pass. You can try again with a clear photo of a valid document, or contact support.")
        default:
            ("person.badge.shield.checkmark", MM.Color.gold, "Verify your identity", "Verified sellers get a badge buyers trust, and may be required to host live shows.")
        }
    }

    // MARK: Actions

    private func load() async {
        do {
            let value = try await APIClient.shared.verification()
            info = value
            kind = value.kind
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    private func refresh() async {
        guard info != nil else { return await load() }
        working = true
        defer { working = false }
        do {
            info = try await APIClient.shared.refreshVerification()
            error = nil
            if info?.status == "verified" { await session.refresh() }
        } catch { self.error = error.localizedDescription }
    }

    private func start() async {
        working = true
        defer { working = false }
        do {
            let result = try await APIClient.shared.startVerification(kind: kind)
            info = result.verification
            error = nil
            if let url = URL(string: result.url) { page = IdentifiedURL(url: url) }
        } catch { self.error = error.localizedDescription }
    }
}

struct IdentifiedURL: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

/// Didit's page in an in-app Safari sheet, so the camera works and the member comes straight back.
struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.preferredControlTintColor = UIColor(MM.Color.gold)
        controller.dismissButtonStyle = .done
        return controller
    }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
