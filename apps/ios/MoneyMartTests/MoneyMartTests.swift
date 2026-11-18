import XCTest
import UIKit
@testable import MoneyMart

final class ModelDecodingTests: XCTestCase {
    func testAuctionDecodesProductionShape() throws {
        let json = """
        {"items":[{"id":"auc_rolex","title":"Rolex Datejust 36","itemId":"itm_rolex","status":"sold","endTime":"2026-10-12T02:57:49.678Z",
        "bidCount":6,"currency":"GBP","featured":true,"sellerId":"usr_priya","streamId":"str_hautehour","watchers":40,"winnerId":"usr_sofia",
        "startTime":"2026-10-12T02:30:30.678Z","currentBid":8450,"auctionType":"live_stream","hammerPrice":8450,"reservePrice":7800,
        "startingPrice":6200,"buyersPremiumRate":0.2,"futureField":{"x":1},
        "item":{"id":"itm_rolex","title":"Rolex","images":["data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E"],"categoryId":"watches","condition":"like_new","isVerified":true},
        "seller":{"id":"usr_priya","displayName":"Priya Raman","handle":"hautehour","rating":4.8,"isVerified":true},
        "isLive":false,"reserveMet":true}],"total":1,"page":1,"pageSize":24,"hasMore":false}
        """
        let page = try JSONDecoder().decode(Paginated<Auction>.self, from: Data(json.utf8))
        let lot = try XCTUnwrap(page.items.first)
        XCTAssertEqual(lot.status, .sold)
        XCTAssertEqual(lot.auctionType, .liveStream)
        XCTAssertEqual(lot.displayPrice, 8450)
        XCTAssertEqual(lot.categoryId, "watches")
        XCTAssertNotEqual(lot.endDate, .distantPast)
    }

    func testUnknownEnumValuesDoNotFailDecode() throws {
        let json = #"{"id":"a","auctionType":"sudden_death","title":"x","startingPrice":1,"currentBid":0,"bidCount":0,"endTime":"2026-01-01T00:00:00Z","status":"paused","currency":"USD"}"#
        let lot = try JSONDecoder().decode(Auction.self, from: Data(json.utf8))
        XCTAssertEqual(lot.auctionType, .unknown)
        XCTAssertEqual(lot.status, .unknown)
        XCTAssertEqual(lot.displayPrice, 1)
    }

    func testStreamPlaybackPrefersServerResolvedURL() throws {
        let json = #"{"id":"s","title":"Show","status":"live","viewerCount":10,"hlsUrl":"","playback":{"url":"https://x.test/hls/main/index.m3u8","mode":"demo","label":"Demo"}}"#
        let stream = try JSONDecoder().decode(LiveStream.self, from: Data(json.utf8))
        XCTAssertEqual(stream.playbackURL?.absoluteString, "https://x.test/hls/main/index.m3u8")
        XCTAssertTrue(stream.isLive)
    }

    func testOfflineStreamHasNoPlaybackURL() throws {
        let json = #"{"id":"s","title":"Show","status":"scheduled","viewerCount":0,"hlsUrl":"","playback":{"mode":"offline","label":"Starts soon"}}"#
        let stream = try JSONDecoder().decode(LiveStream.self, from: Data(json.utf8))
        XCTAssertNil(stream.playbackURL)
    }

