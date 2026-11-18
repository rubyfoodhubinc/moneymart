import Foundation

// MARK: - Models for engagement (Wave B) and growth (Wave C)

/// A member as the server shows them to others.
struct MiniUser: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var handle: String
    var displayName: String
    var avatarUrl: String?
}

struct Giveaway: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var streamId: String
    var title: String
    var image: String?
    var followersOnly: Bool
    var status: String
    var entrantCount: Int
    var entered: Bool
    var winnerHandle: String?
    var youWon: Bool
    var orderId: String?
    var isOpen: Bool { status == "open" }
}
struct GiveawayList: Codable, Sendable { var items: [Giveaway] }
struct GiveawayResult: Codable, Sendable { var giveaway: Giveaway; var orderId: String? }

struct TipPayload: Codable, Sendable { var streamId: String; var handle: String?; var amount: Double; var currency: String; var note: String? }
struct ReactionPayload: Codable, Sendable { var streamId: String; var emoji: String }
struct JoinedPayload: Codable, Sendable { var streamId: String; var handle: String }
struct CelebratePayload: Codable, Sendable { var streamId: String; var kind: String; var handle: String? }

struct StudioOrder: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var title: String
    var buyerHandle: String
    var totalAmount: Double
    var hammerPrice: Double
    var currency: String
    var paidAt: String?
    var orderStatus: String
    var paymentStatus: String
    var source: String?
    var createdAt: String
}
struct HealthMetric: Codable, Hashable, Identifiable, Sendable { let id: String; var label: String; var value: Int; var target: Int }
struct CommissionTier: Codable, Hashable, Identifiable, Sendable { let id: String; var label: String; var fromUSD: Double; var rate: Double }
struct CategoryRate: Codable, Hashable, Identifiable, Sendable { let id: String; var label: String; var rate: Double }
struct StudioPayout: Codable, Hashable, Identifiable, Sendable { let id: String; var netAmount: Double; var platformFee: Double; var currency: String; var status: String; var initiatedAt: String }
struct SellerStudio: Codable, Sendable {
    struct Payouts: Codable, Sendable { var held: Double; var paid: Double; var tips: Double; var recent: [StudioPayout]; var note: String }
    struct Health: Codable, Sendable { var status: String; var ordersCounted: Int; var lateToShip: Int; var metrics: [HealthMetric] }
    struct Commission: Codable, Sendable {
        var tier: CommissionTier
        var next: CommissionTier?
        var salesUSD30: Double
        var toNextUSD: Double?
        var tiers: [CommissionTier]
        var byCategory: [CategoryRate]
    }
    var currency: String
    var toShip: [StudioOrder]
    var awaitingPayment: [StudioOrder]
    var payouts: Payouts
    var health: Health
    var commission: Commission
}

struct CategoryFeed: Codable, Sendable {
    struct Category: Codable, Sendable { var id: String; var label: String; var emoji: String? }
    var category: Category
    var sort: String
    var live: [LiveStream]
    var listings: [Auction]
}
struct WatchlistResponse: Codable, Sendable { var ids: [String] }

struct CoinChallenge: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var title: String
    var detail: String
    var goal: Int
    var coins: Int
    var progress: Int
    var done: Bool
    var claimed: Bool
}
struct RewardItem: Codable, Hashable, Identifiable, Sendable { let id: String; var title: String; var coins: Int; var creditUSD: Double; var affordable: Bool }
struct WalletEntry: Codable, Hashable, Sendable { var at: String; var kind: String; var amount: Double; var reason: String }
struct CoinWallet: Codable, Sendable {
    var coins: Int
    var creditUSD: Double
    var history: [WalletEntry]
    var watchedTodayMinutes: Int
    var watchDailyCap: Int
    var challenges: [CoinChallenge]
    var rewards: [RewardItem]
}
struct CoinsResult: Codable, Sendable { var coins: Int?; var creditUSD: Double? }
struct WatchTick: Codable, Sendable { var earned: Int; var coins: Int? }
struct ReferralInfo: Codable, Sendable { var code: String; var link: String; var invited: Int; var rewarded: Int; var rewardUSD: Double; var invitedBy: MiniUser? }

