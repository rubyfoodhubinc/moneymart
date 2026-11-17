import Foundation

struct APIError: LocalizedError, Sendable, Equatable {
    var status: Int
    var code: String?
    var message: String

    var errorDescription: String? { message }

    static func readable(_ code: String?) -> String? {
        switch code {
        case "not_authenticated": return String(localized: "Please sign in to continue.")
        case "auction_not_live": return String(localized: "This lot is not open for bidding.")
        case "auction_ended": return String(localized: "This auction has ended.")
        case "below_minimum_increment": return String(localized: "Your bid is below the minimum increment.")
        case "already_winning": return String(localized: "You are already the highest bidder.")
        case "self_bid": return String(localized: "You cannot bid on your own lot.")
        case "rate_limited": return String(localized: "Too many attempts. Please wait a moment.")
        case "invalid_images": return String(localized: "One of the photos could not be accepted.")
        case "title_and_starting_price_required": return String(localized: "A title and starting price are required.")
        case "seller_profile_required": return String(localized: "Finish seller setup before scheduling a show.")
        case "listing_in_other_show": return String(localized: "That item is already in another show.")
        case "live_video_unavailable": return String(localized: "Live video is unavailable right now. Try again, or switch to the backup.")
        case "not_live": return String(localized: "This show is not broadcasting right now.")
        default: return nil
        }
    }
}

/// The single REST client. Same contract as the web and Expo clients, so a bid
/// placed from the native app is indistinguishable to the Auction Engine.
actor APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private var token: String?
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(session: URLSession? = nil) {
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 20
            config.waitsForConnectivity = false
            config.httpAdditionalHeaders = ["Accept": "application/json", "X-MoneyMart-Client": "ios-native"]
            self.session = URLSession(configuration: config)
        }
        self.token = TokenStore.load()
    }

    func setToken(_ token: String?) {
        self.token = token
        if let token { TokenStore.save(token) } else { TokenStore.clear() }
    }

    func currentToken() -> String? { token }

    // MARK: Core

    func get<T: Decodable & Sendable>(_ path: String, query: [String: String?] = [:]) async throws -> T {
        try await send(path, method: "GET", query: query, body: Optional<Data>.none)
    }

    func post<T: Decodable & Sendable, B: Encodable & Sendable>(_ path: String, body: B) async throws -> T {
        try await send(path, method: "POST", body: try encoder.encode(body))
    }

    func post<T: Decodable & Sendable>(_ path: String) async throws -> T {
        try await send(path, method: "POST", body: Data("{}".utf8))
    }

    func patch<T: Decodable & Sendable, B: Encodable & Sendable>(_ path: String, body: B) async throws -> T {
        try await send(path, method: "PATCH", body: try encoder.encode(body))
    }

    func put<T: Decodable & Sendable, B: Encodable & Sendable>(_ path: String, body: B) async throws -> T {
        try await send(path, method: "PUT", body: try encoder.encode(body))
    }

    func delete<T: Decodable & Sendable>(_ path: String) async throws -> T {
        try await send(path, method: "DELETE", body: nil)
    }

    private func send<T: Decodable & Sendable>(_ path: String, method: String, query: [String: String?] = [:], body: Data?) async throws -> T {
        var components = URLComponents(url: AppConfig.apiBaseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        let items = query.compactMap { key, value in value.flatMap { $0.isEmpty ? nil : URLQueryItem(name: key, value: $0) } }
        if !items.isEmpty { components.queryItems = items.sorted { $0.name < $1.name } }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.httpBody = body

        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw Self.makeError(status: status, data: data)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError(status: status, code: "decode_failed", message: String(localized: "Unexpected response from MoneyMart."))
        }
    }

    static func makeError(status: Int, data: Data) -> APIError {
        struct Body: Decodable { var error: String?; var reason: String?; var message: String?; var detail: String? }
        let body = try? JSONDecoder().decode(Body.self, from: data)
        let code = body?.reason ?? body?.error
        let message = body?.message ?? APIError.readable(code) ?? body?.detail ?? body?.error ?? String(localized: "Request failed (\(status)).")
        return APIError(status: status, code: code, message: message)
    }
}

