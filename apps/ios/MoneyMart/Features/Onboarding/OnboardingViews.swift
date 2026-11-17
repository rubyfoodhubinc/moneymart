import SwiftUI

struct SplashView: View {
    @State private var glow = false

    var body: some View {
        ZStack {
            MM.Gradient.navy.ignoresSafeArea()
            RadialGradient(colors: [MM.Color.gold.opacity(glow ? 0.28 : 0.12), .clear], center: .center, startRadius: 0, endRadius: 320)
                .ignoresSafeArea()
            VStack(spacing: 18) {
                BrandWordmark(size: 40)
                Text("Bid. Stream. Win.").font(MM.Font.body(15, weight: .medium)).foregroundStyle(MM.Color.ink2)
                ProgressView().tint(MM.Color.gold).padding(.top, 10)
            }
        }
        .onAppear { withAnimation(.easeInOut(duration: 1.6).repeatForever()) { glow = true } }
    }
}

struct BrandWordmark: View {
    var size: CGFloat = 28

    var body: some View {
        HStack(spacing: size * 0.25) {
            ZStack {
                RoundedRectangle(cornerRadius: size * 0.3, style: .continuous).fill(MM.Gradient.gold)
                Text("M").font(.system(size: size * 0.72, weight: .black, design: .rounded)).foregroundStyle(MM.Color.navy)
            }
            .frame(width: size * 1.25, height: size * 1.25)
            .shadow(color: MM.Color.gold.opacity(0.45), radius: size * 0.4)
            (Text("Money").foregroundStyle(MM.Color.ink) + Text("Mart").foregroundStyle(MM.Color.gold))
                .font(.system(size: size, weight: .bold, design: .rounded))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("MoneyMart")
    }
}

struct WelcomeView: View {
    var onFinish: () -> Void
    @State private var page = 0

    private struct Slide: Identifiable {
        let id: Int
        let symbol: String
        let title: LocalizedStringKey
        let body: LocalizedStringKey
        let tint: Color
    }

    private let slides: [Slide] = [
        .init(id: 0, symbol: "dot.radiowaves.left.and.right", title: "Live shows, real bids",
              body: "Join live auction channels and teleshopping streams from creators, collectors and brands — and bid in real time.", tint: MM.Color.green),
        .init(id: 1, symbol: "hammer.fill", title: "Every kind of sale",
              body: "Live auctions, timed auction-house sales, Buy It Now and Make an Offer — sneakers to supercars.", tint: MM.Color.gold),
        .init(id: 2, symbol: "lock.shield.fill", title: "Protected by escrow",
              body: "Your payment is held until the item arrives as described. Sellers are verified, lots are authenticated.", tint: MM.Color.info),
        .init(id: 3, symbol: "globe", title: "Your language, your currency",
              body: "MoneyMart detects your language and translates listings and chat, with prices in your local currency.", tint: MM.Color.goldBright),
    ]

    var body: some View {
        ZStack {
            MM.Gradient.navy.ignoresSafeArea()
            VStack(spacing: 24) {
                HStack {
                    BrandWordmark(size: 22)
                    Spacer()
                    Button("Skip", action: onFinish).font(MM.Font.body(15, weight: .semibold)).foregroundStyle(MM.Color.ink2)
                        .accessibilityIdentifier("welcome-skip")
                }
                .padding(.horizontal, 20)

                TabView(selection: $page) {
                    ForEach(slides) { slide in
                        VStack(spacing: 28) {
                            Spacer()
                            ZStack {
                                Circle().fill(slide.tint.opacity(0.12)).frame(width: 220, height: 220)
                                Circle().stroke(slide.tint.opacity(0.35), lineWidth: 1).frame(width: 280, height: 280)
                                Image(systemName: slide.symbol).font(.system(size: 76, weight: .semibold)).foregroundStyle(slide.tint)
                                    .symbolEffect(.pulse, options: .repeating)
                            }
                            VStack(spacing: 12) {
                                Text(slide.title).font(MM.Font.display(30)).foregroundStyle(MM.Color.ink).multilineTextAlignment(.center)
                                Text(slide.body).font(MM.Font.body(16)).foregroundStyle(MM.Color.ink2).multilineTextAlignment(.center)
                                    .padding(.horizontal, 28)
                            }
                            Spacer()
                        }
                        .tag(slide.id)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .always))

                Button(page == slides.count - 1 ? "Start exploring" : "Continue") {
                    if page == slides.count - 1 { onFinish() } else { withAnimation { page += 1 } }
                }
                .buttonStyle(.gold)
                .padding(.horizontal, 20)
                .padding(.bottom, 12)
                .accessibilityIdentifier("welcome-continue")
            }
        }
    }
}