struct ClubTier: Codable, Hashable, Identifiable, Sendable { let id: String; var label: String; var fromUSD: Double; var perk: String; var members: Int }
struct ClubInfo: Codable, Sendable {
    struct You: Codable, Sendable {
        struct Tier: Codable, Sendable { var id: String; var label: String; var perk: String? }
        var spentUSD: Double
        var tier: Tier?
        var next: Tier?
    }
    var tiers: [ClubTier]
    var you: You?
}
struct RankRow: Codable, Hashable, Identifiable, Sendable { var categoryId: String; var label: String; var rank: Int; var id: String { categoryId } }
struct Vacation: Codable, Hashable, Sendable { var on: Bool; var message: String?; var until: String? }
struct RanksResponse: Codable, Sendable { var items: [RankRow]; var vacation: Vacation? }

struct Offer: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var auctionId: String
    var amount: Double
    var currency: String
    var status: String
    var counterAmount: Double?
    var orderId: String?
    var message: String?
    var title: String
    var buyItNowPrice: Double?
    var buyer: MiniUser?
    var seller: MiniUser?
    var youAreSeller: Bool
    var updatedAt: String
}
struct OfferResult: Codable, Sendable { var offer: Offer; var orderId: String? }
struct OffersResponse: Codable, Sendable { var sent: [Offer]; var received: [Offer] }

struct DirectMessage: Codable, Hashable, Identifiable, Sendable { let id: String; var fromId: String; var toId: String; var body: String; var at: String; var readAt: String? }
struct ThreadSummary: Codable, Hashable, Identifiable, Sendable { var user: MiniUser; var last: DirectMessage; var unread: Int; var id: String { user.id } }
struct ThreadsResponse: Codable, Sendable { var items: [ThreadSummary]; var unread: Int }
struct ThreadResponse: Codable, Sendable { var user: MiniUser; var messages: [DirectMessage]; var canSend: Bool; var reason: String? }
struct MessageSent: Codable, Sendable { var message: DirectMessage }

struct Clip: Codable, Hashable, Identifiable, Sendable { let id: String; var title: String; var startSec: Int; var endSec: Int; var views: Int; var shareUrl: String; var streamTitle: String }
struct ClipResult: Codable, Sendable { var clip: Clip }

struct BuyerProtection: Codable, Sendable {
    struct Window: Codable, Hashable, Identifiable, Sendable { var categoryId: String; var label: String; var days: Int; var id: String { categoryId } }
    var summary: String
    var covered: [String]
    var notCovered: [String]
    var windows: [Window]
    var windowNote: String
}
struct PromoPrices: Codable, Sendable { struct Option: Codable, Hashable, Sendable { var hours: Int; var amount: Double }; var currency: String; var options: [Option] }
struct PromoResult: Codable, Sendable { struct Promo: Codable, Sendable { var id: String; var amount: Double; var currency: String; var endsAt: String }; var promo: Promo }
struct VacationResult: Codable, Sendable { var vacation: Vacation }
struct CreditResult: Codable, Sendable { var creditUSD: Double }

// MARK: - Endpoints

extension APIClient {
    // Prize Drops, tips, reactions
    func giveaways(streamId: String) async throws -> GiveawayList { try await get("/api/streams/\(streamId)/giveaways") }
    func startGiveaway(streamId: String, title: String, followersOnly: Bool) async throws -> GiveawayResult {
        struct B: Encodable, Sendable { let title: String; let followersOnly: Bool }
        return try await post("/api/streams/\(streamId)/giveaways", body: B(title: title, followersOnly: followersOnly))
    }
    func enterGiveaway(_ id: String) async throws -> GiveawayResult { try await post("/api/giveaways/\(id)/enter") }
    func drawGiveaway(_ id: String) async throws -> GiveawayResult { try await post("/api/giveaways/\(id)/draw") }
    func cancelGiveaway(_ id: String) async throws -> GiveawayResult { try await post("/api/giveaways/\(id)/cancel") }
    func tip(streamId: String, amount: Double, note: String?) async throws -> OkOrCreated {
        struct B: Encodable, Sendable { let amount: Double; let note: String? }
        return try await post("/api/streams/\(streamId)/tips", body: B(amount: amount, note: note))
    }
    func react(streamId: String, emoji: String) async throws -> OkOrCreated {
        struct B: Encodable, Sendable { let emoji: String }
        return try await post("/api/streams/\(streamId)/react", body: B(emoji: emoji))
    }
    func watchTick(streamId: String) async throws -> WatchTick { try await post("/api/streams/\(streamId)/watch-tick") }
    func clip(streamId: String, title: String, startSec: Int, endSec: Int) async throws -> ClipResult {
        struct B: Encodable, Sendable { let title: String; let startSec: Int; let endSec: Int }
        return try await post("/api/streams/\(streamId)/clips", body: B(title: title, startSec: startSec, endSec: endSec))
    }

