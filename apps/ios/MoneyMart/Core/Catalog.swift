import Foundation
import NaturalLanguage

/// Categories, condition grades and markets — mirrors `@moneymart/tokens`.
enum Catalog {
    struct Subcategory: Identifiable, Hashable, Sendable {
        let id: String
        let label: LocalizedStringResource

        static func == (a: Self, b: Self) -> Bool { a.id == b.id }
        func hash(into hasher: inout Hasher) { hasher.combine(id) }
    }

    struct Category: Identifiable, Hashable, Sendable {
        let id: String
        let label: LocalizedStringResource
        let symbol: String
        var subcategories: [Subcategory] = []

        static func == (a: Self, b: Self) -> Bool { a.id == b.id }
        func hash(into hasher: inout Hasher) { hasher.combine(id) }
    }

    /// Generated from `categoryTree` in `@moneymart/tokens` — keep ids in step with the server.
    static let categories: [Category] = [
        .init(id: "sneakers", label: "Sneakers & Shoes", symbol: "shoe.fill", subcategories: [
            .init(id: "sneakers.sneakers", label: "Sneakers"),
            .init(id: "sneakers.boots", label: "Boots"),
            .init(id: "sneakers.dress", label: "Dress Shoes"),
            .init(id: "sneakers.heels", label: "Heels & Flats"),
            .init(id: "sneakers.kids", label: "Kids' Shoes"),
            .init(id: "sneakers.sandals", label: "Sandals & Slides"),
        ]),
        .init(id: "watches", label: "Watches", symbol: "watch.analog", subcategories: [
            .init(id: "watches.luxury", label: "Luxury Watches"),
            .init(id: "watches.vintage", label: "Vintage Watches"),
            .init(id: "watches.everyday", label: "Everyday Watches"),
            .init(id: "watches.smart", label: "Smartwatches"),
            .init(id: "watches.parts", label: "Straps & Parts"),
        ]),
        .init(id: "jewelry", label: "Jewelry", symbol: "sparkles", subcategories: [
            .init(id: "jewelry.fine", label: "Fine Jewelry"),
            .init(id: "jewelry.fashion", label: "Fashion Jewelry"),
            .init(id: "jewelry.vintage", label: "Vintage Jewelry"),
            .init(id: "jewelry.mens", label: "Men's Jewelry"),
            .init(id: "jewelry.gemstones", label: "Loose Gemstones"),
        ]),
        .init(id: "art", label: "Art", symbol: "paintpalette.fill", subcategories: [
            .init(id: "art.paintings", label: "Paintings"),
            .init(id: "art.prints", label: "Prints & Posters"),
            .init(id: "art.sculpture", label: "Sculpture"),
            .init(id: "art.photography", label: "Photography"),
            .init(id: "art.digital", label: "Digital & Mixed Media"),
        ]),
        .init(id: "collectibles", label: "Collectibles", symbol: "trophy.fill", subcategories: [
            .init(id: "collectibles.figurines", label: "Figurines"),
            .init(id: "collectibles.pins", label: "Pins & Patches"),
            .init(id: "collectibles.memorabilia", label: "Pop Culture Memorabilia"),
            .init(id: "collectibles.stamps", label: "Stamps"),
            .init(id: "collectibles.other", label: "Other Collectibles"),
        ]),
        .init(id: "cards", label: "Trading Card Games", symbol: "rectangle.portrait.on.rectangle.portrait.fill", subcategories: [
            .init(id: "cards.singles", label: "Singles"),
            .init(id: "cards.sealed", label: "Sealed Boxes & Packs"),
            .init(id: "cards.graded", label: "Graded Cards"),
            .init(id: "cards.breaks", label: "Breaks"),
            .init(id: "cards.supplies", label: "Card Supplies"),
        ]),
        .init(id: "fashion", label: "Fashion", symbol: "tshirt.fill", subcategories: [
            .init(id: "fashion.womens", label: "Women's Clothing"),
            .init(id: "fashion.mens", label: "Men's Clothing"),
            .init(id: "fashion.streetwear", label: "Streetwear"),
            .init(id: "fashion.vintage", label: "Vintage Clothing"),
            .init(id: "fashion.plus", label: "Plus & Big & Tall"),
            .init(id: "fashion.activewear", label: "Activewear"),
        ]),
        .init(id: "electronics", label: "Electronics", symbol: "headphones", subcategories: [
            .init(id: "electronics.phones", label: "Phones & Tablets"),
            .init(id: "electronics.computers", label: "Laptops & Computers"),
            .init(id: "electronics.audio", label: "Audio & Headphones"),
            .init(id: "electronics.cameras", label: "Cameras & Photography"),
            .init(id: "electronics.smarthome", label: "Smart Home"),
            .init(id: "electronics.tv", label: "TV & Video"),
            .init(id: "electronics.accessories", label: "Accessories & Chargers"),
        ]),
        .init(id: "vehicles", label: "Vehicles & Parts", symbol: "car.fill", subcategories: [
            .init(id: "vehicles.cars", label: "Cars & Trucks"),
            .init(id: "vehicles.motorcycles", label: "Motorcycles"),
            .init(id: "vehicles.parts", label: "Parts & Accessories"),
            .init(id: "vehicles.tools", label: "Garage & Shop"),
        ]),
        .init(id: "antiques", label: "Antiques & Vintage", symbol: "clock.fill", subcategories: [
            .init(id: "antiques.furniture", label: "Antique Furniture"),
            .init(id: "antiques.decor", label: "Vintage Decor"),
            .init(id: "antiques.glass", label: "Glass & Pottery"),
            .init(id: "antiques.silver", label: "Silver & Metalware"),
            .init(id: "antiques.textiles", label: "Textiles & Rugs"),
        ]),
        .init(id: "sports-cards", label: "Sports Cards", symbol: "basketball.fill", subcategories: [
            .init(id: "sports-cards.basketball", label: "Basketball"),
            .init(id: "sports-cards.football", label: "Football"),
            .init(id: "sports-cards.baseball", label: "Baseball"),
            .init(id: "sports-cards.soccer", label: "Soccer"),
            .init(id: "sports-cards.other", label: "Other Sports"),
            .init(id: "sports-cards.breaks", label: "Breaks"),
        ]),
        .init(id: "sports-memorabilia", label: "Sports Memorabilia", symbol: "football.fill", subcategories: [
            .init(id: "sports-memorabilia.autographs", label: "Autographs"),
            .init(id: "sports-memorabilia.jerseys", label: "Jerseys"),
            .init(id: "sports-memorabilia.game-used", label: "Game-Used"),
            .init(id: "sports-memorabilia.fan-gear", label: "Fan Gear"),
        ]),
        .init(id: "coins", label: "Coins & Currency", symbol: "centsign.circle.fill", subcategories: [
            .init(id: "coins.us", label: "US Coins"),
            .init(id: "coins.world", label: "World Coins"),
            .init(id: "coins.ancient", label: "Ancient Coins"),
            .init(id: "coins.paper", label: "Paper Money"),
            .init(id: "coins.graded", label: "Graded Coins"),
        ]),
        .init(id: "bullion", label: "Precious Metals", symbol: "square.stack.3d.up.fill", subcategories: [
            .init(id: "bullion.gold", label: "Gold"),
            .init(id: "bullion.silver", label: "Silver"),
            .init(id: "bullion.platinum", label: "Platinum & Palladium"),
            .init(id: "bullion.rounds", label: "Rounds & Bars"),
        ]),
        .init(id: "video-games", label: "Video Games", symbol: "gamecontroller.fill", subcategories: [
            .init(id: "video-games.consoles", label: "Consoles"),
            .init(id: "video-games.games", label: "Games"),
            .init(id: "video-games.retro", label: "Retro Gaming"),
            .init(id: "video-games.accessories", label: "Controllers & Accessories"),
        ]),
        .init(id: "toys", label: "Toys & Hobbies", symbol: "teddybear.fill", subcategories: [
            .init(id: "toys.figures", label: "Action Figures"),
            .init(id: "toys.dolls", label: "Dolls"),
            .init(id: "toys.designer", label: "Designer & Blind-Box Toys"),
            .init(id: "toys.plush", label: "Plush"),
            .init(id: "toys.building", label: "Building Sets"),
            .init(id: "toys.diecast", label: "Diecast"),
            .init(id: "toys.rc", label: "RC Vehicles"),
            .init(id: "toys.models", label: "Models & Kits"),
            .init(id: "toys.board-games", label: "Board Games & Puzzles"),
        ]),
        .init(id: "comics", label: "Comics & Manga", symbol: "books.vertical.fill", subcategories: [
            .init(id: "comics.comics", label: "Comic Books"),
            .init(id: "comics.manga", label: "Manga"),
            .init(id: "comics.graphic-novels", label: "Graphic Novels"),
            .init(id: "comics.anime", label: "Anime Merchandise"),
            .init(id: "comics.graded", label: "Graded Comics"),
        ]),
        .init(id: "books-media", label: "Books & Movies", symbol: "book.fill", subcategories: [
            .init(id: "books-media.books", label: "Books"),
            .init(id: "books-media.rare-books", label: "Rare & Signed Books"),
            .init(id: "books-media.movies", label: "Movies & TV"),
            .init(id: "books-media.magazines", label: "Magazines"),
        ]),
        .init(id: "music", label: "Music & Instruments", symbol: "guitars.fill", subcategories: [
            .init(id: "music.vinyl", label: "Vinyl Records"),
            .init(id: "music.cds", label: "CDs & Cassettes"),
            .init(id: "music.instruments", label: "Instruments"),
            .init(id: "music.audio-gear", label: "Pro Audio & DJ"),
            .init(id: "music.memorabilia", label: "Music Memorabilia"),
        ]),
        .init(id: "bags", label: "Bags & Accessories", symbol: "handbag.fill", subcategories: [
            .init(id: "bags.handbags", label: "Handbags"),
            .init(id: "bags.luxury", label: "Luxury Bags"),
            .init(id: "bags.wallets", label: "Wallets"),
            .init(id: "bags.sunglasses", label: "Sunglasses"),
            .init(id: "bags.hats", label: "Hats & Scarves"),
        ]),
        .init(id: "beauty", label: "Beauty", symbol: "comb.fill", subcategories: [
            .init(id: "beauty.makeup", label: "Makeup"),
            .init(id: "beauty.skincare", label: "Skincare"),
            .init(id: "beauty.fragrance", label: "Fragrance"),
            .init(id: "beauty.hair", label: "Hair Care"),
            .init(id: "beauty.nails", label: "Nails"),
            .init(id: "beauty.tools", label: "Beauty Tools"),
        ]),
        .init(id: "health", label: "Health & Wellness", symbol: "leaf.fill", subcategories: [
            .init(id: "health.supplements", label: "Supplements"),
            .init(id: "health.fitness", label: "Fitness Equipment"),
            .init(id: "health.personal-care", label: "Personal Care"),
        ]),
        .init(id: "food", label: "Food & Drink", symbol: "fork.knife", subcategories: [
            .init(id: "food.snacks", label: "Candy & Snacks"),
            .init(id: "food.coffee-tea", label: "Coffee & Tea"),
            .init(id: "food.sauces", label: "Sauces & Condiments"),
            .init(id: "food.baked", label: "Baked Goods"),
            .init(id: "food.specialty", label: "Specialty Food"),
            .init(id: "food.drinks", label: "Soda & Drinks"),
            .init(id: "food.meat-seafood", label: "Meat & Seafood"),
            .init(id: "food.international", label: "International Snacks"),
            .init(id: "food.other", label: "Other Food & Drink"),
        ]),
        .init(id: "home", label: "Home & Garden", symbol: "sofa.fill", subcategories: [
            .init(id: "home.decor", label: "Home Decor"),
            .init(id: "home.kitchen", label: "Kitchen & Dining"),
            .init(id: "home.furniture", label: "Furniture"),
            .init(id: "home.bedding", label: "Bedding & Bath"),
            .init(id: "home.garden", label: "Garden & Patio"),
            .init(id: "home.candles", label: "Candles & Fragrance"),
        ]),
        .init(id: "appliances", label: "Home Appliances", symbol: "washer.fill", subcategories: [
            .init(id: "appliances.kitchen", label: "Kitchen Appliances"),
            .init(id: "appliances.cleaning", label: "Cleaning"),
            .init(id: "appliances.climate", label: "Heating & Cooling"),
            .init(id: "appliances.laundry", label: "Laundry"),
        ]),
        .init(id: "tools", label: "Tools & Hardware", symbol: "wrench.and.screwdriver.fill", subcategories: [
            .init(id: "tools.power", label: "Power Tools"),
            .init(id: "tools.hand", label: "Hand Tools"),
            .init(id: "tools.outdoor-power", label: "Outdoor Power Equipment"),
            .init(id: "tools.storage", label: "Tool Storage"),
            .init(id: "tools.workwear", label: "Workwear & Safety"),
        ]),
        .init(id: "crafts", label: "Arts & Crafts", symbol: "scissors", subcategories: [
            .init(id: "crafts.supplies", label: "Craft Supplies"),
            .init(id: "crafts.yarn-fabric", label: "Yarn & Fabric"),
            .init(id: "crafts.handmade", label: "Handmade Goods"),
            .init(id: "crafts.scrapbooking", label: "Scrapbooking & Stamps"),
        ]),
        .init(id: "crystals", label: "Rocks & Crystals", symbol: "diamond.fill", subcategories: [
            .init(id: "crystals.crystals", label: "Crystals"),
            .init(id: "crystals.minerals", label: "Mineral Specimens"),
            .init(id: "crystals.fossils", label: "Fossils"),
            .init(id: "crystals.jewelry", label: "Crystal Jewelry"),
        ]),
        .init(id: "outdoors", label: "Outdoors & Sports", symbol: "tent.fill", subcategories: [
            .init(id: "outdoors.camping", label: "Camping & Hiking"),
            .init(id: "outdoors.fishing", label: "Fishing"),
            .init(id: "outdoors.hunting", label: "Hunting"),
            .init(id: "outdoors.cycling", label: "Cycling"),
            .init(id: "outdoors.golf", label: "Golf"),
            .init(id: "outdoors.team-sports", label: "Team Sports Gear"),
            .init(id: "outdoors.winter", label: "Winter Sports"),
        ]),
        .init(id: "baby-kids", label: "Baby & Kids", symbol: "stroller.fill", subcategories: [
            .init(id: "baby-kids.gear", label: "Baby Gear"),
            .init(id: "baby-kids.clothing", label: "Kids Clothing"),
            .init(id: "baby-kids.toys", label: "Baby & Kids Toys"),
            .init(id: "baby-kids.nursery", label: "Nursery"),
        ]),
        .init(id: "pets", label: "Pets", symbol: "pawprint.fill", subcategories: [
            .init(id: "pets.dogs", label: "Dog Supplies"),
            .init(id: "pets.cats", label: "Cat Supplies"),
            .init(id: "pets.aquarium", label: "Aquarium"),
            .init(id: "pets.small-pets", label: "Small Pets & Birds"),
        ]),
        .init(id: "wholesale", label: "Wholesale & Liquidation", symbol: "shippingbox.fill", subcategories: [
            .init(id: "wholesale.pallets", label: "Pallets"),
            .init(id: "wholesale.lots", label: "Bulk Lots"),
            .init(id: "wholesale.returns", label: "Customer Returns"),
            .init(id: "wholesale.overstock", label: "Overstock"),
        ]),
        .init(id: "estate", label: "Estate & Storage Finds", symbol: "key.fill", subcategories: [
            .init(id: "estate.storage-units", label: "Storage Units"),
            .init(id: "estate.estate-lots", label: "Estate Lots"),
            .init(id: "estate.mystery", label: "Mystery Boxes"),
        ]),
        .init(id: "everything-else", label: "Everything Else", symbol: "sparkle", subcategories: [
            .init(id: "everything-else.gift-cards", label: "Gift Cards & Vouchers"),
            .init(id: "everything-else.tickets", label: "Tickets & Experiences"),
            .init(id: "everything-else.services", label: "Services"),
            .init(id: "everything-else.other", label: "Other"),
        ]),
    ]

    static func category(_ id: String?) -> Category {
        categories.first { $0.id == id } ?? categories.first { $0.id == "collectibles" }!
    }

    /// The subcategory with `id`, searched across every category.
    static func subcategory(_ id: String?) -> Subcategory? {
        guard let id else { return nil }
        return categories.lazy.flatMap(\.subcategories).first { $0.id == id }
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
