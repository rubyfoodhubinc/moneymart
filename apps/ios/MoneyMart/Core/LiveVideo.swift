import AVFoundation
import AmazonIVSBroadcast
import SwiftUI
import WebKit

/// Live video for hosts (broadcast) and viewers (watch), over either provider the
/// server picked: Amazon IVS Real-Time (native SDK) or Cloudflare Stream (WebRTC
/// WHIP/WHEP in a web view, using the system's own WebRTC so the app ships only
/// one native video engine). Screens talk to `LiveVideoSession` and never to a
/// provider directly.
@MainActor
@Observable
final class LiveVideoSession {
    enum Role { case host, viewer }

    enum State: Equatable {
        case idle, connecting, live, failed(String), ended
    }

    let role: Role
    private(set) var state: State = .idle
    private(set) var provider: String?
    /// The view to show: the host's camera preview or the host's video for viewers.
    private(set) var videoView: UIView?
    private(set) var micMuted = false

    @ObservationIgnored private var ivs: IVSStageEngine?
    @ObservationIgnored private var cloudflare: CloudflareEngine?

    init(role: Role) { self.role = role }

    var isLive: Bool { state == .live }

    /// Host: start broadcasting with the credentials from `go-live`.
    func startBroadcast(_ credentials: BroadcastCredentials) async {
        stop(endState: .idle)
        provider = credentials.provider
        state = .connecting
        guard await Self.requestCaptureAccess() else {
            state = .failed(String(localized: "Allow camera and microphone access in Settings to go live."))
            return
        }
        if let ivs = credentials.ivs {
            let engine = IVSStageEngine(publish: true) { [weak self] change in self?.apply(change) }
            self.ivs = engine
            engine.start(token: ivs.token)
        } else if let cloudflare = credentials.cloudflare, let url = URL(string: cloudflare.whipUrl) {
            let engine = CloudflareEngine { [weak self] change in self?.apply(change) }
            self.cloudflare = engine
            videoView = engine.webView
            engine.publish(to: url)
        } else {
            state = .failed(String(localized: "The server did not return a broadcast address."))
        }
    }

    /// Viewer: join the show's video.
    func startWatching(_ viewer: WatchResponse.Viewer) {
        stop(endState: .idle)
        provider = viewer.provider
        state = .connecting
        if let ivs = viewer.ivs {
            let engine = IVSStageEngine(publish: false) { [weak self] change in self?.apply(change) }
            self.ivs = engine
            engine.start(token: ivs.token)
        } else if let cloudflare = viewer.cloudflare, let url = URL(string: cloudflare.whepUrl) {
            let engine = CloudflareEngine { [weak self] change in self?.apply(change) }
            self.cloudflare = engine
            videoView = engine.webView
            engine.play(from: url)
        } else {
            state = .failed(String(localized: "This show has no video yet."))
        }
    }

    func flipCamera() {
        ivs?.flipCamera()
        cloudflare?.flipCamera()
    }

    func toggleMicrophone() {
        micMuted.toggle()
        ivs?.setMicrophoneMuted(micMuted)
        cloudflare?.setMicrophoneMuted(micMuted)
    }

    func stop(endState: State = .ended) {
        ivs?.stop()
        cloudflare?.stop()
        ivs = nil
        cloudflare = nil
        videoView = nil
        state = endState
    }

    fileprivate enum Change {
        case connecting, live, failed(String), video(UIView?)
    }

    private func apply(_ change: Change) {
        switch change {
        case .connecting: state = .connecting
        case .live: state = .live
        case .failed(let message): state = .failed(message)
        case .video(let view): videoView = view
        }
    }

    private static func requestCaptureAccess() async -> Bool {
        let video = await AVCaptureDevice.requestAccess(for: .video)
        let audio = await AVCaptureDevice.requestAccess(for: .audio)
        return video && audio
    }
}

