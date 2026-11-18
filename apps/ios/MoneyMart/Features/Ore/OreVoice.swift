import SwiftUI
import AVFoundation
import Speech

/// On-device speech to text, for dictating to Ore and for calls.
/// Stops by itself after a pause when `silence` is set, and hands back what was said.
@MainActor
@Observable
final class SpeechListener {
    private(set) var transcript = ""
    private(set) var listening = false
    private(set) var level: Float = 0

    @ObservationIgnored private let engine = AVAudioEngine()
    @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored private var task: SFSpeechRecognitionTask?
    @ObservationIgnored private var silenceTimer: Task<Void, Never>?
    @ObservationIgnored private var onPause: ((String) -> Void)?
    @ObservationIgnored private var silence: TimeInterval?

    /// Asks for speech and microphone access. False when either is refused.
    static func authorize() async -> Bool {
        let speech = await withCheckedContinuation { (done: CheckedContinuation<Bool, Never>) in
            SFSpeechRecognizer.requestAuthorization { done.resume(returning: $0 == .authorized) }
        }
        guard speech else { return false }
        return await AVAudioApplication.requestRecordPermission()
    }

    func start(silence: TimeInterval? = nil, onPause: ((String) -> Void)? = nil) throws {
        stop()
        let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
        guard let recognizer, recognizer.isAvailable else { throw OreVoiceError.unavailable }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        self.request = request
        self.silence = silence
        self.onPause = onPause
        transcript = ""

        let input = engine.inputNode
        Self.installTap(on: input, request: request) { [weak self] value in
            Task { @MainActor in self?.level = value }
        }
        engine.prepare()
        try engine.start()
        listening = true
        task = Self.recognize(recognizer, request) { [weak self] text, final in
            Task { @MainActor in self?.heard(text, final: final) }
        }
    }

    func stop() {
        silenceTimer?.cancel()
        silenceTimer = nil
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        listening = false
        level = 0
    }

    private func heard(_ text: String?, final: Bool) {
        guard listening else { return }
        if let text, !text.isEmpty { transcript = text }
        guard let silence else { return }
        silenceTimer?.cancel()
        if final { finishPause(); return }
        silenceTimer = Task { [weak self] in
            try? await Task.sleep(for: .seconds(silence))
            guard !Task.isCancelled else { return }
            self?.finishPause()
        }
    }

    private func finishPause() {
        let words = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else { return }
        let callback = onPause
        stop()
        callback?(words)
    }

    // Audio and recognition callbacks arrive off the main thread, so they are built outside the main actor.
    nonisolated private static func installTap(on input: AVAudioInputNode, request: SFSpeechAudioBufferRecognitionRequest, level: @escaping @Sendable (Float) -> Void) {
        let format = input.outputFormat(forBus: 0)
        nonisolated(unsafe) let request = request
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
            guard let samples = buffer.floatChannelData?[0] else { return }
            let count = Int(buffer.frameLength)
            guard count > 0 else { return }
            var sum: Float = 0
            for index in 0..<count { sum += samples[index] * samples[index] }
            level(min(1, sqrt(sum / Float(count)) * 12))
        }
    }

    nonisolated private static func recognize(_ recognizer: SFSpeechRecognizer, _ request: SFSpeechAudioBufferRecognitionRequest,
                                              _ result: @escaping @Sendable (String?, Bool) -> Void) -> SFSpeechRecognitionTask {
        recognizer.recognitionTask(with: request) { value, error in
            result(value?.bestTranscription.formattedString, value?.isFinal ?? (error != nil))
        }
    }
}

enum OreVoiceError: LocalizedError {
    case unavailable
    var errorDescription: String? { String(localized: "Speech recognition isn't available right now.") }
}

/// Plays Ore's replies: her server voice (Cartesia, then ElevenLabs), else the phone's own voice.
@MainActor
final class OreSpeaker {
    private var player: AVAudioPlayer?
    private let synthesizer = AVSpeechSynthesizer()

    var speaking: Bool { (player?.isPlaying ?? false) || synthesizer.isSpeaking }

    func say(_ text: String, useServer: Bool) async {
        stop()
        if useServer, let data = await APIClient.shared.oreSpeech(text), let player = try? AVAudioPlayer(data: data) {
            self.player = player
            player.play()
            while player.isPlaying, !Task.isCancelled { try? await Task.sleep(for: .milliseconds(120)) }
            return
        }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: Locale.current.identifier) ?? AVSpeechSynthesisVoice(language: "en-US")
        synthesizer.speak(utterance)
        try? await Task.sleep(for: .milliseconds(250))
        while synthesizer.isSpeaking, !Task.isCancelled { try? await Task.sleep(for: .milliseconds(120)) }
    }

    func stop() {
        player?.stop()
        player = nil
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
    }
}

/// A voice call with Ore: listen → think → speak, until the member hangs up.
@MainActor
@Observable
final class OreCall {
    enum Phase: Equatable { case connecting, listening, thinking, speaking, muted, ended, failed(String) }

    private(set) var phase: Phase = .connecting
    private(set) var lastHeard = ""
    private(set) var lastReply = ""
    let listener = SpeechListener()

    @ObservationIgnored private let speaker = OreSpeaker()
    @ObservationIgnored private var loop: Task<Void, Never>?
    @ObservationIgnored private weak var store: OreStore?

