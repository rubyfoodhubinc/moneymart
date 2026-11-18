import SwiftUI
import UIKit

/// The server's generated artwork is a small SVG (gradient, guide rings, initials,
/// gold progress rule). iOS cannot decode SVG at runtime, so rather than hosting a
/// web view per card this reads the few parameters out of the markup and draws the
/// same composition natively — crisp at any size and free to scroll.
struct SVGArt: Equatable, Sendable {
    var stops: [Color]
    var angle: Double
    var initials: String?
    var progress: Double?
    var rings: Bool

    static func parse(dataURI: String) -> SVGArt? {
        guard dataURI.hasPrefix("data:image/svg+xml") else { return nil }
        let payload = dataURI.split(separator: ",", maxSplits: 1).last.map(String.init) ?? ""
        let svg = dataURI.contains(";base64,")
            ? (Data(base64Encoded: payload).flatMap { String(data: $0, encoding: .utf8) } ?? "")
            : (payload.removingPercentEncoding ?? payload)
        guard svg.contains("<svg") else { return nil }

        let firstGradient = svg.range(of: "</linearGradient>").map { String(svg[..<$0.lowerBound]) } ?? svg
        let stops = matches(#"stop-color="(#[0-9A-Fa-f]{6})""#, in: firstGradient).compactMap { Color(hexString: $0) }
        let angle = matches(#"rotate\((-?[0-9.]+)"#, in: firstGradient).first.flatMap(Double.init) ?? 135
        let initials = matches(#"<text[^>]*>([^<]{1,4})</text>"#, in: svg).first
        var progress: Double?
        if let width = matches(#"<rect x="0" y="936" width="([0-9.]+)" height="6""#, in: svg).first.flatMap(Double.init) {
            progress = width / 1000
        }
        return SVGArt(stops: stops.isEmpty ? [MM.Color.navy, MM.Color.navyDeep] : stops,
                      angle: angle, initials: initials, progress: progress, rings: svg.contains("<circle"))
    }

    private static func matches(_ pattern: String, in text: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(text.startIndex..., in: text)
        return regex.matches(in: text, range: range).compactMap { match in
            guard match.numberOfRanges > 1, let r = Range(match.range(at: 1), in: text) else { return nil }
            return String(text[r])
        }
    }
}

/// Decoded-image cache shared by every artwork view.
final class ImageCache: @unchecked Sendable {
    static let shared = ImageCache()
    private let cache = NSCache<NSString, UIImage>()
    init() { cache.countLimit = 300 }
    func image(_ key: String) -> UIImage? { cache.object(forKey: key as NSString) }
    func store(_ image: UIImage, _ key: String) { cache.setObject(image, forKey: key as NSString) }
}

/// Renders any image string the API returns: generated SVG artwork, base64 photos
/// uploaded by sellers, or remote URLs.
struct ArtworkView: View {
    let source: String?
    var symbol: String = "photo"
    var initialsSize: CGFloat = 0.22

    @State private var remote: UIImage?

    var body: some View {
        GeometryReader { proxy in
            content(size: proxy.size)
                .frame(width: proxy.size.width, height: proxy.size.height)
                .clipped()
        }
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private func content(size: CGSize) -> some View {
        if let source, let art = SVGArt.parse(dataURI: source) {
            generated(art, size: size)
        } else if let image = bitmap() {
            Image(uiImage: image).resizable().scaledToFill()
        } else if let source, let url = URL(string: source), url.scheme?.hasPrefix("http") == true {
            ZStack {
                placeholder
                if let remote { Image(uiImage: remote).resizable().scaledToFill().transition(.opacity) }
            }
            .task(id: source) { await load(url, key: source) }
        } else {
            placeholder
        }
    }

    private var placeholder: some View {
        ZStack {
            MM.Gradient.navy
            Image(systemName: symbol).font(.system(size: 28, weight: .semibold)).foregroundStyle(MM.Color.goldLine)
        }
    }

    private func generated(_ art: SVGArt, size: CGSize) -> some View {
        let radians = (art.angle - 90) * .pi / 180
        let dx = cos(radians) / 2, dy = sin(radians) / 2
        let side = min(size.width, size.height)
        return ZStack(alignment: .bottomLeading) {
            LinearGradient(colors: art.stops,
                           startPoint: UnitPoint(x: 0.5 - dx, y: 0.5 - dy),
                           endPoint: UnitPoint(x: 0.5 + dx, y: 0.5 + dy))
            RadialGradient(colors: [MM.Color.gold.opacity(0.3), .clear], center: UnitPoint(x: 0.5, y: 0.42), startRadius: 0, endRadius: side * 0.62)
            if art.rings {
                ForEach([0.236, 0.328], id: \.self) { r in
                    Circle().stroke(MM.Color.gold.opacity(0.3), lineWidth: max(1, side * 0.002))
                        .frame(width: side * r * 2, height: side * r * 2)
                        .position(x: size.width / 2, y: size.height * 0.43)
                }
            }
            if let initials = art.initials {
                Text(initials)
                    .font(.system(size: side * initialsSize, weight: .bold, design: .rounded))
                    .tracking(side * 0.006)
                    .foregroundStyle(.white.opacity(art.rings ? 0.12 : 0.95))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            if let progress = art.progress {
                VStack(spacing: 0) {
                    Spacer()
                    ZStack(alignment: .topLeading) {
                        MM.Color.navyDeep.opacity(0.72).frame(height: size.height * 0.064)
                        MM.Gradient.gold.frame(width: size.width * progress, height: max(2, size.height * 0.006))
                    }
                }
            }
        }
    }

    private func bitmap() -> UIImage? {
        guard let source, source.hasPrefix("data:image/"), source.contains(";base64,") else { return nil }
        if let cached = ImageCache.shared.image(source) { return cached }
        guard let payload = source.split(separator: ",", maxSplits: 1).last,
              let data = Data(base64Encoded: String(payload)), let image = UIImage(data: data) else { return nil }
        ImageCache.shared.store(image, source)
        return image
    }

    private func load(_ url: URL, key: String) async {
        if let cached = ImageCache.shared.image(key) { remote = cached; return }
        guard let (data, _) = try? await URLSession.shared.data(from: url), let image = UIImage(data: data) else { return }
        ImageCache.shared.store(image, key)
        withAnimation(.easeOut(duration: 0.25)) { remote = image }
    }
}