// MARK: - Endpoints

struct EmptyBody: Encodable, Sendable {}

extension APIClient {
    func health() async throws -> HealthResponse { try await get("/api/health") }

    func requestCode(identifier: String) async throws -> RequestCodeResponse {
        struct B: Encodable, Sendable { let identifier: String }
        return try await post("/api/auth/request", body: B(identifier: identifier))
    }

    func verifyCode(identifier: String, code: String) async throws -> VerifyCodeResponse {
        struct B: Encodable, Sendable { let identifier: String; let code: String }
        return try await post("/api/auth/verify", body: B(identifier: identifier, code: code))
    }

    func authSession() async throws -> SessionResponse { try await get("/api/auth/session") }

    func signOut() async throws -> OkResponse { try await post("/api/auth/signout") }

    struct ProfilePatch: Encodable, Sendable {
        var displayName: String?
        var bio: String?
        var countryCode: String?
        var currencyCode: String?
        var preferences: UserPreferences?
    }

    func updateMe(_ patch: ProfilePatch) async throws -> SessionResponse { try await self.patch("/api/me", body: patch) }

    /// Server filters: `status` ∈ live | scheduled | sold | ending; `sort`; `limit`.
    func auctions(status: String? = nil, category: String? = nil, type: String? = nil, query: String? = nil, sort: String? = nil, limit: Int = 60) async throws -> Paginated<Auction> {
        try await get("/api/auctions", query: ["status": status, "category": category, "type": type, "q": query,
                                              "sort": sort, "limit": String(limit)])
    }

    func auction(id: String) async throws -> AuctionDetailResponse { try await get("/api/auctions/\(id)") }

    func placeBid(auctionId: String, amount: Double) async throws -> PlaceBidResponse {
        struct B: Encodable, Sendable { let amount: Double }
        return try await post("/api/auctions/\(auctionId)/bids", body: B(amount: amount))
    }

    func setAutoBid(auctionId: String, maxAmount: Double, increment: Double, aggressive: Bool) async throws -> OkResponse {
        struct B: Encodable, Sendable { let maxAmount: Double; let increment: Double; let aggressive: Bool }
        return try await post("/api/auctions/\(auctionId)/auto-bid", body: B(maxAmount: maxAmount, increment: increment, aggressive: aggressive))
    }

    func cancelAutoBid(auctionId: String) async throws -> OkResponse { try await post("/api/auctions/\(auctionId)/auto-bid/off") }

    struct NewListing: Encodable, Sendable {
        var title: String
        var description: String
        var categoryId: String
        var subcategoryId: String?
        var condition: String
        var auctionType: String
        var startingPrice: Double
        var reservePrice: Double?
        var buyItNowPrice: Double?
        var durationDays: Int
        var images: [String]
    }

    func createListing(_ listing: NewListing) async throws -> CreateListingResponse { try await post("/api/auctions", body: listing) }

    /// The caller's own listings, used to fill a show.
    func myListings(limit: Int = 200) async throws -> Paginated<Auction> {
        try await get("/api/auctions", query: ["seller": "me", "limit": String(limit)])
    }

    // MARK: Categories

    func categories() async throws -> CategoriesResponse { try await get("/api/categories") }

    func requestCategory(name: String, parentId: String?, note: String?) async throws -> OkOrCreated {
        struct B: Encodable, Sendable { let name: String; let parentId: String?; let note: String? }
        return try await post("/api/categories/requests", body: B(name: name, parentId: parentId, note: note))
    }

    // MARK: Seller setup

