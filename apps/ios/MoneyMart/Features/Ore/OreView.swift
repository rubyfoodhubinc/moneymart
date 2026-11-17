import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// The gold Ore button used in headers.
struct OreButton: View {
    @Environment(OreStore.self) private var ore
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router

    var body: some View {
        if ore.visible {
            Button { RequiresSignIn.run(session, router) { router.showOre = true } } label: {
                Image(systemName: "sparkles")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(MM.Color.navyDeep)
                    .frame(width: 40, height: 40)
                    .background(MM.Gradient.gold, in: Circle())
            }
            .accessibilityLabel("Ask Ore")
            .accessibilityIdentifier("ore-button")
        }
    }
}

/// Ore — the member's chief of staff. A full-screen chat: greeting, conversation, a composer with attachments,
/// dictation and a voice call, and a drawer with this account's recent chats.
struct OreChatView: View {
    @Environment(OreStore.self) private var ore
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    @State private var draft = ""
    @State private var drawer = false
    @State private var choosingPhotos = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var camera = false
    @State private var importing = false
    @State private var calling = false
    @State private var dictation = SpeechListener()
    @State private var dictationBase = ""
    @FocusState private var focused: Bool

    var body: some View {
        ZStack(alignment: .leading) {
            VStack(spacing: 0) {
                topBar
                if ore.messages.isEmpty { emptyState } else { conversation }
                composer
            }
            .background(MM.Color.surface.ignoresSafeArea())

            if drawer {
                Color.black.opacity(0.45).ignoresSafeArea()
                    .onTapGesture { withAnimation(.easeOut(duration: 0.2)) { drawer = false } }
                    .transition(.opacity)
                OreDrawer(close: { withAnimation(.easeOut(duration: 0.2)) { drawer = false } })
                    .transition(.move(edge: .leading))
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            guard url.scheme == "moneymart" else { return .systemAction }
            dismiss()
            router.open(url)
            return .handled
        })
        .onAppear { ore.load(for: session.user?.id) }
        .photosPicker(isPresented: $choosingPhotos, selection: $photoItems, maxSelectionCount: OreStore.maxAttachments, matching: .images)
        .onChange(of: photoItems) { _, picked in
            guard !picked.isEmpty else { return }
            Task {
                for item in picked {
                    if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) { ore.addImage(image) }
                }
                photoItems = []
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .image, .plainText, .commaSeparatedText, .json, .text], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { urls.prefix(OreStore.maxAttachments).forEach { ore.addFile(at: $0) } }
        }
        .fullScreenCover(isPresented: $camera) {
            CameraPicker { ore.addImage($0, name: "Camera.jpg") }.ignoresSafeArea()
        }
        .fullScreenCover(isPresented: $calling) { OreCallView() }
        .onChange(of: dictation.transcript) { _, words in if dictation.listening { draft = dictationBase + words } }
        .onDisappear { dictation.stop() }
    }

    // MARK: Top bar

    private var topBar: some View {
        HStack(spacing: 12) {
            circleButton("line.3.horizontal", label: "Chats", id: "ore-menu") {
                focused = false
                withAnimation(.easeOut(duration: 0.22)) { drawer = true }
            }
            Spacer()
            if let title = ore.current?.title {
                Text(title).font(MM.Font.body(15, weight: .semibold)).foregroundStyle(MM.Color.ink).lineLimit(1)
                Spacer()
                circleButton("square.and.pencil", label: "New chat", id: "ore-new") { ore.newChat(); draft = "" }
            }
            circleButton("xmark", label: "Close", id: "ore-done") { dismiss() }
        }
        .padding(.horizontal, MM.Space.screen)
        .padding(.top, 8)
        .padding(.bottom, 6)
    }

    private func circleButton(_ symbol: String, label: LocalizedStringKey, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(MM.Color.ink)
                .frame(width: 44, height: 44)
                .background(MM.Color.raised, in: Circle())
                .overlay(Circle().stroke(MM.Color.border, lineWidth: 1))
        }
        .accessibilityLabel(label)
        .accessibilityIdentifier(id)
    }

    // MARK: Empty state

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: .now)
        let first = session.user?.displayName.split(separator: " ").first.map(String.init) ?? ""
        let part = hour < 12 ? String(localized: "Morning") : hour < 17 ? String(localized: "Afternoon") : String(localized: "Evening")
        return first.isEmpty ? part : "\(part), \(first)"
    }

    private var suggestions: [String] {
        var list = [String(localized: "What's happening with my bids?"), String(localized: "Find me a live show")]
        if session.user?.sellerProfile != nil {
            list.insert(String(localized: "How are my sales doing?"), at: 0)
            list.append(String(localized: "Help me price an item"))
        } else {
            list.append(String(localized: "How do I start selling?"))
        }
        return list
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "sparkle")
                .font(.system(size: 40, weight: .bold))
                .foregroundStyle(MM.Gradient.gold)
                .accessibilityHidden(true)
            Text(greeting)
                .font(MM.Font.display(30, weight: .semibold))
                .foregroundStyle(MM.Color.ink)
                .accessibilityIdentifier("ore-greeting")
            Text("I'm Ore, your chief of staff on MoneyMart.")
                .font(MM.Font.body(15)).foregroundStyle(MM.Color.ink3)
            Spacer()
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(suggestions.enumerated()), id: \.offset) { index, text in
                        Button { Task { await ore.send(text) } } label: {
                            Text(text)
                                .font(MM.Font.body(14, weight: .medium))
                                .foregroundStyle(MM.Color.ink2)
                                .padding(.horizontal, 14).padding(.vertical, 10)
                                .background(MM.Color.raised, in: Capsule())
                                .overlay(Capsule().stroke(MM.Color.border, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("ore-suggestion-\(index)")
                    }
                }
                .padding(.horizontal, MM.Space.screen)
            }
            .padding(.bottom, 10)
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { focused = false }
    }

    // MARK: Conversation

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(ore.messages) { message in OreMessageRow(message: message, president: ore.presidentName).id(message.id) }
                    if ore.sending {
                        HStack(spacing: 10) {
                            Image(systemName: "sparkle").foregroundStyle(MM.Gradient.gold).symbolEffect(.pulse)
                            Text("Ore is working on it…").font(MM.Font.body(14)).foregroundStyle(MM.Color.ink3)
                        }
                        .id("working")
                    }
                }
                .padding(.horizontal, MM.Space.screen)
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .onAppear { proxy.scrollTo(ore.messages.last?.id, anchor: .bottom) }
            .onChange(of: ore.messages.count) { withAnimation { proxy.scrollTo(ore.messages.last?.id, anchor: .bottom) } }
            .onChange(of: ore.sending) { if ore.sending { withAnimation { proxy.scrollTo("working", anchor: .bottom) } } }
        }
    }

    // MARK: Composer

    private var hasContent: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !ore.pending.isEmpty }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let notice = ore.notice {
                Text(notice).font(MM.Font.body(12, weight: .semibold)).foregroundStyle(MM.Color.errorText)
            }
            if !ore.pending.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) { ForEach(ore.pending) { pendingChip($0) } }
                }
            }
            TextField(dictation.listening ? "Listening…" : "Chat with Ore", text: $draft, axis: .vertical)
                .lineLimit(1...6)
                .focused($focused)
                .font(MM.Font.body(17))
                .foregroundStyle(MM.Color.ink)
                .tint(MM.Color.gold)
                .accessibilityIdentifier("ore-input")
            HStack(spacing: 10) {
                Menu {
                    Button { choosingPhotos = true } label: { Label("Photos", systemImage: "photo.on.rectangle") }
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button { camera = true } label: { Label("Camera", systemImage: "camera") }
                    }
                    Button { importing = true } label: { Label("Files & PDFs", systemImage: "doc") }
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(MM.Color.ink)
                        .frame(width: 40, height: 40)
                        .background(MM.Color.card, in: Circle())
                }
                .accessibilityLabel("Add photos or files")
                .accessibilityIdentifier("ore-attach")
                Text("Chief of staff")
                    .font(MM.Font.body(13, weight: .semibold))
                    .foregroundStyle(MM.Color.gold)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(MM.Color.goldSoft, in: Capsule())
                Spacer()
                Button(action: toggleDictation) {
                    Image(systemName: dictation.listening ? "stop.fill" : "mic")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(dictation.listening ? MM.Color.errorText : MM.Color.ink)
                        .frame(width: 40, height: 40)
                        .background(MM.Color.card, in: Circle())
                }
                .accessibilityLabel(dictation.listening ? "Stop dictation" : "Dictate")
                .accessibilityIdentifier("ore-dictate")
                if hasContent {
                    Button(action: send) {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(MM.Color.navyDeep)
                            .frame(width: 44, height: 44)
                            .background(MM.Gradient.gold, in: Circle())
                    }
                    .disabled(ore.sending)
                    .accessibilityLabel("Send")
                    .accessibilityIdentifier("ore-send")
                } else {
                    Button { dictation.stop(); focused = false; calling = true } label: {
                        Image(systemName: "waveform")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(MM.Color.navyDeep)
                            .frame(width: 44, height: 44)
                            .background(MM.Gradient.gold, in: Circle())
                    }
                    .accessibilityLabel("Call Ore")
                    .accessibilityIdentifier("ore-call")
                }
            }
        }
        .padding(14)
        .background(MM.Color.raised, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(MM.Color.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.35), radius: 18, y: 6)
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private func pendingChip(_ file: OrePendingAttachment) -> some View {
        HStack(spacing: 8) {
            if let preview = file.preview {
                Image(uiImage: preview).resizable().scaledToFill().frame(width: 34, height: 34).clipShape(RoundedRectangle(cornerRadius: 8))
            } else {
                Image(systemName: file.kind == .pdf ? "doc.richtext" : "doc.text").foregroundStyle(MM.Color.gold).frame(width: 34, height: 34)
                    .background(MM.Color.card, in: RoundedRectangle(cornerRadius: 8))
            }
            Text(file.name).font(MM.Font.body(12, weight: .medium)).foregroundStyle(MM.Color.ink2).lineLimit(1).frame(maxWidth: 110, alignment: .leading)
            Button { ore.removePending(file.id) } label: {
                Image(systemName: "xmark.circle.fill").foregroundStyle(MM.Color.ink3)
            }
            .accessibilityLabel("Remove \(file.name)")
        }
        .padding(6)
        .background(MM.Color.card, in: RoundedRectangle(cornerRadius: 12))
        .accessibilityIdentifier("ore-pending")
    }

    private func send() {
        guard hasContent, !ore.sending else { return }
        dictation.stop()
        let text = draft
        draft = ""
        Task { await ore.send(text) }
    }

    private func toggleDictation() {
        if dictation.listening { dictation.stop(); return }
        Task {
            guard await SpeechListener.authorize() else {
                ore.notice = String(localized: "Allow microphone and speech recognition in Settings to dictate.")
                return
            }
            dictationBase = draft.isEmpty ? "" : draft + " "
            do {
                try dictation.start()
            } catch {
                ore.notice = error.localizedDescription
            }
        }
    }
}