    // Seller tools
    func sellerStudio() async throws -> SellerStudio { try await get("/api/seller/studio") }
    func setVacation(on: Bool, message: String?) async throws -> VacationResult {
        struct B: Encodable, Sendable { let on: Bool; let message: String? }
        return try await put("/api/me/vacation", body: B(on: on, message: message))
    }
    func promoPrices() async throws -> PromoPrices { try await get("/api/promos/prices") }
    func promote(kind: String, targetId: String, hours: Int) async throws -> PromoResult {
        struct B: Encodable, Sendable { let kind: String; let targetId: String; let hours: Int }
        return try await post("/api/promos", body: B(kind: kind, targetId: targetId, hours: hours))
    }

    // Categories and watchlist
    func categoryFeed(_ id: String, sort: String) async throws -> CategoryFeed { try await get("/api/categories/\(id)/feed", query: ["sort": sort]) }
    func serverWatchlist() async throws -> WatchlistResponse { try await get("/api/me/watchlist") }
    func setWatched(_ auctionId: String, _ on: Bool) async throws -> WatchlistResponse {
        on ? try await put("/api/me/watchlist/\(auctionId)", body: EmptyBody()) : try await delete("/api/me/watchlist/\(auctionId)")
    }

    // Coins, rewards, credit, referrals
    func coinWallet() async throws -> CoinWallet { try await get("/api/me/wallet") }
    func claimChallenge(_ id: String) async throws -> CoinsResult { try await post("/api/me/challenges/\(id)/claim") }
    func redeemReward(_ id: String) async throws -> CoinsResult { try await post("/api/me/rewards/\(id)/redeem") }
    func applyCredit(orderId: String) async throws -> CreditResult { try await post("/api/orders/\(orderId)/apply-credit") }
    func referral() async throws -> ReferralInfo { try await get("/api/me/referral") }
    func claimReferral(code: String) async throws -> OkOrCreated {
        struct B: Encodable, Sendable { let code: String }
        return try await post("/api/referrals/claim", body: B(code: code))
    }

    // Clubs, ranks
    func club(sellerId: String) async throws -> ClubInfo { try await get("/api/users/\(sellerId)/club") }
    func ranks(userId: String) async throws -> RanksResponse { try await get("/api/users/\(userId)/ranks") }

    // Offers
    func makeOffer(auctionId: String, amount: Double, message: String?) async throws -> OfferResult {
        struct B: Encodable, Sendable { let amount: Double; let message: String? }
        return try await post("/api/auctions/\(auctionId)/offers", body: B(amount: amount, message: message))
    }
    func offers() async throws -> OffersResponse { try await get("/api/me/offers") }
    func offerAction(_ id: String, _ action: String, amount: Double? = nil) async throws -> OfferResult {
        struct B: Encodable, Sendable { let amount: Double? }
        return try await post("/api/offers/\(id)/\(action)", body: B(amount: amount))
    }

    // Messages
    func threads() async throws -> ThreadsResponse { try await get("/api/me/threads") }
    func thread(with userId: String) async throws -> ThreadResponse { try await get("/api/threads/\(userId)") }
    func sendMessage(to userId: String, body: String) async throws -> MessageSent {
        struct B: Encodable, Sendable { let body: String }
        return try await post("/api/threads/\(userId)", body: B(body: body))
    }

    func buyerProtection() async throws -> BuyerProtection { try await get("/api/policies/buyer-protection") }
}
