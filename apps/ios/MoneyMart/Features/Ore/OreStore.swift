import SwiftUI
import UniformTypeIdentifiers
import CryptoKit

/// A message in an Ore conversation (kept on the device only).
struct OreMessage: Codable, Identifiable, Equatable, Sendable {
    enum Role: String, Codable, Sendable { case member, ore }
    struct Attachment: Codable, Equatable, Sendable {
        enum Kind: String, Codable, Sendable { case image, pdf, file }
        var name: String
        var kind: Kind
        /// A small JPEG preview for photos (the full file is never stored).
        var thumbnail: Data?
    }

    var id = UUID()
    var role: Role
    var text: String
    var attachments: [Attachment] = []
    var reported: [String] = []
    var failed = false
    var viaVoice = false
}

struct OreConversation: Codable, Identifiable, Equatable, Sendable {
    var id = UUID()
    var title: String
    var updatedAt: Date
    var messages: [OreMessage]
}

/// A file the member has picked but not sent yet.
struct OrePendingAttachment: Identifiable, Equatable {
    let id = UUID()
    let name: String
    let mediaType: String
    let data: Data
    let kind: OreMessage.Attachment.Kind
    let preview: UIImage?
}

/// Ore, the member's chief of staff (AI Company Standard §5).
///
/// Conversations live in a file on this device, one file per account, so another account signed in on the same
/// phone never sees them. The server keeps no member chat history.
@MainActor
@Observable
final class OreStore {
    private(set) var enabled = false
    private(set) var available = false
    private(set) var serverVoice = false
    private(set) var presidentName = "Ore"

    private(set) var conversations: [OreConversation] = []
    private(set) var currentID: UUID?
    var pending: [OrePendingAttachment] = []
    private(set) var sending = false
    var notice: String?

    @ObservationIgnored private var ownerID: String?

    /// Ore shows in the app only when the Owner has her on and the server can reach her model.
    var visible: Bool { enabled && available }
    var current: OreConversation? { conversations.first { $0.id == currentID } }
    var messages: [OreMessage] { current?.messages ?? [] }

    static let maxAttachments = 4

    func refreshStatus() async {
        guard let status = try? await APIClient.shared.oreStatus() else { return }
        enabled = status.enabled
        available = status.available
        serverVoice = status.voice ?? false
        presidentName = status.president
    }

    // MARK: Conversations

    /// Loads this account's conversations (call when the signed-in member changes).
    func load(for userID: String?) {
        guard userID != ownerID else { return }
        ownerID = userID
        currentID = nil
        pending = []
        conversations = []
        guard let url = fileURL, let data = try? Data(contentsOf: url),
              let saved = try? JSONDecoder().decode([OreConversation].self, from: data) else { return }
        conversations = saved.sorted { $0.updatedAt > $1.updatedAt }
    }

    func newChat() {
        currentID = nil
        pending = []
        notice = nil
    }

    func open(_ id: UUID) {
        currentID = id
        pending = []
        notice = nil
    }

    func delete(_ id: UUID) {
        conversations.removeAll { $0.id == id }
        if currentID == id { currentID = nil }
        save()
    }

