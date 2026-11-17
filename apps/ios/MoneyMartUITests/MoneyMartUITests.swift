import XCTest

/// End-to-end flows against the configured gateway (production by default, or
/// `MM_API_URL` for a local stack started with `MM_AUTH_DEV_CODES=true`).
final class MoneyMartUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
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
        XCTAssertTrue(app.staticTexts["auth-error"].waitForExistence(timeout: 5), "invalid identifiers are refused locally")
    }
}
