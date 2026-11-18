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
        // A new buyer is asked for a shipping address first; the bid then goes through.
        addAddressIfAsked()
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

    /// Ore, the member's chief of staff: opens full screen from Home with a greeting, answers, reports a request
    /// up to President Ore, keeps the chat in Recents, and offers attachments and a call.
    /// Needs a local API whose Claude base points at a stand-in (see scripts/verify-president.mjs).
    func testOreAnswersAndReportsUp() async throws {
        try await prepareLocalGateway()
        app.buttons["welcome-skip"].tap()
        try signIn("qa.ore@moneymart.test")

        app.tabBars.buttons["Home"].tap()
        let open = app.buttons["ore-button"]
        XCTAssertTrue(open.waitForExistence(timeout: 10), "Ore shows when the server has her switched on")
        open.tap()

        let greeting = element("ore-greeting")
        XCTAssertTrue(greeting.waitForExistence(timeout: 5), "a new chat greets the member")
        XCTAssertTrue(["Morning", "Afternoon", "Evening"].contains { greeting.label.hasPrefix($0) }, "the greeting follows the time of day: \(greeting.label)")
        XCTAssertTrue(app.buttons["ore-attach"].exists, "the + menu adds photos and files")
        XCTAssertTrue(app.buttons["ore-call"].exists, "an empty composer offers a call")
        keep("Ore - new chat")

        app.buttons["ore-suggestion-0"].tap()
        let answer = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Bidding is simple'")).firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 30), "Ore answers the member")

        let input = app.textFields["ore-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap()
        input.typeText("Please add dark mode")
        XCTAssertTrue(app.buttons["ore-send"].waitForExistence(timeout: 2), "typing turns the call button into send")
        app.buttons["ore-send"].tap()
        let reported = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Sent to President'")).firstMatch
        XCTAssertTrue(reported.waitForExistence(timeout: 30), "the member sees the request went to the President")
        keep("Ore - conversation")

        app.buttons["ore-menu"].tap()
        XCTAssertTrue(element("ore-recent").waitForExistence(timeout: 5), "the chat is kept in Recents")
        keep("Ore - recents drawer")
        app.buttons["ore-drawer-new"].tap()
        XCTAssertTrue(element("ore-greeting").waitForExistence(timeout: 5), "New chat starts fresh")

        app.buttons["ore-done"].tap()
        app.tabBars.buttons["Profile"].tap()
        XCTAssertTrue(app.buttons["profile-ore"].waitForExistence(timeout: 5), "Ore is also in Profile")
    }

    func testVerificationAndNotifications() async throws {
        try await prepareLocalGateway()
        app.buttons["welcome-skip"].tap()
        try signIn("qa.verify@moneymart.test")

        app.tabBars.buttons["Profile"].tap()
        let verification = app.buttons["profile-verification"]
        scrollTo(verification)
        XCTAssertTrue(verification.waitForExistence(timeout: 10), "Profile has Verification")
        verification.tap()

        let status = element("verify-status")
        XCTAssertTrue(status.waitForExistence(timeout: 10))
        XCTAssertEqual(status.label, "Verify your identity", "a new member starts unverified")
        XCTAssertTrue(app.buttons["verify-start"].exists, "the check can be started")
        keep("Verification - start")

        app.buttons["verify-start"].tap()
        let done = app.buttons["Done"]
        XCTAssertTrue(done.waitForExistence(timeout: 15), "Didit's page opens in the app")
        sleep(2)
        keep("Verification - Didit page")
        done.tap()

        let verified = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "You're verified")).firstMatch
        XCTAssertTrue(verified.waitForExistence(timeout: 15), "coming back reads the result: verified")
        keep("Verification - verified")

        app.navigationBars.buttons.element(boundBy: 0).tap()
        let notifications = app.buttons["profile-notifications"]
        scrollTo(notifications)
        XCTAssertTrue(notifications.waitForExistence(timeout: 5))
        notifications.tap()
        let note = app.buttons.matching(NSPredicate(format: "label CONTAINS 'You are verified'")).firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 10), "the member is notified of the result")
        XCTAssertTrue(app.buttons["notifications-turn-on"].exists, "the list offers to turn on iPhone notifications")
        keep("Notifications - inbox")
        note.tap()
        XCTAssertTrue(element("verify-status").waitForExistence(timeout: 5), "tapping a notification opens its screen")
    }

    /// First bid → shipping address → pay the order; then the live room: host sheet, follow, seller page, shop, costs.
    func testBuyerAddressOrderAndLiveRoom() async throws {
        try await prepareLocalGateway()
        app.buttons["welcome-skip"].tap()
        try signIn("qa.wavea@moneymart.test")

        // Bid on a lot: the address sheet appears before the first bid.
        app.tabBars.buttons["Discover"].tap()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("LeBron\n")
        let lot = element("lot-auc_lebron")
        XCTAssertTrue(lot.waitForExistence(timeout: 15))
        lot.tap()
        let bid = app.buttons["lot-bid"]
        XCTAssertTrue(bid.waitForExistence(timeout: 10))
        bid.tap()
        let quick = app.buttons["bid-quick-0"]
        XCTAssertTrue(quick.waitForExistence(timeout: 5))
        quick.tap()
        XCTAssertTrue(app.buttons["gate-add-address"].waitForExistence(timeout: 10), "a new buyer is asked for a shipping address first")
        keep("Gate - before first bid")
        addAddressIfAsked()
        let banner = element("bid-banner")
        XCTAssertTrue(banner.waitForExistence(timeout: 15))
        XCTAssertTrue(banner.label.localizedCaseInsensitiveContains("highest bidder"), "after the address the bid goes through: \(banner.label)")
        if app.buttons["Close"].exists { app.buttons["Close"].tap() }

        // The lot closes; the winner pays from the order screen.
        try await dev("/api/dev/clock", ["auctionId": "auc_lebron", "secondsFromNow": 0])
        try await Task.sleep(for: .seconds(3))
        app.tabBars.buttons["Profile"].tap()
        let orders = app.buttons["profile-orders"]
        scrollTo(orders)
        orders.tap()
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS 'LeBron'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "the won lot is in Orders")
        row.tap()
        let pay = app.buttons["order-pay"]
        XCTAssertTrue(pay.waitForExistence(timeout: 10), "the buyer can pay in the app")
        keep("Order - payment due")
        pay.tap()
        let confirmPay = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Pay '")).element(boundBy: 1)
        if confirmPay.waitForExistence(timeout: 5) { confirmPay.tap() } else { app.sheets.buttons.element(boundBy: 0).tap() }
        XCTAssertTrue(element("order-notice").waitForExistence(timeout: 15), "payment is taken and held")
        XCTAssertTrue(app.buttons["order-claim"].waitForExistence(timeout: 5), "a paid order can raise a problem")
        keep("Order - paid")

        // Live room: tap the host, follow, open their page; shop and costs.
        openShow("str_adaluxe")
        let host = app.buttons["stream-host"]
        XCTAssertTrue(host.waitForExistence(timeout: 15), "the host is tappable")
        keep("Live - room")
        host.tap()
        let follow = app.buttons["host-follow"]
        XCTAssertTrue(follow.waitForExistence(timeout: 10))
        follow.tap()
        let following = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Following'")).firstMatch
        XCTAssertTrue(following.waitForExistence(timeout: 10), "following the host")
        keep("Live - host sheet")
        app.buttons["host-profile"].tap()
        XCTAssertTrue(app.buttons["seller-follow"].waitForExistence(timeout: 10), "the seller page opens")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS 'Following'")).firstMatch.waitForExistence(timeout: 10), "and shows you follow them")
        keep("Seller page")

        openShow("str_adaluxe")
        let costs = app.buttons["stream-costs"]
        if costs.waitForExistence(timeout: 10) {
            costs.tap()
            XCTAssertTrue(app.staticTexts["Total"].waitForExistence(timeout: 10), "shipping and total for this buyer")
            keep("Live - shipping and total")
            app.buttons["quote-done"].tap()
            await fulfillment(of: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.buttons["quote-done"])], timeout: 5)
        }
        let shop = app.buttons["stream-shop"]
        if shop.waitForExistence(timeout: 5) {
            shop.tap()
            XCTAssertTrue(app.searchFields["Search this show"].waitForExistence(timeout: 8), "viewers can browse the show’s items")
            keep("Live - shop")
        }
    }

    func testPrizeDropReactionsRewardsAndCategoryPage() async throws {
        try await prepareLocalGateway()
        // The host starts a Prize Drop that everyone can enter.
        try await dev("/api/streams/str_adaluxe/giveaways", ["title": "QA mystery box", "followersOnly": false], as: "usr_ada")
        app.buttons["welcome-skip"].tap()
        try signIn("qa.waveb@moneymart.test")

        openShow("str_adaluxe")
        let card = element("prize-drop")
        XCTAssertTrue(card.waitForExistence(timeout: 15), "the Prize Drop shows in the live room")
        keep("Live - Prize Drop")
        app.buttons["prize-enter"].tap()
        addAddressIfAsked()
        if app.buttons["prize-enter"].waitForExistence(timeout: 5) { app.buttons["prize-enter"].tap() }
        XCTAssertTrue(app.staticTexts["Entered"].waitForExistence(timeout: 10), "a viewer with an address enters")
        keep("Live - entered")

        app.buttons["stream-react"].tap()
        XCTAssertTrue(element("reaction-bar").waitForExistence(timeout: 5), "reactions open")
        app.buttons["🔥"].tap()
        keep("Live - reactions")
        app.buttons["stream-more"].tap()
        XCTAssertTrue(app.buttons["Send a tip"].waitForExistence(timeout: 5), "viewers can tip the host")
        app.buttons["Send a tip"].tap()
        XCTAssertTrue(app.buttons["tip-send"].waitForExistence(timeout: 5))
        keep("Live - tip")
        app.buttons["Cancel"].firstMatch.tap()
        let back = app.buttons["Back"]
        if back.waitForExistence(timeout: 5) { back.tap() }

        // Rewards, messages.
        app.tabBars.buttons["Profile"].tap()
        let rewards = app.buttons["profile-rewards"]
        scrollTo(rewards)
        rewards.tap()
        XCTAssertTrue(element("rewards-coins").waitForExistence(timeout: 10), "coins and credit")
        XCTAssertTrue(element("referral-code").waitForExistence(timeout: 10) || { scrollTo(element("referral-code")); return element("referral-code").exists }(), "an invite code to share")
        keep("Rewards")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let messages = app.buttons["profile-messages"]
        scrollTo(messages)
        messages.tap()
        XCTAssertTrue(app.navigationBars["Messages"].waitForExistence(timeout: 10))
        keep("Messages")

        // Category page from Home.
        app.tabBars.buttons["Home"].tap()
        let category = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Watches'")).firstMatch
        scrollTo(category)
        if category.exists {
            category.tap()
            XCTAssertTrue(element("category-sort").waitForExistence(timeout: 10), "a category has its own page with sorting")
            keep("Category page")
        }
    }

    private func openShow(_ id: String) {
        app.tabBars.buttons["Live"].tap()
        // The Live tab may still be showing the room from before.
        if app.buttons["stream-host"].waitForExistence(timeout: 2) { return }
        let card = app.buttons["stream-card-\(id)"]
        scrollTo(card)
        card.tap()
    }

    private func addAddressIfAsked() {
        let gate = app.buttons["gate-add-address"]
        guard gate.waitForExistence(timeout: 8) else { return }
        gate.tap()
        fill("address-name", "QA Buyer")
        fill("address-line1", "1 Test Street")
        fill("address-city", "Austin")
        fill("address-region", "TX")
        fill("address-postal", "78701")
        let save = app.buttons["address-save"]
        scrollTo(save)
        save.tap()
    }

    private func dev(_ path: String, _ body: [String: Any], as user: String? = nil) async throws {
        guard let raw = ProcessInfo.processInfo.environment["MM_API_URL"], let base = URL(string: raw) else { return }
        var request = URLRequest(url: base.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let user { request.setValue(user, forHTTPHeaderField: "x-mm-user") }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await URLSession.shared.data(for: request)
    }

    /// Keeps a screenshot in the test result (for reviewing the design).
    private func keep(_ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
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
