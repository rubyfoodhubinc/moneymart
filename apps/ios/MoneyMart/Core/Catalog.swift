import Foundation
import NaturalLanguage

/// Categories, condition grades and markets — mirrors `@moneymart/tokens`.
enum Catalog {
    struct Category: Identifiable, Hashable, Sendable {
        let id: String
        let label: LocalizedStringResource
        let symbol: String

        static func == (a: Self, b: Self) -> Bool { a.id == b.id }
        func hash(into hasher: inout Hasher) { hasher.combine(id) }
    }

    static let categories: [Category] = [
        .init(id: "sneakers", label: "Sneakers", symbol: "shoe.fill"),
        .init(id: "watches", label: "Watches", symbol: "watch.analog"),
        .init(id: "jewelry", label: "Jewelry", symbol: "sparkles"),
        .init(id: "art", label: "Art", symbol: "paintpalette.fill"),
        .init(id: "collectibles", label: "Collectibles", symbol: "trophy.fill"),
        .init(id: "cards", label: "Trading Cards", symbol: "rectangle.portrait.on.rectangle.portrait.fill"),
        .init(id: "fashion", label: "Fashion", symbol: "tshirt.fill"),
        .init(id: "electronics", label: "Electronics", symbol: "headphones"),
        .init(id: "vehicles", label: "Vehicles", symbol: "car.fill"),
        .init(id: "antiques", label: "Antiques", symbol: "clock.fill"),
    ]

    static func category(_ id: String?) -> Category {
        categories.first { $0.id == id } ?? categories[4]
    }

    struct Condition: Identifiable, Hashable, Sendable {
        let id: String
        let label: LocalizedStringResource
        let hint: LocalizedStringResource

        static func == (a: Self, b: Self) -> Bool { a.id == b.id }
        func hash(into hasher: inout Hasher) { hasher.combine(id) }
    }

    static let conditions: [Condition] = [
        .init(id: "new", label: "New", hint: "Unused, sealed, or in original packaging."),
        .init(id: "like_new", label: "Like New", hint: "Used once or twice; no visible wear."),
        .init(id: "good", label: "Good", hint: "Light wear consistent with careful use."),
        .init(id: "fair", label: "Fair", hint: "Visible wear; fully functional."),
        .init(id: "parts", label: "Parts Only", hint: "Not functional; sold for parts or repair."),
    ]

    static func condition(_ id: String?) -> Condition { conditions.first { $0.id == id } ?? conditions[2] }

    struct Market: Identifiable, Hashable, Sendable {
        var id: String { currency }
        let currency: String
        let country: String
        let countryCode: String
        let flag: String
        let rails: String
    }

    static let markets: [Market] = [
        .init(currency: "USD", country: "United States", countryCode: "US", flag: "🇺🇸", rails: "Stripe · PayPal · Apple Pay"),
        .init(currency: "NGN", country: "Nigeria", countryCode: "NG", flag: "🇳🇬", rails: "Paystack · Flutterwave · Bank transfer"),
        .init(currency: "GBP", country: "United Kingdom", countryCode: "GB", flag: "🇬🇧", rails: "Stripe · PayPal · Apple Pay"),
        .init(currency: "CAD", country: "Canada", countryCode: "CA", flag: "🇨🇦", rails: "Stripe · Interac · PayPal"),
        .init(currency: "EUR", country: "Eurozone", countryCode: "FR", flag: "🇪🇺", rails: "Stripe · PayPal · SEPA"),
        .init(currency: "KES", country: "Kenya", countryCode: "KE", flag: "🇰🇪", rails: "M-Pesa · Flutterwave"),
        .init(currency: "GHS", country: "Ghana", countryCode: "GH", flag: "🇬🇭", rails: "Paystack · Mobile money"),
        .init(currency: "ZAR", country: "South Africa", countryCode: "ZA", flag: "🇿🇦", rails: "Paystack · Card"),
    ]

    /// Buyer's premium per §10: 20% luxury, 15% standard; Pro members pay 15% / 10%.
    static let luxury: Set<String> = ["watches", "jewelry", "art", "vehicles"]
    static func premiumRate(category: String, pro: Bool) -> Double {
        let lux = luxury.contains(category)
        switch (lux, pro) {
        case (true, false): return 0.20
        case (true, true): return 0.15
        case (false, false): return 0.15
        case (false, true): return 0.10
        }
    }
}

enum Format {
    static func money(_ amount: Double, _ currency: String, compact: Bool = false) -> String {
        var style = FloatingPointFormatStyle<Double>.Currency(code: currency)
        style = style.precision(.fractionLength(amount.rounded() == amount || compact ? 0 : 2))
        if compact && amount >= 10_000 {
            return amount.formatted(.currency(code: currency).notation(.compactName).precision(.fractionLength(0...1)))
        }
        return amount.formatted(style)
    }

    static func count(_ value: Int) -> String {
        value.formatted(.number.notation(.compactName).precision(.fractionLength(0...1)))
    }

    /// `2d 4h`, `3h 12m`, `04:59`, or nil once ended.
    static func countdown(to end: Date, now: Date = .now) -> String? {
        let remaining = Int(end.timeIntervalSince(now))
        guard remaining > 0 else { return nil }
        let d = remaining / 86_400, h = (remaining % 86_400) / 3_600, m = (remaining % 3_600) / 60, s = remaining % 60
        if d > 0 { return "\(d)d \(h)h" }
        if h > 0 { return "\(h)h \(m)m" }
        return String(format: "%02d:%02d", m, s)
    }

    static func relative(_ iso: String) -> String {
        guard let date = ISODate.parse(iso) else { return "" }
        return date.formatted(.relative(presentation: .named))
    }
}

/// On-device language identification for listings and live chat (no network).
enum LanguageDetector {
    /// BCP-47 code of the dominant language, or nil when the text is too short to tell.
    static func detect(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // Short chat lines ("Reserve met?") are ambiguous across languages; only offer
        // translation when there is enough text for a confident call.
        guard trimmed.count >= 18, trimmed.split(separator: " ").count >= 3 else { return nil }
        let recognizer = NLLanguageRecognizer()
        recognizer.processString(trimmed)
        guard let (language, confidence) = recognizer.languageHypotheses(withMaximum: 1).first, confidence >= 0.8 else { return nil }
        return language.rawValue
    }

    /// True when `text` is in a language other than the device's preferred one.
    static func isForeign(_ text: String, preferred: String = Locale.preferredLanguages.first ?? "en") -> Bool {
        guard let detected = detect(text) else { return false }
        return Locale.Language(identifier: detected).languageCode != Locale.Language(identifier: preferred).languageCode
    }

    static func displayName(_ code: String) -> String {
        Locale.current.localizedString(forLanguageCode: code) ?? code
    }
}
