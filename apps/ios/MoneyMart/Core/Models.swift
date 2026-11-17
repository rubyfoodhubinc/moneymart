import Foundation

/// MoneyMart domain model — the native mirror of `packages/types` (blueprint §9.3).
///
/// Every field the server may omit is optional, so a new server field or a
/// missing one never fails a whole page decode.

struct User: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var email: String?
    var phone: String?
    var displayName: String
    var handle: String
    var avatarUrl: String?
    var bio: String?
    var countryCode: String?
    var currencyCode: String?
    var role: String?
    var verificationStatus: String?
    var rating: Double?
    var totalSales: Int?
    var followersCount: Int?
    var followingCount: Int?
    var isPro: Bool?
    var preferences: UserPreferences?
    /// Present once seller setup is finished; private to the account owner.
    var sellerProfile: SellerProfile?
}

struct PostalAddress: Codable, Hashable, Sendable {
    var fullName: String
    var line1: String
    var line2: String?
    var city: String
    var region: String
    var postalCode: String
    var countryCode: String
}

struct SellerProfile: Codable, Hashable, Sendable {
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
    var completedAt: String?
    var updatedAt: String?
}

/// `GET /api/categories` — the taxonomy with live activity, used to sort by popularity.
struct CategoryActivity: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var order: Int?
    var liveViewers: Int?
    var liveShows: Int?
    var listings: Int?
}

struct UserPreferences: Codable, Hashable, Sendable {
    var publicProfile: Bool?
    var bidHistoryPublic: Bool?
    var language: String?
    var notifications: [String: Bool]?
    var interests: [String]?
}

struct PublicProfile: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var displayName: String
    var handle: String
    var avatarUrl: String?
    var bio: String?
    var countryCode: String?
    var rating: Double?
    var totalSales: Int?
    var followersCount: Int?
    var isVerified: Bool?
    var isLive: Bool?
    var responseTimeMinutes: Int?
}

struct Item: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var sellerId: String?
    var title: String
    var description: String?
    var categoryId: String?
    var subcategoryId: String?
    var condition: String?
    var images: [String]
    var provenance: String?
    var conditionReport: String?
    var authenticityStatus: String?
    var isVerified: Bool?
}

enum AuctionType: String, Codable, Sendable, CaseIterable {
    case liveStream = "live_stream"
    case traditional
    case buyNow = "buy_now"
    case makeOffer = "make_offer"
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AuctionType(rawValue: raw) ?? .unknown
    }
}

enum AuctionStatus: String, Codable, Sendable {
    case draft, scheduled, live, ended, sold, cancelled, unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AuctionStatus(rawValue: raw) ?? .unknown
    }

    var isOpen: Bool { self == .live || self == .scheduled }
}

struct Auction: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var itemId: String?
    var sellerId: String?
    var auctionType: AuctionType
    var title: String
    var startingPrice: Double
    var reservePrice: Double?
    var currentBid: Double
    var currentBidderId: String?
    var bidCount: Int
    var buyItNowPrice: Double?
    var startTime: String?
    var endTime: String
    var status: AuctionStatus
    var buyersPremiumRate: Double?
    var currency: String
    var lotNumber: String?
    var streamId: String?
    var hammerPrice: Double?
    var winnerId: String?
    /// Live show item where late bids do not add time.
    var suddenDeath: Bool?
    var watchers: Int?
    var featured: Bool?
    var item: Item?
    var seller: PublicProfile?
    var isLive: Bool?
    var reserveMet: Bool?

    var endDate: Date { ISODate.parse(endTime) ?? .distantPast }
    var startDate: Date? { startTime.flatMap(ISODate.parse) }
    /// The price a buyer sees: the current high bid, or the opening price before any bid.
    var displayPrice: Double { currentBid > 0 ? currentBid : startingPrice }
    var coverImage: String? { item?.images.first }
    var categoryId: String { item?.categoryId ?? "collectibles" }
}

struct Bid: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var auctionId: String
    var bidderId: String
    var bidderHandle: String
    var amount: Double
    var currency: String
    var timestamp: String
    var isAutoBid: Bool?
    var status: String?
}