    func start(store: OreStore, greeting: String) {
        self.store = store
        loop = Task {
            guard await SpeechListener.authorize() else {
                phase = .failed(String(localized: "Allow microphone and speech recognition in Settings to call Ore."))
                return
            }
            phase = .speaking
            lastReply = greeting
            await speaker.say(greeting, useServer: store.serverVoice)
            listen()
        }
    }

    func toggleMute() {
        if phase == .muted { listen() } else if phase == .listening { listener.stop(); phase = .muted }
    }

    /// Tapping the orb while Ore speaks cuts her off so the member can talk.
    func interrupt() {
        guard phase == .speaking else { return }
        speaker.stop()
        loop?.cancel()
        listen()
    }

    func end() {
        loop?.cancel()
        listener.stop()
        speaker.stop()
        phase = .ended
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
    }

    private func listen() {
        guard phase != .ended else { return }
        do {
            try listener.start(silence: 1.3) { [weak self] words in self?.think(words) }
            phase = .listening
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func think(_ words: String) {
        guard let store, phase != .ended else { return }
        lastHeard = words
        phase = .thinking
        loop = Task {
            let reply = await store.send(words, voice: true) ?? String(localized: "Sorry, I missed that.")
            guard !Task.isCancelled, phase != .ended else { return }
            lastReply = reply
            phase = .speaking
            await speaker.say(reply, useServer: store.serverVoice)
            guard !Task.isCancelled, phase != .ended else { return }
            listen()
        }
    }
}

struct OreCallView: View {
    @Environment(OreStore.self) private var ore
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var call = OreCall()
    @State private var spin = false

    private var status: LocalizedStringKey {
        switch call.phase {
        case .connecting: "Connecting…"
        case .listening: "Listening"
        case .thinking: "Thinking…"
        case .speaking: "Ore is speaking — tap to interrupt"
        case .muted: "Muted"
        case .ended: "Call ended"
        case .failed: "Can't start the call"
        }
    }

    var body: some View {
        VStack(spacing: 28) {
            HStack {
                Text("Ore").font(MM.Font.display(20)).foregroundStyle(MM.Color.ink)
                Spacer()
                Text("Voice").font(MM.Font.body(13, weight: .semibold)).foregroundStyle(MM.Color.ink3)
            }
            Spacer()
            orb.onTapGesture { call.interrupt() }
                .accessibilityLabel(Text(status))
                .accessibilityIdentifier("ore-call-orb")
            Text(status).font(MM.Font.body(16, weight: .semibold)).foregroundStyle(MM.Color.ink2)
                .accessibilityIdentifier("ore-call-status")
            if case .failed(let reason) = call.phase {
                Text(reason).font(MM.Font.body(14)).foregroundStyle(MM.Color.errorText).multilineTextAlignment(.center)
            } else {
                VStack(spacing: 10) {
                    if call.phase == .listening, !call.listener.transcript.isEmpty {
                        Text(call.listener.transcript).foregroundStyle(MM.Color.ink)
                    } else if !call.lastReply.isEmpty {
                        Text(call.lastReply).foregroundStyle(MM.Color.ink2)
                    }
                }
                .font(MM.Font.body(16))
                .multilineTextAlignment(.center)
                .lineLimit(5)
                .frame(minHeight: 90)
            }
            Spacer()
            HStack(spacing: 44) {
                Button { call.toggleMute() } label: {
                    Image(systemName: call.phase == .muted ? "mic.slash.fill" : "mic.fill")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(MM.Color.ink)
                        .frame(width: 66, height: 66)
                        .background(MM.Color.raised, in: Circle())
                        .overlay(Circle().stroke(MM.Color.border, lineWidth: 1))
                }
                .accessibilityLabel(call.phase == .muted ? "Unmute" : "Mute")
                .accessibilityIdentifier("ore-call-mute")
                Button { call.end(); dismiss() } label: {
                    Image(systemName: "phone.down.fill")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 76, height: 76)
                        .background(MM.Color.error, in: Circle())
                }
                .accessibilityLabel("End call")
                .accessibilityIdentifier("ore-call-end")
            }
            .padding(.bottom, 12)
        }
        .padding(24)
        .background(MM.Gradient.navy.ignoresSafeArea())
        .onAppear {
            let first = session.user?.displayName.split(separator: " ").first.map(String.init) ?? ""
            call.start(store: ore, greeting: first.isEmpty ? String(localized: "Hi, it's Ore. What can I do for you?") : String(localized: "Hi \(first), it's Ore. What can I do for you?"))
            withAnimation(.linear(duration: 6).repeatForever(autoreverses: false)) { spin = true }
        }
        .onDisappear { call.end() }
    }

    private var orb: some View {
        let level = CGFloat(call.listener.level)
        let pulse: CGFloat = call.phase == .speaking ? 1.08 : call.phase == .listening ? 1 + level * 0.25 : 1
        return ZStack {
            Circle().fill(MM.Color.goldSoft).frame(width: 260, height: 260).scaleEffect(pulse * 1.05)
            Circle()
                .fill(AngularGradient(colors: [MM.Color.gold, MM.Color.goldBright, MM.Color.goldDeep, MM.Color.gold], center: .center))
                .frame(width: 190, height: 190)
                .rotationEffect(.degrees(spin ? 360 : 0))
                .blur(radius: call.phase == .thinking ? 6 : 0)
                .scaleEffect(pulse)
            Image(systemName: "sparkles").font(.system(size: 44, weight: .bold)).foregroundStyle(MM.Color.navyDeep)
        }
        .animation(.easeOut(duration: 0.18), value: level)
        .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: call.phase == .speaking)
    }
}
