import Foundation
import Observation

/// Countries MoneyMart trades in (open for buying / selling, set by the Owner) and today's exchange rates.
@MainActor
@Observable
final class Markets {
    static let shared = Markets()

    struct Country: Codable, Hashable, Identifiable, Sendable {
        var id: String { code }
        let code: String
        let name: String
        let flag: String
        let currency: String
        var currencySymbol: String?
        var buy: Bool
        var sell: Bool
    }

    private struct Response: Codable, Sendable {
        var countries: [Country]
        var usdPerUnit: [String: Double]
        var ratesUpdatedAt: String?
    }

    private(set) var countries: [Country] = Catalog.markets.map { Country(code: $0.countryCode, name: $0.country, flag: $0.flag, currency: $0.currency, buy: true, sell: true) }
    private(set) var usdPerUnit: [String: Double] = ["USD": 1, "NGN": 1 / 1580, "GBP": 1.27, "CAD": 0.73, "EUR": 1.08, "KES": 1 / 129, "GHS": 1 / 15.4, "ZAR": 0.055]
    private(set) var ratesUpdatedAt: Date?

    var buyingCountries: [Country] { countries.filter(\.buy) }
    var sellingCountries: [Country] { countries.filter(\.sell) }
    func country(_ code: String?) -> Country? { countries.first { $0.code == code?.uppercased() } }

    func load() async {
        guard let response: Response = try? await APIClient.shared.get("/api/markets") else { return }
        countries = response.countries
        usdPerUnit.merge(response.usdPerUnit) { _, new in new }
        ratesUpdatedAt = response.ratesUpdatedAt.flatMap(ISODate.parse)
    }

    /// Amount in another currency at today's rate, or nil when a rate is missing.
    func convert(_ amount: Double, from: String, to: String) -> Double? {
        guard from != to else { return amount }
        guard let a = usdPerUnit[from], let b = usdPerUnit[to], b > 0 else { return nil }
        return amount * a / b
    }

    /// "≈ $46" when the viewer's currency differs from the listing's; nil when they match.
    func approx(_ amount: Double, from: String, to viewer: String?) -> String? {
        guard let viewer, viewer != from, let value = convert(amount, from: from, to: viewer) else { return nil }
        return "≈ " + Format.money(value.rounded(), viewer, compact: value >= 10_000)
    }
}