/// SwiftUI host for whichever UIView the session is showing.
struct LiveVideoSurface: UIViewRepresentable {
    let view: UIView?

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .black
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        guard container.subviews.first !== view else { return }
        container.subviews.forEach { $0.removeFromSuperview() }
        guard let view else { return }
        view.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(view)
        NSLayoutConstraint.activate([
            view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            view.topAnchor.constraint(equalTo: container.topAnchor),
            view.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
    }
}

// MARK: - Amazon IVS Real-Time

/// One IVS stage. Hosts publish the front camera and microphone; viewers subscribe
/// to whoever is publishing (the host).
@MainActor
private final class IVSStageEngine {
    private let publish: Bool
    private let report: (LiveVideoSession.Change) -> Void
    private var stage: IVSStage?
    private var strategy: StageStrategy?
    private var renderer: StageRenderer?
    private var camera: IVSCamera?
    private var microphone: IVSLocalStageStream?

    init(publish: Bool, report: @escaping (LiveVideoSession.Change) -> Void) {
        self.publish = publish
        self.report = report
    }

    func start(token: String) {
        var streams: [IVSLocalStageStream] = []
        if publish {
            IVSStageAudioManager.sharedInstance().setPreset(.videoChat)
            let devices = IVSDeviceDiscovery().listLocalDevices()
            let cameras = devices.compactMap { $0 as? IVSCamera }
            guard let camera = cameras.first(where: { $0.descriptor().position == .front }) ?? cameras.first else {
                report(.failed(String(localized: "No camera is available on this device.")))
                return
            }
            self.camera = camera
            streams.append(IVSLocalStageStream(device: camera))
            if let mic = devices.first(where: { $0.descriptor().type == .microphone }) {
                let stream = IVSLocalStageStream(device: mic)
                microphone = stream
                streams.append(stream)
            }
            if let preview = try? camera.previewView(with: .fill) {
                preview.setMirrored(true)
                report(.video(preview))
            }
        } else {
            IVSStageAudioManager.sharedInstance().setPreset(.subscribeOnly)
        }

        let strategy = StageStrategy(publish: publish, streams: streams)
        let renderer = StageRenderer { [weak self] event in
            Task { @MainActor in self?.handle(event) }
        }
        do {
            let stage = try IVSStage(token: token, strategy: strategy)
            stage.addRenderer(renderer)
            try stage.join()
            self.stage = stage
            self.strategy = strategy
            self.renderer = renderer
            report(.connecting)
        } catch {
            report(.failed(error.localizedDescription))
        }
    }

    private func handle(_ event: StageRenderer.Event) {
        switch event {
        case .connected:
            // A host is live once connected; a viewer once the host's video arrives.
            if publish { report(.live) }
        case .disconnected(let message):
            if let message { report(.failed(message)) } else { report(.connecting) }
        case .remoteVideo(let device):
            guard !publish else { return }
            if let view = try? device.previewView(with: .fill) {
                report(.video(view))
                report(.live)
            }
        case .remoteGone:
            if !publish {
                report(.video(nil))
                report(.connecting)
            }
        }
    }

    func flipCamera() {
        guard let camera else { return }
        let current = camera.descriptor().position
        let target = camera.listAvailableInputSources().first { $0.position != current && ($0.position == .front || $0.position == .back) }
        guard let target else { return }
        camera.setPreferredInputSource(target) { _ in }
    }

    func setMicrophoneMuted(_ muted: Bool) { microphone?.setMuted(muted) }

    func stop() {
        stage?.leave()
        stage = nil
        strategy = nil
        renderer = nil
        camera = nil
        microphone = nil
    }
}

/// Immutable publish/subscribe rules; the SDK may consult it off the main thread.
private final class StageStrategy: NSObject, IVSStageStrategy, @unchecked Sendable {
    private let publish: Bool
    private let streams: [IVSLocalStageStream]

    init(publish: Bool, streams: [IVSLocalStageStream]) {
        self.publish = publish
        self.streams = streams
    }

    func stage(_ stage: IVSStage, streamsToPublishForParticipant participant: IVSParticipantInfo) -> [IVSLocalStageStream] {
        publish ? streams : []
    }

