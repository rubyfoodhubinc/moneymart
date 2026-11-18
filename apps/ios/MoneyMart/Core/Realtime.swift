import Foundation
import Observation

/// One parsed Engine.IO v4 / Socket.IO v4 text frame.
///
/// Only the subset MoneyMart's server uses: the default namespace, JSON events, no
/// binary attachments and no acks.
enum SocketPacket: Equatable {
    case open(pingInterval: Int?)
    case ping
    case pong
    case connected
    case connectError(String)
    case disconnected
    case event(name: String, payload: Data?)
    case unknown(String)

    static func parse(_ text: String) -> SocketPacket {
        guard let first = text.first else { return .unknown(text) }
        switch first {
        case "0":
            let json = Data(text.dropFirst().utf8)
            let object = (try? JSONSerialization.jsonObject(with: json)) as? [String: Any]
            return .open(pingInterval: object?["pingInterval"] as? Int)
        case "2": return .ping
        case "3": return .pong
        case "4":
            let rest = text.dropFirst()
            guard let kind = rest.first else { return .unknown(text) }
            let body = String(rest.dropFirst())
            switch kind {
            case "0": return .connected
            case "1": return .disconnected
            case "4":
                let object = (try? JSONSerialization.jsonObject(with: Data(body.utf8))) as? [String: Any]
                return .connectError(object?["message"] as? String ?? body)
            case "2":
                guard let array = (try? JSONSerialization.jsonObject(with: Data(body.utf8))) as? [Any],
                      let name = array.first as? String else { return .unknown(text) }
                let payload = array.count > 1 ? try? JSONSerialization.data(withJSONObject: array[1], options: [.fragmentsAllowed]) : nil
                return .event(name: name, payload: payload)
            default: return .unknown(text)
            }
        default: return .unknown(text)
        }
    }

    /// Encodes a client event (`42["name",payload]`).
    static func encodeEvent(_ name: String, _ payload: Any) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: [name, payload], options: [.fragmentsAllowed]),
              let text = String(data: data, encoding: .utf8) else { return nil }
        return "42" + text
    }

    /// Namespace connect with handshake auth (`40{"token":...}`).
    static func encodeConnect(token: String?) -> String {
        guard let token, let data = try? JSONSerialization.data(withJSONObject: ["token": token]),
              let text = String(data: data, encoding: .utf8) else { return "40" }
        return "40" + text
    }
}

final class RealtimeSubscription: @unchecked Sendable {
    let id = UUID()
    deinit {
        let id = self.id
        Task { @MainActor in Realtime.shared.removeListener(id) }
    }
}

/// Native Socket.IO client over `URLSessionWebSocketTask` — no third-party code.
///
/// Rooms joined through `join` are remembered and re-joined after every reconnect,
/// so a dropped connection never silently stops a bid feed.
@MainActor
@Observable
final class Realtime {
    static let shared = Realtime()

    enum State: Equatable { case idle, connecting, connected, offline }
    private(set) var state: State = .idle

    @ObservationIgnored private let session = URLSession(configuration: .default)
    @ObservationIgnored private var task: URLSessionWebSocketTask?
    @ObservationIgnored private var token: String?
    @ObservationIgnored private var joins: [String: (event: String, value: String)] = [:]
    @ObservationIgnored private var outbox: [String] = []
    @ObservationIgnored private var listeners: [UUID: (event: String, handler: (Data?) -> Void)] = [:]
    @ObservationIgnored private var attempt = 0
    @ObservationIgnored private var generation = 0

    func connect(token: String?) {
        self.token = token
        open()
    }

    /// Re-handshake after sign-in or sign-out: the server binds identity at connect time.
    func updateToken(_ token: String?) {
        guard token != self.token || state != .connected else { return }
        self.token = token
        open()
    }

    func disconnect() {
        generation += 1
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        state = .idle
    }

    // MARK: Rooms & events

    func join(_ event: String, _ value: String) {
        joins["\(event):\(value)"] = (event, value)
        emit(event, value)
    }

    func leave(join event: String, leave leaveEvent: String, _ value: String) {
        joins.removeValue(forKey: "\(event):\(value)")
        emit(leaveEvent, value)
    }

    func emit(_ event: String, _ payload: Any) {
        guard let frame = SocketPacket.encodeEvent(event, payload) else { return }
        if state == .connected { write(frame) } else { outbox.append(frame) }
    }

    func on<T: Decodable>(_ event: String, as type: T.Type, _ handler: @escaping @MainActor (T) -> Void) -> RealtimeSubscription {
        let subscription = RealtimeSubscription()
        listeners[subscription.id] = (event, { data in
            guard let data, let value = try? JSONDecoder().decode(T.self, from: data) else { return }
            handler(value)
        })
        return subscription
    }

    func removeListener(_ id: UUID) { listeners.removeValue(forKey: id) }

    // MARK: Transport

    private func socketURL() -> URL? {
        guard var components = URLComponents(url: AppConfig.apiBaseURL, resolvingAgainstBaseURL: false) else { return nil }
        components.scheme = components.scheme == "http" ? "ws" : "wss"
        components.path = "/socket.io/"
        components.queryItems = [URLQueryItem(name: "EIO", value: "4"), URLQueryItem(name: "transport", value: "websocket")]
        return components.url
    }

    private func open() {
        generation += 1
        let current = generation
        task?.cancel(with: .goingAway, reason: nil)
        guard let url = socketURL() else { return }
        state = .connecting
        let next = session.webSocketTask(with: url)
        task = next
        next.resume()
        receive(on: next, generation: current)
    }

    private func receive(on socket: URLSessionWebSocketTask, generation current: Int) {
        socket.receive { [weak self] result in
            Task { @MainActor in
                guard let self, current == self.generation else { return }
                switch result {
                case .success(.string(let text)):
                    self.handle(SocketPacket.parse(text))
                    self.receive(on: socket, generation: current)
                case .success:
                    self.receive(on: socket, generation: current)
                case .failure:
                    self.scheduleReconnect(generation: current)
                }
            }
        }
    }

    private func handle(_ packet: SocketPacket) {
        switch packet {
        case .open:
            write(SocketPacket.encodeConnect(token: token))
        case .ping:
            write("3")
        case .connected:
            state = .connected
            attempt = 0
            for join in joins.values {
                if let frame = SocketPacket.encodeEvent(join.event, join.value) { write(frame) }
            }
            let pending = outbox
            outbox.removeAll()
            pending.forEach(write)
        case .connectError(let message):
            // An expired token is refused at handshake; fall back to anonymous so
            // read-only feeds (viewers, bids, chat) keep flowing.
            if message == "invalid_token", token != nil {
                token = nil
                open()
            } else {
                scheduleReconnect(generation: generation)
            }
        case .disconnected:
            scheduleReconnect(generation: generation)
        case .event(let name, let payload):
            for listener in listeners.values where listener.event == name { listener.handler(payload) }
        case .pong, .unknown:
            break
        }
    }

    private func write(_ frame: String) {
        task?.send(.string(frame)) { _ in }
    }

    private func scheduleReconnect(generation current: Int) {
        guard current == generation else { return }
        state = .offline
        attempt += 1
        let delay = min(30.0, pow(2.0, Double(min(attempt, 5))))
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard let self, current == self.generation else { return }
            self.open()
        }
    }
}
