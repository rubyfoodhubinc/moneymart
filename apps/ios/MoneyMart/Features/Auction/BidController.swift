import Foundation
import Observation
import UIKit

/// One lot's live state: the authoritative auction, its bid ladder, and the next
/// valid amount. Shared by the lot page and the stream room so both behave alike.
@MainActor
@Observable
final class BidController {
    let auctionId: String
    private(set) var auction: Auction?
    private(set) var bids: [Bid] = []
    private(set) var breakdown: CostBreakdown?
    private(set) var priceHistory: [PricePoint] = []
    private(set) var related: [Auction] = []
    private(set) var minimumBid: Double = 0
    private(set) var increments = BidIncrements(minimum: 1, mid: 5, aggressive: 10)
    var loading = false
    var placing = false
    var error: String?
    var banner: Banner?
    /// The buyer needs to add a shipping address before this bid or buy can go through.
    var needsShippingInfo = false
    /// Name of the member leading (or who won), for "X is winning" / "X won!".
    private(set) var leaderHandle: String?
    @ObservationIgnored private var pending: Pending?
    private enum Pending { case bid(Double), buy }

    struct Banner: Equatable, Identifiable {
        enum Kind { case success, warning, info }
        let id = UUID()
        let kind: Kind
        let text: String
    }

    @ObservationIgnored private var subscriptions: [RealtimeSubscription] = []

    init(auctionId: String) { self.auctionId = auctionId }

    var isOpen: Bool { auction?.status == .live && (auction?.endDate ?? .distantPast) > .now }
    var quickAmounts: [Double] {
        let base = minimumBid
        return [base, base + increments.mid, base + increments.aggressive]
    }

    func load() async {
        loading = auction == nil
        error = nil
        defer { loading = false }
        do {
            let detail = try await APIClient.shared.auction(id: auctionId)
            apply(detail)
            attach()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func apply(_ detail: AuctionDetailResponse) {
        auction = detail.auction
        bids = detail.bids
        leaderHandle = detail.bids.first?.bidderHandle
        breakdown = detail.breakdown
        priceHistory = detail.priceHistory ?? []
        related = detail.related ?? []
        minimumBid = detail.minimumBid
        if let inc = detail.increments { increments = inc }
    }

    private func attach() {
        guard subscriptions.isEmpty else { return }
        let realtime = Realtime.shared
        realtime.join("auction:join", auctionId)
        let id = auctionId
        subscriptions = [
            realtime.on("auction:bid", as: BidPlacedPayload.self) { [weak self] payload in
                guard let self, payload.auction.id == id else { return }
                self.auction = payload.auction
                if !self.bids.contains(where: { $0.id == payload.bid.id }) { self.bids.insert(payload.bid, at: 0) }
                self.leaderHandle = payload.bid.bidderHandle
                self.minimumBid = payload.auction.currentBid + self.increments.minimum
                if payload.extended == true {
                    self.banner = Banner(kind: .info, text: String(localized: "Anti-snipe: the clock was extended."))
                }
            },
            realtime.on("auction:extended", as: AuctionExtendedPayload.self) { [weak self] payload in
                guard let self, payload.auctionId == id else { return }
                self.auction?.endTime = payload.endTime
            },
            realtime.on("auction:won", as: AuctionWonPayload.self) { [weak self] payload in
                guard let self, payload.auction.id == id else { return }
                self.auction = payload.auction
                if let winner = payload.winnerHandle { self.leaderHandle = winner }
                let who = payload.winnerHandle.map { "@\($0) " } ?? ""
                self.banner = Banner(kind: .success, text: String(localized: "\(who)won for \(Format.money(payload.hammerPrice, payload.auction.currency))"))
            },
            realtime.on("auction:rejected", as: BidRejectedPayload.self) { [weak self] payload in
                guard let self, payload.auctionId == id else { return }
                self.banner = Banner(kind: .warning, text: payload.message)
                if let min = payload.minimumBid, min > 0 { self.minimumBid = min }
            },
        ]
    }

    func detach() {
        guard !subscriptions.isEmpty else { return }
        Realtime.shared.leave(join: "auction:join", leave: "auction:leave", auctionId)
        subscriptions.removeAll()
    }

    @discardableResult
    func place(_ amount: Double) async -> Bool {
        guard amount >= minimumBid else {
            banner = Banner(kind: .warning, text: String(localized: "Minimum bid is \(Format.money(minimumBid, auction?.currency ?? "USD"))"))
            return false
        }
        placing = true
        defer { placing = false }
        let haptic = UINotificationFeedbackGenerator()
        do {
            let result = try await APIClient.shared.placeBid(auctionId: auctionId, amount: amount)
            auction = result.auction
            bids = result.bids
            minimumBid = result.auction.currentBid + increments.minimum
            leaderHandle = result.bids.first?.bidderHandle ?? leaderHandle
            haptic.notificationOccurred(.success)
            banner = Banner(kind: .success, text: String(localized: "You're the highest bidder at \(Format.money(amount, result.auction.currency))"))
            return true
        } catch {
            if (error as? APIError)?.code == "shipping_info_required" {
                pending = .bid(amount)
                needsShippingInfo = true
                return false
            }
            haptic.notificationOccurred(.error)
            banner = Banner(kind: .warning, text: error.localizedDescription)
            if let detail = try? await APIClient.shared.auction(id: auctionId) { apply(detail) }
            return false
        }
    }

    var canBuyNow: Bool {
        guard isOpen, let auction, let price = auction.buyItNowPrice, price > 0 else { return false }
        if let left = auction.unitsLeft, left == 0 { return false }
        return auction.currentBid < price
    }

    /// Buys at the Buy It Now price. Returns the new order id on success.
    @discardableResult
    func buyNow() async -> String? {
        placing = true
        defer { placing = false }
        let haptic = UINotificationFeedbackGenerator()
        do {
            let result = try await APIClient.shared.buyNow(auctionId: auctionId)
            auction = result.auction
            haptic.notificationOccurred(.success)
            banner = Banner(kind: .success, text: String(localized: "It’s yours! Check your orders for payment and shipping."))
            return result.orderId ?? ""
        } catch {
            if (error as? APIError)?.code == "shipping_info_required" {
                pending = .buy
                needsShippingInfo = true
                return nil
            }
            haptic.notificationOccurred(.error)
            banner = Banner(kind: .warning, text: error.localizedDescription)
            if let detail = try? await APIClient.shared.auction(id: auctionId) { apply(detail) }
            return nil
        }
    }

    /// After the buyer added an address: carry on with what they were doing (at the current minimum for a bid).
    func resumeAfterShippingInfo() async {
        let action = pending
        pending = nil
        switch action {
        case .bid(let amount): await place(max(amount, minimumBid))
        case .buy: await buyNow()
        case nil: break
        }
    }

    func setAutoBid(max: Double, aggressive: Bool) async -> Bool {
        placing = true
        defer { placing = false }
        do {
            _ = try await APIClient.shared.setAutoBid(auctionId: auctionId, maxAmount: max,
                                                      increment: aggressive ? increments.mid : increments.minimum, aggressive: aggressive)
            banner = Banner(kind: .success, text: String(localized: "Auto-bid on up to \(Format.money(max, auction?.currency ?? "USD"))"))
            return true
        } catch {
            banner = Banner(kind: .warning, text: error.localizedDescription)
            return false
        }
    }
}
