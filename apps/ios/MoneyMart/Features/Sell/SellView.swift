import SwiftUI
import PhotosUI
import UIKit

/// Converts a picked photo into the data URI the API's byte-sniffing validator accepts.
///
/// The server measures the ENCODED string against a 3,000,000-character ceiling, so the
/// raw JPEG budget is ¾ of that minus the prefix. Photos are downscaled to 1600px and
/// re-encoded as JPEG, which also strips EXIF/GPS metadata from what a buyer can see.
enum ListingImage {
    static let encodedLimit = 3_000_000
    static let prefix = "data:image/jpeg;base64,"
    static var rawBudget: Int { (encodedLimit - prefix.count) * 3 / 4 }

    static func encode(_ image: UIImage, maxDimension: CGFloat = 1600) -> String? {
        let scale = min(1, maxDimension / max(image.size.width, image.size.height))
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        for quality in stride(from: 0.82, through: 0.4, by: -0.14) {
            if let data = resized.jpegData(compressionQuality: quality), data.count <= rawBudget {
                return prefix + data.base64EncodedString()
            }
        }
        return nil
    }
}

struct CameraPicker: UIViewControllerRepresentable {
    var onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
            parent.dismiss()
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}

struct SellView: View {
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router

    @State private var title = ""
    @State private var description = ""
    @State private var category = "collectibles"
    @State private var subcategory: String?
    @State private var showSellerSetup = false
    @State private var condition = "good"
    @State private var format: AuctionType = .liveStream
    @State private var startingPrice = ""
    @State private var reservePrice = ""
    @State private var buyItNow = ""
    @State private var duration = 7
    @State private var photos: [String] = []
    @State private var picks: [PhotosPickerItem] = []
    @State private var showCamera = false
    @State private var busy = false
    @State private var notice: String?
    @State private var published: Auction?

    private let maxPhotos = 20

    var body: some View {
        Group {
            if session.isSignedIn { form } else { gate }
        }
        .navigationTitle("Sell")
        .mmScreen()
        .navigationDestination(item: $published) { AuctionDetailView(auctionId: $0.id) }
    }