    struct SellerProfileInput: Encodable, Sendable {
        var entity: String
        var businessType: String?
        var mainCategory: String
        var subcategories: [String]
        var channels: [String]
        var socials: [String: String]
        var monthlyRevenue: String?
        var inventorySize: String?
        var teamSize: String?
        var weeklyLiveHours: String?
        var returnAddress: PostalAddress
    }

    func saveSellerProfile(_ input: SellerProfileInput) async throws -> SellerProfileResponse {
        try await put("/api/me/seller-profile", body: input)
    }

    // MARK: Shows

    struct ShowInput: Encodable, Sendable {
        var title: String?
        var categoryId: String?
        var subcategoryId: String?
        var scheduledStartTime: String?
        var description: String?
        var format: String?
        var visibility: String?
        var language: String?
        var posterUrl: String?
        /// Handles of trusted chat moderators.
        var moderators: [String]?
        var mutedWords: [String]?
        var explicit: Bool?
        var shipping: ShowShipping?
    }

    /// Schedules several shows from one template; all-or-nothing on the server.
    func createStreams(_ show: ShowInput, startTimes: [String]) async throws -> StreamBatchResponse {
        struct B: Encodable, Sendable { let show: ShowInput; let startTimes: [String] }
        return try await post("/api/streams/batch", body: B(show: show, startTimes: startTimes))
    }

    /// Opens (or reuses) the show's live room and returns the host's broadcast pass.
    /// `useBackup` moves the show to the other video provider.
    func goLive(streamId: String, useBackup: Bool = false) async throws -> GoLiveResponse {
        struct B: Encodable, Sendable { let useBackup: Bool }
        return try await post("/api/streams/\(streamId)/go-live", body: B(useBackup: useBackup))
    }

    func watch(streamId: String) async throws -> WatchResponse { try await get("/api/streams/\(streamId)/watch") }

    /// Puts a queued item on screen (starts its countdown).
    func runItem(streamId: String, auctionId: String) async throws -> StreamActionResponse {
        try await post("/api/streams/\(streamId)/items/\(auctionId)/activate", body: EmptyBody())
    }

    func endStream(id: String) async throws -> StreamActionResponse { try await post("/api/streams/\(id)/end", body: EmptyBody()) }

    func setReminder(streamId: String, on: Bool) async throws -> ReminderResponse {
        struct B: Encodable, Sendable { let on: Bool }
        return try await post("/api/streams/\(streamId)/remind", body: B(on: on))
    }

    func myStreams() async throws -> MyStreamsResponse { try await get("/api/me/streams") }
    func createStream(_ input: ShowInput) async throws -> StreamResponse { try await post("/api/streams", body: input) }
    func updateStream(id: String, _ input: ShowInput) async throws -> StreamResponse { try await patch("/api/streams/\(id)", body: input) }
    func cancelStream(id: String) async throws -> StreamResponse { try await delete("/api/streams/\(id)") }

    func addToShow(streamId: String, auctionId: String) async throws -> StreamResponse {
        struct B: Encodable, Sendable { let auctionId: String }
        return try await post("/api/streams/\(streamId)/items", body: B(auctionId: auctionId))
    }

    func removeFromShow(streamId: String, auctionId: String) async throws -> StreamResponse {
        try await delete("/api/streams/\(streamId)/items/\(auctionId)")
    }

    func streams(status: String? = nil) async throws -> ListResponse<LiveStream> { try await get("/api/streams", query: ["status": status]) }
    func stream(id: String) async throws -> StreamDetailResponse { try await get("/api/streams/\(id)") }

    func notifications() async throws -> NotificationsResponse { try await get("/api/notifications") }
    func markAllRead() async throws -> OkResponse { try await post("/api/notifications/read", body: EmptyBody()) }

    func orders() async throws -> OrdersResponse { try await get("/api/orders") }
    func wallet() async throws -> WalletResponse { try await get("/api/wallet") }
}

/// A create endpoint answers 201 with a body the client does not need.
struct OkOrCreated: Decodable, Sendable {}
