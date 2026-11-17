# MoneyMart — native iOS (SwiftUI)

The native iPhone/iPad client for MoneyMart. It talks to the same API and realtime
gateway as the web, Expo and TV clients (`services/api`), so a bid from this app is
indistinguishable to the Auction Engine. The Expo app in `apps/mobile` is untouched.

- **Swift 6 / SwiftUI, iOS 18+**, no third-party dependencies.
- **Realtime**: a native Socket.IO v4 client (`Core/Realtime.swift`) over
  `URLSessionWebSocketTask`. It sends the session token in the handshake (`40{"token":…}`), the only
  channel the server accepts for socket auth, and re-joins rooms after a reconnect.
- **Auth**: passwordless email/phone code (`/api/auth/request` → `/api/auth/verify`). The bearer token
  lives in the Keychain (`AfterFirstUnlockThisDeviceOnly`), never in UserDefaults.
- **Streaming**: AVPlayer HLS with Picture-in-Picture; demo manifests loop and are labelled "Demo feed".
- **Languages**: UI in en, es, fr, pt-BR, de, ar, zh-Hans, yo (`Resources/Localizable.xcstrings`).
  Listings and live chat get on-device language detection (NaturalLanguage) and Apple Translation.
- **Artwork**: the API's generated SVG lot art is drawn natively (`UI/ArtworkView.swift`); seller photos
  (base64 JPEG/PNG) and remote URLs are decoded and cached.
- **Accessibility**: every lot and stream card exposes one spoken label and an identifier
  (`lot-<id>`, `stream-<id>`). That fixes the handover's lot-card defect that blocked bid UI tests.

## Build

```bash
cd apps/ios
xcodegen generate                      # project.yml is the source of truth; the .xcodeproj is generated
xcodebuild -project MoneyMart.xcodeproj -scheme MoneyMart \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath /Volumes/MAC5/Development/DerivedData/MoneyMart-iOS test
```

## Gateway

Resolution order: device override (Settings › Diagnostics) → `MM_API_URL` launch env → `MMApiBaseURL`
in Info.plist (`https://www.moneymart.app`). Release builds accept only `https`.

For a full sign-in and bid test without a real inbox, run the API locally with dev codes:

```bash
cd services/api && MM_PERSISTENCE=off MM_AUTH_DEV_CODES=true node dist/services/api/src/index.js
# then launch the app with MM_API_URL=http://127.0.0.1:4317
```

## Release checklist

1. Set `DEVELOPMENT_TEAM` in `project.yml` and regenerate.
2. The App Store icon must have no alpha channel: `AppIcon-1024.png` is flattened onto navy.
3. Bundle id `com.moneymart.app`. If the Expo build ever ships under the same id, this native build supersedes it.
4. Archive: `xcodebuild -scheme MoneyMart -configuration Release -archivePath build/MoneyMart.xcarchive archive`.
