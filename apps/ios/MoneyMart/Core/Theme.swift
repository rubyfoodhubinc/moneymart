import SwiftUI

/// MoneyMart design tokens — the native projection of `packages/tokens`.
///
/// Values are copied one-for-one from `@moneymart/tokens` (blueprint §2 Brand
/// Identity). If a token changes there it must change here; nothing else in the
/// app hard-codes a brand colour.
enum MM {
    enum Color {
        static let gold = SwiftUI.Color(hex: 0xF5A623)
        static let goldBright = SwiftUI.Color(hex: 0xFFC85C)
        static let goldDeep = SwiftUI.Color(hex: 0xD98A0F)
        static let goldSoft = SwiftUI.Color(hex: 0xF5A623, opacity: 0.14)
        static let goldLine = SwiftUI.Color(hex: 0xF5A623, opacity: 0.32)
        static let navy = SwiftUI.Color(hex: 0x0D1B2A)
        static let navyDeep = SwiftUI.Color(hex: 0x070F18)
        static let green = SwiftUI.Color(hex: 0x00D4A1)
        static let greenSoft = SwiftUI.Color(hex: 0x00D4A1, opacity: 0.14)
        static let charcoal = SwiftUI.Color(hex: 0x1C1C1E)
        static let error = SwiftUI.Color(hex: 0xE53E3E)
        static let errorText = SwiftUI.Color(hex: 0xFF6B6B)
        static let info = SwiftUI.Color(hex: 0x4A9DEC)

        static let surface = SwiftUI.Color(hex: 0x0A1520)
        static let raised = SwiftUI.Color(hex: 0x0F1E2E)
        static let card = SwiftUI.Color(hex: 0x12233A)
        static let glass = SwiftUI.Color(hex: 0x132234, opacity: 0.66)
        static let border = SwiftUI.Color(hex: 0xF5A623, opacity: 0.16)
        static let borderStrong = SwiftUI.Color(hex: 0xF5A623, opacity: 0.38)
        static let divider = SwiftUI.Color.white.opacity(0.08)
        static let scrim = SwiftUI.Color(hex: 0x070F18, opacity: 0.72)

        static let ink = SwiftUI.Color(hex: 0xF4F7FA)
        static let ink2 = SwiftUI.Color(hex: 0xF4F7FA, opacity: 0.72)
        static let ink3 = SwiftUI.Color(hex: 0xF4F7FA, opacity: 0.48)
    }

    enum Gradient {
        static let gold = LinearGradient(colors: [Color.gold, Color.goldBright, Color.goldDeep], startPoint: .topLeading, endPoint: .bottomTrailing)
        static let live = LinearGradient(colors: [Color.green, Color.gold], startPoint: .leading, endPoint: .trailing)
        static let navy = LinearGradient(colors: [Color.navy, Color.navyDeep], startPoint: .top, endPoint: .bottom)
        static let heroScrim = LinearGradient(
            stops: [.init(color: Color.navyDeep.opacity(0), location: 0), .init(color: Color.navyDeep.opacity(0.65), location: 0.55), .init(color: Color.navyDeep, location: 1)],
            startPoint: .top, endPoint: .bottom)
        static let sheen = LinearGradient(colors: [.white.opacity(0.07), .white.opacity(0)], startPoint: .topLeading, endPoint: .center)
    }

    enum Radius {
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 22
    }

    enum Space {
        static let screen: CGFloat = 16
        static let card: CGFloat = 12
    }

    /// Display (Clash Display → rounded system), body (Inter → system), data (Space Grotesk → monospaced digits).
    enum Font {
        static func display(_ size: CGFloat, weight: SwiftUI.Font.Weight = .bold) -> SwiftUI.Font {
            .system(size: size, weight: weight, design: .rounded)
        }
        static func body(_ size: CGFloat = 15, weight: SwiftUI.Font.Weight = .regular) -> SwiftUI.Font {
            .system(size: size, weight: weight, design: .default)
        }
        static func data(_ size: CGFloat, weight: SwiftUI.Font.Weight = .bold) -> SwiftUI.Font {
            .system(size: size, weight: weight, design: .rounded).monospacedDigit()
        }
    }
}

extension SwiftUI.Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }

    /// Parses `#RRGGBB` / `RRGGBB`. Returns nil for anything else.
    init?(hexString: String, opacity: Double = 1) {
        var text = hexString.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("#") { text.removeFirst() }
        guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
        self.init(hex: value, opacity: opacity)
    }
}
