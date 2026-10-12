import XCTest

/**
 * MoneyMart — the mobile flows, driven the way a person drives them.
 *
 * Every previous check on this app was structural (the bundle contains a screen) or
 * visual (a screenshot shows one). Neither exercises a tap. `simctl` has no tap
 * command and this simulator is headless, so XCUITest is the only way to prove that
 * tapping through onboarding actually reaches the app.
 *
 * Element addressing relies on the app's own accessibility labels. Buttons carry
 * their visible label as the accessible name, which was added when these tests were
 * written: without it a button announced only its role, so a screen reader read
 * "button" with no indication of what it does.
 */
final class MoneyMartFlowTests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  /**
   * Capture the screen and the element tree on failure.
   *
   * A failed flow otherwise reports only "the element never appeared", which cannot
   * distinguish a JS error screen from a slow render from a query that does not match
   * the accessibility tree.
   */
  override func tearDownWithError() throws {
    let app = XCUIApplication()
    let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    shot.name = "screen-at-failure"
    shot.lifetime = .keepAlways
    add(shot)

    let dump = XCTAttachment(string: app.debugDescription)
    dump.name = "element-tree"
    dump.lifetime = .keepAlways
    add(dump)
  }

  /// Launch and require that the app becomes interactive.
  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launch()
    XCTAssertTrue(
      app.wait(for: .runningForeground, timeout: 120),
      "the app never reached the foreground"
    )
    return app
  }

  /**
   * First element whose label matches, once it EXISTS.
   *
   * Deliberately not filtered on `isHittable`. The app is a horizontal carousel, so the
   * first slide sits at x≈26 while the second and third sit at x≈428 and x≈830 —
   * off-screen elements that XCUITest reports as not hittable. Requiring hittability
   * made every query return nothing even though the labels were present in the tree,
   * which is what the element dump finally showed.
   *
   * `tap()` on an off-screen element is handled by XCUITest itself, so existence is the
   * right gate; callers that need it on screen can scroll first.
   */
  private func waitFor(_ app: XCUIApplication, _ label: String, timeout: TimeInterval = 45) -> XCUIElement? {
    let deadline = Date().addingTimeInterval(timeout)
    let queries: [XCUIElementQuery] = [
      app.buttons, app.staticTexts, app.otherElements, app.textFields, app.cells,
    ]
    while Date() < deadline {
      for query in queries {
        let match = query[label].firstMatch
        if match.exists { return match }
      }
      usleep(300_000)
    }
    return nil
  }

  /**
   * The visible element labels, for a failure message.
   *
   * A bare "element not found" cannot be acted on; the labels say what the screen
   * actually offered, which turns a failed run into a fixable one.
   */
  private func elementDump(_ app: XCUIApplication) -> String {
    let labels = app.staticTexts.allElementsBoundByIndex.compactMap { element -> String? in
      let label = element.label
      return label.isEmpty ? nil : label
    }
    let buttons = app.buttons.allElementsBoundByIndex.compactMap { element -> String? in
      let label = element.label
      return label.isEmpty ? nil : label
    }
    return "\n  buttons: \(buttons.prefix(12).joined(separator: " | "))\n  text: \(labels.prefix(14).joined(separator: " | "))"
  }

  /**
   * Tap, bringing the element on screen first when it is off-screen.
   *
   * Both axes are attempted. The welcome carousel is a horizontal pager whose later
   * slides sit at x≈428 and x≈830, so those need a swipe; the country and sign-in
   * screens are vertical, and their Continue button can sit below the fold. Trying only
   * one axis left the app parked on a screen whose content could not be reached, which
   * showed up as an empty element dump.
   */
  private func tap(_ element: XCUIElement, in app: XCUIApplication) {
    if element.isHittable {
      element.tap()
      return
    }
    for _ in 0..<4 {
      app.swipeUp()
      if element.isHittable { element.tap(); return }
    }
    for _ in 0..<4 {
      app.swipeLeft()
      if element.isHittable { element.tap(); return }
    }
    // Last resort: a coordinate tap still delivers the touch to the element.
    element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
  }

  /**
   * The app's front door.
   *
   * Before this test, "the mobile app runs" meant a screenshot of the carousel. It did
   * not mean the Continue button worked, that the carousel advanced, or that country
   * selection led anywhere.
   */
  func testOnboardingAdvancesToSignIn() throws {
    let app = launch()

    // The welcome carousel: its headline, or its Skip control.
    let welcome = waitFor(app, "Skip", timeout: 120)
      ?? waitFor(app, "Bid in Real Time", timeout: 10)
      ?? waitFor(app, "LIVE AUCTIONS", timeout: 10)
    XCTAssertNotNil(welcome, "the welcome carousel never rendered")

    // Advance with Continue until the final slide offers Get started, or skip.
    var advanced = false
    for _ in 0..<8 {
      if let skip = waitFor(app, "Skip", timeout: 2), skip.isHittable {
        skip.tap()
        advanced = true
        break
      }
      if let getStarted = waitFor(app, "Get started", timeout: 2), getStarted.isHittable {
        getStarted.tap()
        advanced = true
        break
      }
      if let cont = waitFor(app, "Continue", timeout: 3) {
        tap(cont, in: app)
        continue
      }
      break
    }
    XCTAssertTrue(advanced, "the carousel's Continue and Skip controls were both unreachable\(elementDump(app))")

    // Country selection then offers Continue.
    let countryContinue = waitFor(app, "Continue", timeout: 45)
    XCTAssertNotNil(countryContinue, "country selection never offered Continue\(elementDump(app))")
    if let countryContinue { tap(countryContinue, in: app) }

    /**
     * And that leads to sign-in.
     *
     * The labels are the screen's OWN copy — "Welcome back" and "Sign in" — rather
     * than a guess at what they might be, which is what the first version asserted and
     * why it failed on a screen that had rendered perfectly.
     */
    let signIn = waitFor(app, "Sign in", timeout: 45)
      ?? waitFor(app, "Welcome back", timeout: 10)
      ?? waitFor(app, "Sign up", timeout: 10)
    XCTAssertNotNil(signIn, "sign-in never rendered after country selection\(elementDump(app))")
  }

  /**
   * A signed-out user must still be able to look at lots.
   *
   * No account means no server-side session. If browsing required one the app would be
   * unusable before sign-up, and no API-level test would notice.
   */
  func testAppShowsContentSignedOut() throws {
    let app = launch()

    // Past onboarding if it is showing.
    if let skip = waitFor(app, "Skip", timeout: 25), skip.isHittable {
      skip.tap()
      if let cont = waitFor(app, "Continue", timeout: 20) { tap(cont, in: app) }
    }

    // The feed is a vertical scroll; its headings may sit below the fold.
    var content = waitFor(app, "For You", timeout: 90)
      ?? waitFor(app, "Live creators", timeout: 10)
    for _ in 0..<3 where content == nil {
      app.swipeUp()
      content = waitFor(app, "Recommended for you", timeout: 5)
        ?? waitFor(app, "Live creators", timeout: 3)
    }
    XCTAssertNotNil(content, "no browsable content rendered\(elementDump(app))")
  }
}
