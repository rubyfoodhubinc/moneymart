// swift-tools-version:5.9
// Amazon IVS broadcast SDK (real-time "Stages" build), fetched from Amazon's own
// distribution host and pinned by checksum. Kept out of git: the archive is 180 MB.
// To upgrade: change the version in the URL and the checksum (shasum -a 256 of the zip).
import PackageDescription

let package = Package(
    name: "AmazonIVSBroadcast",
    platforms: [.iOS(.v14)],
    products: [.library(name: "AmazonIVSBroadcast", targets: ["AmazonIVSBroadcast"])],
    targets: [
        .binaryTarget(
            name: "AmazonIVSBroadcast",
            url: "https://broadcast.live-video.net/1.48.1/AmazonIVSBroadcast-Stages.xcframework.zip",
            checksum: "9971208134c0ee63e9775001b44f1b879bc991192e47ed600eb9e1a292084b3b"
        ),
    ]
)
