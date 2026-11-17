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

    /// Seller journey: finish seller setup, list an item, schedule a show and put
    /// the item in its run order. Local gateway only (same rules as above).
    func testSellerSetupScheduleShowAndAddItem() async throws {
        try await prepareLocalGateway()
        app.buttons["welcome-skip"].tap()
        try signIn("qa.seller@moneymart.test")

        // List an item first, so there is something to put in the show.
        app.tabBars.buttons["Sell"].tap()
        let title = app.textFields["sell-title"]
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        title.tap()
        title.typeText("QA Candy Crate\n")
        app.buttons["Buy now"].tap()
        let amount = app.textFields["sell-price"]
        scrollTo(amount)
        amount.tap()
        amount.typeText("25")
        let done = app.toolbars.buttons["Done"].firstMatch
        if done.waitForExistence(timeout: 3) { done.tap() }
        let publish = app.buttons["sell-publish"]
        scrollTo(publish)
        publish.tap()
        XCTAssertTrue(app.staticTexts["lot-title"].waitForExistence(timeout: 15), "the listing is published")

        // Seller setup from the Studio card.
        app.tabBars.buttons["Sell"].tap()
        if app.navigationBars.buttons.firstMatch.exists, !app.buttons["studio-setup"].exists { app.navigationBars.buttons.firstMatch.tap() }
        let setup = app.buttons["studio-setup"]
        scrollTo(setup, up: true)
        XCTAssertTrue(setup.waitForExistence(timeout: 10), "a new seller is offered setup")
        setup.tap()
        let next = app.buttons["seller-next"]
        XCTAssertTrue(next.waitForExistence(timeout: 5))
        next.tap() // welcome
        app.buttons["seller-option-individual"].tap(); next.tap()
        let food = app.buttons["seller-category-food"]
        scrollTo(food)
        food.tap(); next.tap()
        next.tap() // subcategories optional
        app.buttons["seller-option-none"].tap(); next.tap()
        app.buttons["seller-option-lt_1k"].tap(); next.tap()
        app.buttons["seller-option-lt_10"].tap(); next.tap()
        app.buttons["seller-option-1"].tap(); next.tap()
        app.buttons["seller-option-1_2"].tap(); next.tap()
        fill("addr-line1", "12 Market Street")
        fill("addr-city", "Houston")
        fill("addr-region", "TX")
        fill("addr-postal", "77002")
        if done.waitForExistence(timeout: 2) { done.tap() }
        scrollTo(next)
        XCTAssertTrue(next.isEnabled, "a complete address can be submitted")
        next.tap()

        // The Studio card now offers shows; schedule one.
        let shows = app.buttons["studio-shows"]
        XCTAssertTrue(shows.waitForExistence(timeout: 15), "finishing setup unlocks My shows")
        shows.tap()
        let newShow = app.buttons["shows-new"]
        XCTAssertTrue(newShow.waitForExistence(timeout: 10))
        newShow.tap()
        let single = app.buttons["Single show"]
        XCTAssertTrue(single.waitForExistence(timeout: 5), "the + menu offers a single show")
        single.tap()
        let showTitle = app.textFields["show-title"]
        XCTAssertTrue(showTitle.waitForExistence(timeout: 5))
        showTitle.tap()
        showTitle.typeText("QA Candy Night\n")
        app.buttons["show-save"].tap()
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'show-str_'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "the scheduled show is listed")
        XCTAssertTrue(row.label.contains("QA Candy Night"), row.label)
        row.tap()

        // Add the listing to the run order.
        let addItems = app.buttons["show-add-items"]
        XCTAssertTrue(addItems.waitForExistence(timeout: 10))
        addItems.tap()
        let add = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'add-auc_'")).firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 10), "the seller's open listing is offered")
        add.tap()
        app.navigationBars.buttons["Done"].tap()
        XCTAssertTrue(app.staticTexts["QA Candy Crate"].waitForExistence(timeout: 10), "the item is in the run order")

        // The host console opens from the show, ready to go live.
        let goLive = app.buttons["show-go-live"]
        XCTAssertTrue(goLive.waitForExistence(timeout: 5), "a scheduled show offers Go live")
        goLive.tap()
        XCTAssertTrue(app.buttons["host-go-live"].waitForExistence(timeout: 10), "the host console shows the Go live button")
        app.buttons["host-close"].tap()
        XCTAssertTrue(goLive.waitForExistence(timeout: 10), "closing before going live returns to the show")

        // Plan a twice-weekly run with the guided scheduler.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'show-str_'"))
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 10))
        let before = rows.count
        app.buttons["shows-new"].tap()
        let plan = app.buttons["Plan your shows"]
        XCTAssertTrue(plan.waitForExistence(timeout: 5))
        plan.tap()
        let wizardNext = app.buttons["wizard-next"]
        XCTAssertTrue(wizardNext.waitForExistence(timeout: 5))
        app.buttons["wizard-frequency-weekly2"].tap(); wizardNext.tap()
        app.buttons["wizard-day-3"].tap(); app.buttons["wizard-day-5"].tap(); wizardNext.tap()
        wizardNext.tap() // default start time
        XCTAssertTrue(wizardNext.isEnabled, "two weeks of Tuesdays and Thursdays leaves dates to schedule")
        wizardNext.tap() // calendar
        let wizardTitle = app.textFields["wizard-title"]
        XCTAssertTrue(wizardTitle.waitForExistence(timeout: 5))
        wizardTitle.tap()
        wizardTitle.typeText("QA Weekly Candy\n")
        wizardNext.tap() // title
        wizardNext.tap() // category
        wizardNext.tap() // cover: add later
        XCTAssertTrue(wizardNext.label.contains("Schedule"), wizardNext.label)
        wizardNext.tap()
        let deadline = Date().addingTimeInterval(15)
        while rows.count < before + 3 && Date() < deadline { _ = rows.firstMatch.waitForExistence(timeout: 1) }
        XCTAssertGreaterThanOrEqual(rows.count, before + 3, "the series is scheduled in one step")
    }

    /// Ore, the member's assistant: opens from Home, answers, and reports a request up to President Ore.
    /// Needs a local API whose Claude base points at a stand-in (see scripts/verify-president.mjs).
    func testOreAnswersAndReportsUp() async throws {
        try await prepareLocalGateway()
        app.buttons["welcome-skip"].tap()
        try signIn("qa.ore@moneymart.test")

        app.tabBars.buttons["Home"].tap()
        let open = app.buttons["ore-button"]
        XCTAssertTrue(open.waitForExistence(timeout: 10), "Ore shows when the server has her switched on")
        open.tap()

        let suggestion = app.buttons["ore-suggestion-0"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 5), "a new chat offers suggestions")
        suggestion.tap()
        let answer = app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] 'bid'")).matching(NSPredicate(format: "label CONTAINS 'Bidding is simple'")).firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 30), "Ore answers the member")

        let input = app.textFields["ore-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap()
        input.typeText("Please add dark mode")
        app.buttons["ore-send"].tap()
        let reported = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Sent to President'")).firstMatch
        XCTAssertTrue(reported.waitForExistence(timeout: 30), "the member sees the request went to the President")

        app.buttons["ore-done"].tap()
        app.tabBars.buttons["Profile"].tap()
        XCTAssertTrue(app.buttons["profile-ore"].waitForExistence(timeout: 5), "Ore is also in Profile")
    }

    private func signIn(_ identifier: String) throws {
        app.tabBars.buttons["Profile"].tap()
        app.buttons["profile-signin"].tap()
        let field = app.textFields["auth-identifier"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText(identifier)
        app.buttons["auth-send"].tap()
        let devCode = app.buttons["auth-devcode"]
        guard devCode.waitForExistence(timeout: 10) else {
            throw XCTSkip("Gateway does not expose development codes; run against a local API.")
        }
        devCode.tap()
        XCTAssertTrue(app.buttons["profile-signout"].waitForExistence(timeout: 15), "verifying the code signs the user in")
    }

    private func scrollTo(_ target: XCUIElement, up: Bool = false) {
        var attempts = 0
        while !(target.exists && target.isHittable) && attempts < 6 {
            if up { app.swipeDown() } else { app.swipeUp() }
            attempts += 1
        }
    }

    private func fill(_ identifier: String, _ text: String) {
        let field = app.textFields[identifier]
        scrollTo(field)
        field.tap()
        field.typeText(text)
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
