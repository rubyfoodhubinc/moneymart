import XCTest

/// End-to-end flows against the configured gateway (production by default, or
/// `MM_API_URL` for a local stack started with `MM_AUTH_DEV_CODES=true`).
@MainActor
final class MoneyMartUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() async throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-mm-reset"]
        if let url = ProcessInfo.processInfo.environment["MM_API_URL"] { app.launchEnvironment["MM_API_URL"] = url }
        app.launch()
    }

    func testOnboardingReachesMarketplace() {
        let skip = app.buttons["welcome-skip"]
        XCTAssertTrue(skip.waitForExistence(timeout: 15))
        skip.tap()
        XCTAssertTrue(app.tabBars.buttons["Home"].waitForExistence(timeout: 10))
    }

    func testLotCardsAreAccessibleAndOpenDetail() {
        app.buttons["welcome-skip"].tap()
        app.tabBars.buttons["Discover"].tap()
        let lot = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'lot-auc_'")).firstMatch
        XCTAssertTrue(lot.waitForExistence(timeout: 20), "lot cards must be exposed to accessibility")
        XCTAssertFalse(lot.label.isEmpty, "lot card must carry a spoken label")
        lot.tap()
        XCTAssertTrue(app.staticTexts["lot-price"].waitForExistence(timeout: 15))
    }

    func testSignInRequestsCode() {
        app.buttons["welcome-skip"].tap()
        app.tabBars.buttons["Profile"].tap()
        app.buttons["profile-signin"].tap()
        let field = app.textFields["auth-identifier"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("not-an-address")
        app.buttons["auth-send"].tap()
        XCTAssertTrue(element("auth-error").waitForExistence(timeout: 5), "invalid identifiers are refused locally")
    }

    /// Full buyer + seller journey. Needs a local API started with
    /// `MM_PERSISTENCE=off MM_AUTH_DEV_CODES=true` and `auc_lebron` kept open
    /// (`POST /api/dev/clock`); skipped against any gateway that hides dev codes.
    func testSignInBidAndSell() async throws {
        try await prepareLocalGateway()
        app.buttons["welcome-skip"].tap()

        // Sign in with the development code the local gateway returns.
        app.tabBars.buttons["Profile"].tap()
        app.buttons["profile-signin"].tap()
        let field = app.textFields["auth-identifier"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("qa.buyer@moneymart.test")
        app.buttons["auth-send"].tap()
        let devCode = app.buttons["auth-devcode"]
        guard devCode.waitForExistence(timeout: 10) else {
            throw XCTSkip("Gateway does not expose development codes; run against a local API.")
        }
        devCode.tap()
        XCTAssertTrue(app.buttons["profile-signout"].waitForExistence(timeout: 15), "verifying the code signs the user in")

        // Find the lot through search and place the minimum bid.
        app.tabBars.buttons["Discover"].tap()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("LeBron\n")
        let lot = element("lot-auc_lebron")
        XCTAssertTrue(lot.waitForExistence(timeout: 15), "search returns the lot")
        lot.tap()
        let price = app.staticTexts["lot-price"]
        XCTAssertTrue(price.waitForExistence(timeout: 15))
        let before = price.label
        let bid = app.buttons["lot-bid"]
        XCTAssertTrue(bid.waitForExistence(timeout: 10), "an open lot offers a bid button")
        bid.tap()
        let quick = app.buttons["bid-quick-0"]
        XCTAssertTrue(quick.waitForExistence(timeout: 5))
        quick.tap()
        let banner = element("bid-banner")
        XCTAssertTrue(banner.waitForExistence(timeout: 15))
        XCTAssertTrue(banner.label.localizedCaseInsensitiveContains("highest bidder"), "bid accepted: \(banner.label)")
        XCTAssertNotEqual(price.label, before, "price updates after the bid")

        // Publish a Buy It Now listing from Sell.
        app.tabBars.buttons["Sell"].tap()
        let title = app.textFields["sell-title"]
        if !title.waitForExistence(timeout: 10) { print(app.debugDescription) }
        XCTAssertTrue(title.exists, "signed-in sellers get the listing form")
        title.tap()
        title.typeText("QA Vintage Walkman WM-2\n")
        app.buttons["Buy now"].tap()
        let amount = app.textFields["sell-price"]
        XCTAssertTrue(amount.waitForExistence(timeout: 5))
        var attempts = 0
        while !amount.isHittable && attempts < 4 { app.swipeUp(); attempts += 1 }
        amount.tap()
        amount.typeText("120")
        let done = app.toolbars.buttons["Done"].firstMatch
        if done.waitForExistence(timeout: 3) { done.tap() }
        let publish = app.buttons["sell-publish"]
        attempts = 0
        while !publish.isHittable && attempts < 4 { app.swipeUp(); attempts += 1 }
        XCTAssertTrue(publish.isEnabled, "a titled, priced listing can be published")
        publish.tap()
        let published = app.staticTexts["lot-title"]
        XCTAssertTrue(published.waitForExistence(timeout: 15), "publishing opens the new lot")
        XCTAssertEqual(published.label, "QA Vintage Walkman WM-2")
    }

    /// Reseeds the local gateway and keeps the test lot open, so the journey is
    /// repeatable (a second run would otherwise already hold the high bid).
    private func prepareLocalGateway() async throws {
        guard let raw = ProcessInfo.processInfo.environment["MM_API_URL"], let base = URL(string: raw),
              ["127.0.0.1", "localhost"].contains(base.host ?? "") else {
            throw XCTSkip("Set MM_API_URL to a local gateway (dev codes on) to run the buy/sell journey.")
        }
        func post(_ path: String, _ body: [String: Any]) async throws {
            var request = URLRequest(url: base.appending(path: path))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (_, response) = try await URLSession.shared.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200, "\(path) failed")
        }
        try await post("/api/dev/reset", [:])
        // Repeated runs request codes for the same address; the gateway rate-limits that.
        try await post("/api/dev/rate-limit/reset", [:])
        try await post("/api/dev/clock", ["auctionId": "auc_lebron", "secondsFromNow": 3600])
    }

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }
}