struct PlaybackInfo: Codable, Hashable, Sendable {
    var url: String?
    var mode: String
    var label: String
}

struct LiveStream: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var creatorId: String?
    var title: String
    var category: String?
    var subcategory: String?
    var description: String?
    var format: String?
    var visibility: String?
    var language: String?
    var seriesId: String?
    var moderators: [PublicProfile]?
    /// Only present in the host's own view of a show.
    var mutedWords: [String]?
    var explicit: Bool?
    var shipping: ShowShipping?
    var reminderCount: Int?
    var shareUrl: String?
    /// `ivs` or `cloudflare` while a real broadcast is running.
    var liveVideoProvider: String?
    var scheduledStartTime: String?
    var endTime: String?
    var status: String
    var viewerCount: Int
    var peakViewerCount: Int?
    var hlsUrl: String?
    var posterUrl: String?
    var itemQueue: [String]?
    var activeAuctionId: String?
    var totalGMV: Double?
    var chatEnabled: Bool?
    var playback: PlaybackInfo?
    var creator: PublicProfile?
    var activeAuction: Auction?
    var queuedCount: Int?

    var isLive: Bool { status == "live" }
    var isScheduled: Bool { status == "scheduled" }
    var startDate: Date? { scheduledStartTime.flatMap(ISODate.parse) }
    /// The URL a player should open, resolved server-side; falls back to the raw HLS field.
    var playbackURL: URL? {
        if let raw = playback?.url, let url = URL(string: raw) { return url }
        if let raw = hlsUrl, !raw.isEmpty { return URL(string: raw) }
        return nil
    }
}

struct ChatMessage: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var streamId: String
    var userId: String
    var displayName: String
    var body: String
    var isPinned: Bool?
    var isCreator: Bool?
    var createdAt: String
}

struct CostBreakdown: Codable, Hashable, Sendable {
    var hammerPrice: Double
    var buyersPremium: Double
    var buyersPremiumRate: Double
    var shipping: Double
    var tax: Double
    var total: Double
    var currency: String
}

struct PricePoint: Codable, Hashable, Sendable {
    var label: String
    var value: Double
}

struct BidIncrements: Codable, Hashable, Sendable {
    var minimum: Double
    var mid: Double
    var aggressive: Double
}

struct AppNotification: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var category: String
    var title: String
    var body: String
    var href: String?
    var read: Bool
    var createdAt: String
}

struct Order: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var auctionId: String
    var hammerPrice: Double?
    var totalAmount: Double
    var currency: String
    var paymentStatus: String?
    var orderStatus: String
    var trackingNumber: String?
    var courierName: String?
    var createdAt: String
    var auction: Auction?
    var counterparty: PublicProfile?
}

struct WalletTransaction: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var type: String
    var label: String
    var amount: Double
    var currency: String
    var at: String
}

// MARK: - Responses

struct Paginated<T: Codable & Sendable>: Codable, Sendable {
    var items: [T]
    var total: Int?
    var page: Int?
    var pageSize: Int?
    var hasMore: Bool?
}

struct ListResponse<T: Codable & Sendable>: Codable, Sendable {
    var items: [T]
    var total: Int?
}

struct AuctionDetailResponse: Codable, Sendable {
    var auction: Auction
    var bids: [Bid]
    var breakdown: CostBreakdown?
    var minimumBid: Double
    var increments: BidIncrements?
    var priceHistory: [PricePoint]?
    var related: [Auction]?
}

struct ShowShipping: Codable, Hashable, Sendable {
    var freePickup: Bool
    var shippingCap: Double?
}

struct StreamDetailResponse: Codable, Sendable {
    var stream: LiveStream
    /// Whether the signed-in viewer saved this show for a reminder.
    var reminded: Bool?
    var chat: [ChatMessage]
    var queue: [Auction]
}

struct RequestCodeResponse: Codable, Sendable {
    struct Delivery: Codable, Sendable { var delivered: Bool; var transport: String; var detail: String? }
    var ok: Bool
    var kind: String
    var destination: String
    var expiresInSeconds: Int
    var delivery: Delivery?
    var devCode: String?
}