    func stage(_ stage: IVSStage, shouldPublishParticipant participant: IVSParticipantInfo) -> Bool { publish }

    func stage(_ stage: IVSStage, shouldSubscribeToParticipant participant: IVSParticipantInfo) -> IVSStageSubscribeType {
        // The host does not need to watch anyone; viewers watch the host.
        publish ? .none : .audioVideo
    }
}

/// Forwards SDK callbacks as simple events; never touches UI itself.
private final class StageRenderer: NSObject, IVSStageRenderer, @unchecked Sendable {
    /// Carries an SDK device object across to the main actor; the device is only
    /// used there, after the hop.
    enum Event: @unchecked Sendable {
        case connected
        case disconnected(String?)
        case remoteVideo(IVSImageDevice)
        case remoteGone
    }

    private let send: @Sendable (Event) -> Void

    init(send: @escaping @Sendable (Event) -> Void) { self.send = send }

    func stage(_ stage: IVSStage, didChange connectionState: IVSStageConnectionState, withError error: (any Error)?) {
        switch connectionState {
        case .connected: send(.connected)
        case .disconnected: send(.disconnected(error?.localizedDescription))
        default: break
        }
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didAdd streams: [IVSStageStream]) {
        guard !participant.isLocal else { return }
        if let device = streams.lazy.compactMap({ $0.device as? IVSImageDevice }).first {
            send(.remoteVideo(device))
        }
    }

    func stage(_ stage: IVSStage, participantDidLeave participant: IVSParticipantInfo) {
        if !participant.isLocal { send(.remoteGone) }
    }
}

// MARK: - Cloudflare Stream (WebRTC in a web view)

/// Publishes to a WHIP address or plays a WHEP address using the system WebRTC
/// stack inside WKWebView. The page is bundled here; nothing is loaded from the web
/// except the WHIP/WHEP exchange itself.
@MainActor
private final class CloudflareEngine: NSObject, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    let webView: WKWebView
    private let report: (LiveVideoSession.Change) -> Void
    private var pending: String?
    private var loaded = false

    init(report: @escaping (LiveVideoSession.Change) -> Void) {
        self.report = report
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let controller = WKUserContentController()
        config.userContentController = controller
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        controller.add(WeakMessageHandler(self), name: "mm")
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        // Fill the screen edge to edge; the overlays handle the safe areas.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.uiDelegate = self
        webView.navigationDelegate = self
        // An https base URL makes the page a secure context, which WebRTC requires.
        webView.loadHTMLString(Self.page, baseURL: URL(string: "https://live.moneymart.app/"))
    }

    func publish(to url: URL) { run("mm.publish(\(Self.jsString(url.absoluteString)))") }
    func play(from url: URL) { run("mm.play(\(Self.jsString(url.absoluteString)))") }
    func flipCamera() { run("mm.flip()") }
    func setMicrophoneMuted(_ muted: Bool) { run("mm.mute(\(muted))") }