    func testAPIErrorMapsServerReason() {
        let error = APIClient.makeError(status: 409, data: Data(#"{"error":"bid_rejected","reason":"below_minimum_increment"}"#.utf8))
        XCTAssertEqual(error.code, "below_minimum_increment")
        XCTAssertFalse(error.message.isEmpty)
        let plain = APIClient.makeError(status: 500, data: Data("oops".utf8))
        XCTAssertEqual(plain.status, 500)
    }
}

final class SocketPacketTests: XCTestCase {
    func testParsesEngineAndSocketFrames() {
        XCTAssertEqual(SocketPacket.parse(#"0{"sid":"abc","pingInterval":25000,"pingTimeout":20000}"#), .open(pingInterval: 25000))
        XCTAssertEqual(SocketPacket.parse("2"), .ping)
        XCTAssertEqual(SocketPacket.parse(#"40{"sid":"xyz"}"#), .connected)
        XCTAssertEqual(SocketPacket.parse(#"44{"message":"invalid_token"}"#), .connectError("invalid_token"))
        XCTAssertEqual(SocketPacket.parse("41"), .disconnected)
    }

    func testParsesEventWithPayload() throws {
        guard case let .event(name, payload) = SocketPacket.parse(#"42["stream:viewers",{"streamId":"s1","viewerCount":42}]"#) else {
            return XCTFail("not an event")
        }
        XCTAssertEqual(name, "stream:viewers")
        let decoded = try JSONDecoder().decode(ViewersPayload.self, from: XCTUnwrap(payload))
        XCTAssertEqual(decoded.viewerCount, 42)
    }

    func testEncodesEventsAndAuth() {
        XCTAssertEqual(SocketPacket.encodeEvent("auction:join", "auc_1"), #"42["auction:join","auc_1"]"#)
        XCTAssertEqual(SocketPacket.encodeConnect(token: nil), "40")
        XCTAssertEqual(SocketPacket.encodeConnect(token: "t"), #"40{"token":"t"}"#)
    }

    func testMalformedFramesAreIgnored() {
        if case .event = SocketPacket.parse("42[not json") { XCTFail("should not parse") }
        XCTAssertEqual(SocketPacket.parse(""), .unknown(""))
    }
}

final class ArtworkTests: XCTestCase {
    func testParsesGeneratedLotArtwork() throws {
        let svg = ##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><defs><linearGradient id="bg" gradientTransform="rotate(177 0.5 0.5)"><stop offset="0%" stop-color="#0D1B2A"/><stop offset="55%" stop-color="#1C1C1E"/><stop offset="100%" stop-color="#070F18"/></linearGradient><linearGradient id="gold"><stop stop-color="#F5A623"/></linearGradient></defs><circle cx="500" cy="430" r="118"/><text x="500" font-size="150">RD</text><rect x="0" y="936" width="637" height="6" fill="url(#gold)"/></svg>"##
        let uri = "data:image/svg+xml;utf8," + svg.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        let art = try XCTUnwrap(SVGArt.parse(dataURI: uri))
        XCTAssertEqual(art.stops.count, 3)
        XCTAssertEqual(art.angle, 177)
        XCTAssertEqual(art.initials, "RD")
        XCTAssertEqual(try XCTUnwrap(art.progress), 0.637, accuracy: 0.0001)
        XCTAssertTrue(art.rings)
    }

    func testNonSVGReturnsNil() {
        XCTAssertNil(SVGArt.parse(dataURI: "https://example.com/a.jpg"))
        XCTAssertNil(SVGArt.parse(dataURI: "data:image/png;base64,AAAA"))
    }
}

@MainActor
final class SessionTests: XCTestCase {
    func testIdentifierNormalisation() {
        XCTAssertEqual(SessionStore.normalise("  Ada@Example.COM "), "ada@example.com")
        XCTAssertEqual(SessionStore.normalise("+1 (281) 357-9779"), "+12813579779")
        XCTAssertNil(SessionStore.normalise("not-an-email"))
        XCTAssertNil(SessionStore.normalise("12345"))
        XCTAssertNil(SessionStore.normalise("a@b"))
    }

    func testReleaseConfigRejectsBadURLs() {
        XCTAssertNil(AppConfig.validated("ftp://moneymart.app"))
        XCTAssertNil(AppConfig.validated("not a url"))
        XCTAssertEqual(AppConfig.validated("https://www.moneymart.app/")?.absoluteString, "https://www.moneymart.app")
    }
}

final class FormatTests: XCTestCase {
    func testCountdown() {
        let now = Date(timeIntervalSince1970: 0)
        XCTAssertEqual(Format.countdown(to: now.addingTimeInterval(299), now: now), "04:59")
        XCTAssertEqual(Format.countdown(to: now.addingTimeInterval(3 * 3600 + 720), now: now), "3h 12m")
        XCTAssertEqual(Format.countdown(to: now.addingTimeInterval(2 * 86_400 + 4 * 3600), now: now), "2d 4h")
        XCTAssertNil(Format.countdown(to: now, now: now))
    }

    func testPremiumRates() {
        XCTAssertEqual(Catalog.premiumRate(category: "watches", pro: false), 0.20)
        XCTAssertEqual(Catalog.premiumRate(category: "sneakers", pro: true), 0.10)
    }

    func testLanguageDetection() {
        XCTAssertEqual(LanguageDetector.detect("¿Hacen envíos a Madrid esta semana?"), "es")
        XCTAssertNil(LanguageDetector.detect("ok"))
        // Regression: short English chat was flagged as Dutch in the stream room.
        XCTAssertFalse(LanguageDetector.isForeign("Reserve met?", preferred: "en"))
        XCTAssertFalse(LanguageDetector.isForeign("Reserve just met! Going once…", preferred: "en"))
        XCTAssertTrue(LanguageDetector.isForeign("Est-ce que vous livrez à Paris demain?", preferred: "en"))
    }

    func testListingImageStaysUnderServerCeiling() throws {
        let size = CGSize(width: 4000, height: 3000)
        let image = UIGraphicsImageRenderer(size: size).image { ctx in
            for i in 0..<200 {
                UIColor(hue: CGFloat(i) / 200, saturation: 1, brightness: 1, alpha: 1).setFill()
                ctx.fill(CGRect(x: CGFloat(i) * 20, y: 0, width: 20, height: size.height))
            }
        }
        let encoded = try XCTUnwrap(ListingImage.encode(image))
        XCTAssertTrue(encoded.hasPrefix("data:image/jpeg;base64,"))
        XCTAssertLessThanOrEqual(encoded.count, ListingImage.encodedLimit)
    }
}