    private var gate: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "tag.fill").font(.system(size: 54)).foregroundStyle(MM.Color.gold)
            Text("Sell anything, live or listed").font(MM.Font.display(26)).foregroundStyle(MM.Color.ink).multilineTextAlignment(.center)
            Text("Run a live auction show, list in a timed sale, or set a Buy It Now price. Payouts release after delivery through escrow.")
                .font(MM.Font.body(15)).foregroundStyle(MM.Color.ink2).multilineTextAlignment(.center)
            Button("Sign in to start selling") { router.showSignIn = true }.buttonStyle(.gold)
            Spacer()
        }
        .padding(24)
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                studioCard
                photoStrip
                InputField(title: "Title", text: $title, prompt: "e.g. Air Jordan 1 Chicago, 2015, DS")
                    .accessibilityIdentifier("sell-title")
                InputField(title: "Description", text: $description, prompt: "Brand, size, flaws, what's included", axis: .vertical)
                    .lineLimit(4...8)

                classification
                formatPicker
                pricing
                feeSummary

                if let notice {
                    Label(notice, systemImage: "exclamationmark.triangle.fill").font(MM.Font.body(13, weight: .medium)).foregroundStyle(MM.Color.errorText)
                }
                Button(action: publish) {
                    if busy { ProgressView().tint(MM.Color.navy) } else { Text("Publish listing") }
                }
                .buttonStyle(.gold)
                .disabled(busy || !canPublish)
                .accessibilityIdentifier("sell-publish")
            }
            .padding(MM.Space.screen)
        }
        .scrollDismissesKeyboard(.interactively)
        .toolbar {
            // Decimal pads have no return key; give sellers a way out.
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                }
                .font(MM.Font.body(16, weight: .semibold))
            }
        }
        .onChange(of: picks) { _, items in Task { await ingest(items) } }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in if let value = ListingImage.encode(image) { photos.append(value) } }.ignoresSafeArea()
        }
    }

    private var classification: some View {
        VStack(alignment: .leading, spacing: 12) {
            CategoryField(category: $category, subcategory: $subcategory)
            pickerBlock("Condition") {
                Picker("Condition", selection: $condition) {
                    ForEach(Catalog.conditions) { (item: Catalog.Condition) in
                        Text(item.label).tag(item.id)
                    }
                }
            }
            Text(Catalog.condition(condition).hint).font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
        }
    }

    private var formatPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Format").font(MM.Font.body(12, weight: .semibold)).foregroundStyle(MM.Color.ink2)
            Picker("Format", selection: $format) {
                Text("Live").tag(AuctionType.liveStream)
                Text("Timed").tag(AuctionType.traditional)
                Text("Buy now").tag(AuctionType.buyNow)
                Text("Offer").tag(AuctionType.makeOffer)
            }
            .pickerStyle(.segmented)
        }
    }

    private var pricing: some View {
        let priceTitle: LocalizedStringKey = format == .buyNow ? "Price" : "Starting price"
        let hasReserve = format == .liveStream || format == .traditional
        return VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                InputField(title: priceTitle, text: $startingPrice, prompt: "0", keyboard: .decimalPad)
                    .accessibilityIdentifier("sell-price")
                if hasReserve {
                    InputField(title: "Reserve (optional)", text: $reservePrice, prompt: "—", keyboard: .decimalPad)
                }
            }
            if format != .buyNow {
                InputField(title: "Buy It Now (optional)", text: $buyItNow, prompt: "—", keyboard: .decimalPad)
            }
            Stepper(value: $duration, in: 1...14) {
                Text("Duration: \(duration) days").font(MM.Font.body(15, weight: .medium)).foregroundStyle(MM.Color.ink)
            }
        }
    }

    private var photoStrip: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Photos").font(MM.Font.body(12, weight: .semibold)).foregroundStyle(MM.Color.ink2)
                Spacer()
                Text("\(photos.count)/\(maxPhotos)").font(MM.Font.data(12)).foregroundStyle(MM.Color.ink3)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    PhotosPicker(selection: $picks, maxSelectionCount: maxPhotos - photos.count, matching: .images) {
                        Self.tile(symbol: "photo.on.rectangle.angled", label: "Library")
                    }
                    .disabled(photos.count >= maxPhotos)
                    .accessibilityIdentifier("sell-library")
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button { showCamera = true } label: { Self.tile(symbol: "camera.fill", label: "Camera") }
                    }
                    ForEach(Array(photos.enumerated()), id: \.offset) { index, photo in
                        ArtworkView(source: photo)
                            .frame(width: 92, height: 92)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .overlay(alignment: .topTrailing) {
                                Button { photos.remove(at: index) } label: {
                                    Image(systemName: "xmark.circle.fill").foregroundStyle(.white, .black.opacity(0.6))
                                }
                                .padding(4)
                                .accessibilityLabel("Remove photo \(index + 1)")
                            }
                            .overlay(alignment: .bottomLeading) {
                                if index == 0 { Pill(text: "Cover").padding(4) }
                            }
                    }
                }
            }
            Text("Clean, well-lit photos sell faster. The first photo is your cover.").font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
        }
    }

    nonisolated private static func tile(symbol: String, label: LocalizedStringKey) -> some View {
        VStack(spacing: 6) {
            Image(systemName: symbol).font(.system(size: 22, weight: .semibold))
            Text(label).font(MM.Font.body(12, weight: .semibold))
        }
        .foregroundStyle(MM.Color.gold)
        .frame(width: 92, height: 92)
        .background(MM.Color.goldSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(MM.Color.goldLine, style: StrokeStyle(lineWidth: 1, dash: [5])))
    }

    private func pickerBlock<Content: View>(_ title: LocalizedStringKey, @ViewBuilder content: () -> Content) -> some View {
        HStack {
            Text(title).font(MM.Font.body(15, weight: .medium)).foregroundStyle(MM.Color.ink)
            Spacer()
            content().pickerStyle(.menu)
        }
        .padding(.horizontal, 14).padding(.vertical, 6)
        .background(MM.Color.raised, in: RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: MM.Radius.md, style: .continuous).stroke(MM.Color.border, lineWidth: 1))
    }

    private var feeSummary: some View {
        let price = number(startingPrice) ?? 0
        let currency = session.currency
        return VStack(alignment: .leading, spacing: 6) {
            Label("You keep 85% of live-show sales. Buyers pay a \(Int(Catalog.premiumRate(category: category, pro: false) * 100))% premium on this category.", systemImage: "info.circle")
                .font(MM.Font.body(13)).foregroundStyle(MM.Color.ink2)
            if price > 0 {
                Text("Estimated payout at opening price: \(Format.money(price * 0.85, currency))").font(MM.Font.data(14, weight: .semibold)).foregroundStyle(MM.Color.green)
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(MM.Color.raised, in: RoundedRectangle(cornerRadius: MM.Radius.md))
    }

    private var canPublish: Bool {
        title.trimmingCharacters(in: .whitespaces).count >= 3 && (number(startingPrice) ?? 0) > 0
    }

    private func number(_ text: String) -> Double? {
        let cleaned = text.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)
        return cleaned.isEmpty ? nil : Double(cleaned)
    }

    private func ingest(_ items: [PhotosPickerItem]) async {
        for item in items where photos.count < maxPhotos {
            guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else { continue }
            if let value = ListingImage.encode(image) { photos.append(value) } else { notice = String(localized: "A photo was too large to upload.") }
        }
        picks = []
    }

    private func publish() {
        guard let price = number(startingPrice) else { return }
        busy = true; notice = nil
        let listing = APIClient.NewListing(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            categoryId: category, subcategoryId: subcategory, condition: condition, auctionType: format.rawValue,
            startingPrice: price, reservePrice: number(reservePrice),
            buyItNowPrice: format == .buyNow ? price : number(buyItNow),
            durationDays: duration, images: photos)
        Task {
            defer { busy = false }
            do {
                let result = try await APIClient.shared.createListing(listing)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                reset()
                published = result.auction
            } catch {
                notice = error.localizedDescription
            }
        }
    }

    private func reset() {
        title = ""; description = ""; startingPrice = ""; reservePrice = ""; buyItNow = ""; photos = []; duration = 7
        subcategory = nil
    }

    /// Entry to live selling: set up once, then manage shows.
    @ViewBuilder
    private var studioCard: some View {
        let ready = session.user?.sellerProfile != nil
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "dot.radiowaves.left.and.right").font(.system(size: 20, weight: .semibold)).foregroundStyle(MM.Color.gold)
                Text("Seller Studio").font(MM.Font.display(18)).foregroundStyle(MM.Color.ink)
                Spacer()
                if ready { Pill(text: "Ready to sell", systemImage: "checkmark.seal.fill", tint: MM.Color.green) }
            }
            Text(ready ? "Schedule live shows and line up the items you’ll sell on air." : "Set up your shop once to host live shows. It takes about two minutes.")
                .font(MM.Font.body(14)).foregroundStyle(MM.Color.ink2)
            if ready {
                HStack(spacing: 10) {
                    NavigationLink { MyShowsView() } label: { Label("My shows", systemImage: "calendar") }
                        .buttonStyle(.goldCompact)
                        .accessibilityIdentifier("studio-shows")
                    NavigationLink(value: Router.Route.studio) { Label("Orders & payouts", systemImage: "chart.bar.xaxis") }
                        .buttonStyle(.glass)
                        .accessibilityIdentifier("studio-open")
                    if session.user?.verificationStatus != "verified" {
                        NavigationLink(value: Router.Route.verification) { Label("Get verified", systemImage: "checkmark.seal") }
                            .buttonStyle(.glass)
                            .accessibilityIdentifier("studio-verify")
                    }
                }
            } else {
                Button { showSellerSetup = true } label: { Label("Set up selling", systemImage: "sparkles") }
                    .buttonStyle(.goldCompact)
                    .accessibilityIdentifier("studio-setup")
            }
        }
        .padding(14)
        .mmCard()
        .fullScreenCover(isPresented: $showSellerSetup) { SellerOnboardingView() }
    }
}