    func stop() {
        webView.evaluateJavaScript("mm.stop()")
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "mm")
    }

    private func run(_ script: String) {
        if loaded { webView.evaluateJavaScript(script) } else { pending = script }
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        MainActor.assumeIsolated {
            loaded = true
            if let pending { webView.evaluateJavaScript(pending); self.pending = nil }
        }
    }

    nonisolated func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        MainActor.assumeIsolated {
            guard let body = message.body as? [String: Any], let state = body["state"] as? String else { return }
            switch state {
            case "connecting": report(.connecting)
            case "live": report(.live)
            case "failed": report(.failed((body["message"] as? String) ?? String(localized: "The live video connection failed.")))
            default: break
            }
        }
    }

    /// The app already asked for camera and microphone; let the page use them without a second prompt.
    nonisolated func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                             initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                             decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) {
        // WebKit calls this on the main thread.
        MainActor.assumeIsolated {
            decisionHandler(origin.host == "live.moneymart.app" ? .grant : .deny)
        }
    }

    private static func jsString(_ value: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [value])) ?? Data("[\"\"]".utf8)
        let array = String(decoding: data, as: UTF8.self)
        return String(array.dropFirst().dropLast())
    }

    private static let page = """
    <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>html,body{margin:0;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;object-fit:cover}</style></head>
    <body><video id="v" autoplay playsinline muted></video><script>
    const v = document.getElementById('v');
    const say = (state, message) => window.webkit.messageHandlers.mm.postMessage({ state, message: message || '' });
    let pc = null, local = null, facing = 'user', resource = null;
    function makePC() {
      pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], bundlePolicy: 'max-bundle' });
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') say('live');
        if (pc.connectionState === 'failed') say('failed', 'The live video connection was lost.');
        if (pc.connectionState === 'disconnected') say('connecting');
      };
      return pc;
    }
    function gathered(pc) {
      return new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve();
        const done = () => { if (pc.iceGatheringState === 'complete') resolve(); };
        pc.addEventListener('icegatheringstatechange', done);
        setTimeout(resolve, 2500);
      });
    }
    async function exchange(url) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await gathered(pc);
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/sdp' }, body: pc.localDescription.sdp });
      if (!r.ok) {
        const detail = (await r.text().catch(() => '')).slice(0, 160);
        const error = new Error('The video service answered ' + r.status + (detail ? ': ' + detail : ''));
        error.status = r.status;
        throw error;
      }
      resource = r.headers.get('location') ? new URL(r.headers.get('location'), url).href : null;
      await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
    }
    async function camera() {
      return navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } });
    }
    window.mm = {
      async publish(url) {
        try {
          say('connecting');
          local = await camera();
          v.srcObject = local; v.muted = true; v.style.transform = facing === 'user' ? 'scaleX(-1)' : 'none';
          makePC();
          local.getTracks().forEach((t) => pc.addTransceiver(t, { direction: 'sendonly', streams: [local] }));
          await exchange(url);
        } catch (e) { say('failed', String(e && e.message || e)); }
      },
      async play(url) {
        say('connecting');
        // A viewer can arrive a moment before the host's video reaches the service
        // (it answers 409 until then), so keep trying quietly for ~20 seconds.
        for (let attempt = 0; attempt < 10; attempt++) {
          try {
            makePC();
            pc.addTransceiver('video', { direction: 'recvonly' });
            pc.addTransceiver('audio', { direction: 'recvonly' });
            const remote = new MediaStream();
            pc.ontrack = (e) => { remote.addTrack(e.track); v.srcObject = remote; v.muted = false; v.play().catch(() => { v.muted = true; v.play(); }); };
            await exchange(url);
            return;
          } catch (e) {
            if (pc) { pc.close(); pc = null; }
            if (e && e.status === 409 && attempt < 9) { await new Promise((r) => setTimeout(r, 2000)); continue; }
            say('failed', e && e.status === 409 ? 'The host has not started their video yet.' : String(e && e.message || e));
            return;
          }
        }
      },
      async flip() {
        if (!local || !pc) return;
        facing = facing === 'user' ? 'environment' : 'user';
        const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
        const track = next.getVideoTracks()[0];
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender) await sender.replaceTrack(track);
        local.getVideoTracks().forEach((t) => { t.stop(); local.removeTrack(t); });
        local.addTrack(track);
        v.style.transform = facing === 'user' ? 'scaleX(-1)' : 'none';
      },
      mute(on) { if (local) local.getAudioTracks().forEach((t) => { t.enabled = !on; }); },
      stop() {
        if (resource) fetch(resource, { method: 'DELETE' }).catch(() => {});
        if (pc) pc.close();
        if (local) local.getTracks().forEach((t) => t.stop());
        pc = null; local = null;
      },
    };
    </script></body></html>
    """
}

/// Breaks the retain cycle WKUserContentController would otherwise create.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: (any WKScriptMessageHandler)?
    init(_ target: any WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