struct VerifyCodeResponse: Codable, Sendable {
    var ok: Bool
    var token: String
    var expiresAt: String?
    var user: User
    var profile: PublicProfile?
}

struct SessionResponse: Codable, Sendable {
    var ok: Bool?
    var user: User?
    var profile: PublicProfile?
}

struct PlaceBidResponse: Codable, Sendable {
    var ok: Bool
    var auction: Auction
    var bids: [Bid]
}

struct CreateListingResponse: Codable, Sendable {
    var auction: Auction
}

struct OrdersResponse: Codable, Sendable {
    var buying: [Order]
    var selling: [Order]
}

struct WalletResponse: Codable, Sendable {
    var currency: String
    var available: Double
    var pending: Double
    var lifetimeGross: Double?
    var transactions: [WalletTransaction]
}

struct NotificationsResponse: Codable, Sendable {
    var items: [AppNotification]
    var unread: Int
}

struct OkResponse: Codable, Sendable {
    var ok: Bool?
}

struct HealthResponse: Codable, Sendable {
    var ok: Bool
    var service: String?
    var version: String?
    var liveStreams: Int?
    var liveAuctions: Int?
}

// MARK: - Realtime payloads

struct BidPlacedPayload: Codable, Sendable {
    var auction: Auction
    var bid: Bid
    var extended: Bool?
    var extensionMs: Double?
}

struct BidRejectedPayload: Codable, Sendable {
    var auctionId: String
    var reason: String
    var message: String
    var minimumBid: Double?
}

struct AuctionWonPayload: Codable, Sendable {
    var auction: Auction
    var winnerId: String
    var hammerPrice: Double
    var total: Double?
}

struct AuctionExtendedPayload: Codable, Sendable {
    var auctionId: String
    var endTime: String
    var extensionMs: Double?
}

struct ViewersPayload: Codable, Sendable {
    var streamId: String
    var viewerCount: Int
}

struct StreamItemPayload: Codable, Sendable {
    var streamId: String
    var auctionId: String?
    var nextInQueue: Int?
}

struct AuctionCreatedPayload: Codable, Sendable {
    var auction: Auction
}

// MARK: - Dates

enum ISODate {
    nonisolated(unsafe) private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    nonisolated(unsafe) private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    private static let lock = NSLock()

    static func parse(_ text: String) -> Date? {
        lock.lock(); defer { lock.unlock() }
        return fractional.date(from: text) ?? plain.date(from: text)
    }
}

struct CategoriesResponse: Codable, Sendable {
    var items: [CategoryActivity]
}

struct SellerProfileResponse: Codable, Sendable {
    var sellerProfile: SellerProfile?
    var user: User?
}

struct StreamResponse: Codable, Sendable {
    var stream: LiveStream
}

struct StreamBatchResponse: Codable, Sendable {
    var streams: [LiveStream]
    var seriesId: String?
}

struct ReminderResponse: Codable, Sendable {
    var reminded: Bool
    var reminderCount: Int
}

struct MyStreamsResponse: Codable, Sendable {
    var upcoming: [LiveStream]
    var past: [LiveStream]
}

/// Broadcast credentials for the host (`POST /api/streams/:id/go-live`).
struct BroadcastCredentials: Codable, Sendable {
    struct IVS: Codable, Sendable { var stageArn: String?; var token: String; var participantId: String? }
    struct Cloudflare: Codable, Sendable { var whipUrl: String }
    var provider: String
    var ivs: IVS?
    var cloudflare: Cloudflare?
}

struct GoLiveResponse: Codable, Sendable {
    struct Failover: Codable, Sendable { var from: String; var reason: String }
    var stream: LiveStream
    var broadcast: BroadcastCredentials
    var failedOver: Failover?
}

/// Viewer credentials (`GET /api/streams/:id/watch`).
struct WatchResponse: Codable, Sendable {
    struct Viewer: Codable, Sendable {
        struct IVS: Codable, Sendable { var token: String }
        struct Cloudflare: Codable, Sendable { var whepUrl: String }
        var provider: String
        var ivs: IVS?
        var cloudflare: Cloudflare?
    }
    var viewer: Viewer
}

struct StreamActionResponse: Codable, Sendable {
    var stream: LiveStream?
}