/// One message: the member's in a bubble on the right, Ore's as open text with her mark.
struct OreMessageRow: View {
    let message: OreMessage
    let president: String

    var body: some View {
        if message.role == .member {
            VStack(alignment: .trailing, spacing: 6) {
                if !message.attachments.isEmpty {
                    HStack(spacing: 6) { ForEach(Array(message.attachments.enumerated()), id: \.offset) { _, file in attachment(file) } }
                }
                if !message.text.isEmpty {
                    Text(message.text)
                        .font(MM.Font.body(16))
                        .foregroundStyle(MM.Color.ink)
                        .padding(.horizontal, 15).padding(.vertical, 11)
                        .background(MM.Color.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .textSelection(.enabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.leading, 48)
            .accessibilityIdentifier("ore-message-member")
        } else {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "sparkle")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(MM.Gradient.gold)
                    .padding(.top, 3)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 8) {
                    Text(Self.markdown(message.text))
                        .font(MM.Font.body(16))
                        .foregroundStyle(message.failed ? MM.Color.errorText : MM.Color.ink)
                        .tint(MM.Color.gold)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    ForEach(message.reported, id: \.self) { title in
                        Label("Sent to President \(president): \(title)", systemImage: "arrow.up.forward.circle.fill")
                            .font(MM.Font.body(12, weight: .semibold))
                            .foregroundStyle(MM.Color.green)
                    }
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("ore-message-ore")
        }
    }

    private func attachment(_ file: OreMessage.Attachment) -> some View {
        Group {
            if let data = file.thumbnail, let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFill().frame(width: 74, height: 74)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            } else {
                VStack(spacing: 4) {
                    Image(systemName: file.kind == .pdf ? "doc.richtext" : "doc.text").font(.system(size: 20)).foregroundStyle(MM.Color.gold)
                    Text(file.name).font(MM.Font.body(10)).foregroundStyle(MM.Color.ink3).lineLimit(1)
                }
                .frame(width: 74, height: 74)
                .background(MM.Color.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
        .accessibilityLabel(file.name)
    }

    static func markdown(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
    }
}

/// The side drawer: new chat and this account's recent chats.
struct OreDrawer: View {
    @Environment(OreStore.self) private var ore
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "sparkles").font(.system(size: 18, weight: .bold)).foregroundStyle(MM.Gradient.gold)
                Text("Ore").font(MM.Font.display(26)).foregroundStyle(MM.Color.ink)
            }
            .padding(.top, 18).padding(.bottom, 18)

            Button { ore.newChat(); close() } label: {
                Label("New chat", systemImage: "square.and.pencil")
                    .font(MM.Font.body(16, weight: .semibold))
                    .foregroundStyle(MM.Color.navyDeep)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(MM.Gradient.gold, in: Capsule())
            }
            .accessibilityIdentifier("ore-drawer-new")

            Text("Recents").font(MM.Font.body(13, weight: .semibold)).foregroundStyle(MM.Color.ink3).padding(.top, 22).padding(.bottom, 6)
            if ore.conversations.isEmpty {
                Text("Your chats with Ore appear here. They stay on this iPhone.")
                    .font(MM.Font.body(14)).foregroundStyle(MM.Color.ink3)
            }
            List {
                ForEach(ore.conversations) { conversation in
                    Button { ore.open(conversation.id); close() } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(conversation.title).font(MM.Font.body(15, weight: conversation.id == ore.currentID ? .semibold : .regular))
                                .foregroundStyle(conversation.id == ore.currentID ? MM.Color.gold : MM.Color.ink).lineLimit(1)
                            Text(conversation.updatedAt, format: .relative(presentation: .named))
                                .font(MM.Font.body(12)).foregroundStyle(MM.Color.ink3)
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
                    .swipeActions { Button("Delete", role: .destructive) { ore.delete(conversation.id) } }
                    .accessibilityIdentifier("ore-recent")
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
        .padding(.horizontal, 18)
        .frame(width: 310)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(MM.Color.raised.ignoresSafeArea())
        .overlay(alignment: .trailing) { Rectangle().fill(MM.Color.border).frame(width: 1).ignoresSafeArea() }
    }
}