    private var fileURL: URL? {
        guard let ownerID else { return nil }
        let hash = SHA256.hash(data: Data(ownerID.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
        let dir = URL.applicationSupportDirectory.appending(path: "Ore", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appending(path: "conversations-\(hash).json")
    }

    private func save() {
        guard let url = fileURL else { return }
        let keep = Array(conversations.sorted { $0.updatedAt > $1.updatedAt }.prefix(60))
        if let data = try? JSONEncoder().encode(keep) {
            try? data.write(to: url, options: [.atomic, .completeFileProtection])
        }
    }

    private func append(_ message: OreMessage) {
        if let index = conversations.firstIndex(where: { $0.id == currentID }) {
            conversations[index].messages.append(message)
            conversations[index].updatedAt = .now
        } else {
            let title = message.text.isEmpty ? (message.attachments.first?.name ?? String(localized: "New chat")) : message.text
            let conversation = OreConversation(title: String(title.prefix(48)), updatedAt: .now, messages: [message])
            conversations.insert(conversation, at: 0)
            currentID = conversation.id
        }
        conversations.sort { $0.updatedAt > $1.updatedAt }
        save()
    }

    // MARK: Attachments

    func addImage(_ image: UIImage, name: String = "Photo.jpg") {
        guard pending.count < Self.maxAttachments else { notice = String(localized: "Up to 4 attachments at a time."); return }
        guard let data = Self.jpeg(image, maxSide: 1600, budget: 3_500_000) else { notice = String(localized: "That photo could not be used."); return }
        pending.append(OrePendingAttachment(name: name, mediaType: "image/jpeg", data: data, kind: .image, preview: image))
    }

    func addFile(at url: URL) {
        guard pending.count < Self.maxAttachments else { notice = String(localized: "Up to 4 attachments at a time."); return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { notice = String(localized: "That file could not be opened."); return }
        let type = UTType(filenameExtension: url.pathExtension) ?? .data
        let name = url.lastPathComponent
        if type.conforms(to: .image), let image = UIImage(data: data) {
            addImage(image, name: name)
        } else if type.conforms(to: .pdf) {
            guard data.count <= 10_000_000 else { notice = String(localized: "PDFs can be up to 10 MB."); return }
            pending.append(OrePendingAttachment(name: name, mediaType: "application/pdf", data: data, kind: .pdf, preview: nil))
        } else if type.conforms(to: .text) || type.conforms(to: .json) || type.conforms(to: .commaSeparatedText) {
            guard data.count <= 200_000 else { notice = String(localized: "Text files can be up to 200 KB."); return }
            let media = type.conforms(to: .commaSeparatedText) ? "text/csv" : type.conforms(to: .json) ? "application/json" : "text/plain"
            pending.append(OrePendingAttachment(name: name, mediaType: media, data: data, kind: .file, preview: nil))
        } else {
            notice = String(localized: "Ore can read photos, PDFs and text files.")
        }
    }

    func removePending(_ id: UUID) { pending.removeAll { $0.id == id } }

    static func jpeg(_ image: UIImage, maxSide: CGFloat, budget: Int) -> Data? {
        let scale = min(1, maxSide / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        for quality in stride(from: 0.82, through: 0.3, by: -0.13) {
            if let data = resized.jpegData(compressionQuality: quality), data.count <= budget { return data }
        }
        return nil
    }

    // MARK: Sending

    var canSend: Bool { !sending }

    /// Sends the member's words (and any picked files) and returns Ore's reply text.
    @discardableResult
    func send(_ raw: String, voice: Bool = false) async -> String? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let files = voice ? [] : pending
        guard !sending, !text.isEmpty || !files.isEmpty else { return nil }
        let history = messages.filter { !$0.failed }.suffix(10).map { APIClient.OreTurn(role: $0.role.rawValue, text: $0.text) }
        let metas = files.map { file in
            OreMessage.Attachment(name: file.name, kind: file.kind,
                                  thumbnail: file.preview.flatMap { Self.jpeg($0, maxSide: 240, budget: 40_000) })
        }
        append(OreMessage(role: .member, text: text, attachments: metas, viaVoice: voice))
        if !voice { pending = [] }
        notice = nil
        sending = true
        defer { sending = false }
        do {
            let reply = try await APIClient.shared.askOre(
                text: text, history: Array(history),
                attachments: files.map { .init(name: $0.name, mediaType: $0.mediaType, data: $0.data.base64EncodedString()) },
                voice: voice)
            append(OreMessage(role: .ore, text: reply.reply, reported: reply.reported.map(\.title), viaVoice: voice))
            return reply.reply
        } catch let error as APIError {
            if error.code == "ore_off" { enabled = false }
            let message = error.code == "bad_attachment" ? error.message : (APIError.readable(error.code) ?? String(localized: "I can't answer right now — please try again in a moment."))
            append(OreMessage(role: .ore, text: message, failed: true, viaVoice: voice))
            return voice ? message : nil
        } catch {
            let message = String(localized: "I can't reach MoneyMart right now — check your connection and try again.")
            append(OreMessage(role: .ore, text: message, failed: true, viaVoice: voice))
            return voice ? message : nil
        }
    }
}
