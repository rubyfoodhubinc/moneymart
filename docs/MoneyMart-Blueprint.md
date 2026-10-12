MoneyMart
"Bid. Stream. Win."
Master Product Blueprint
Version 2.0  |  October 2026
Document Type: Technical + Design + Product Specification
Prepared by: MoneyMart Product Team
Prepared for: Development, Design & Product Teams
Prepared on: Sunday, 11 October 2026
CONFIDENTIAL — INTERNAL USE ONLY
LIVE-COMMERCE  AUCTION PLATFORM  v2.0
[Heading 1] Table of Contents
Section 1 — Executive Summary
Section 2 — Brand Identity
2.1 Color Palette
2.2 Typography & Voice
2.3 Motion & Iconography
Section 3 — Multi-Country Strategy
3.1 Country Matrix
3.2 Global Platform Features
Section 4 — Platform Architecture: Hybrid Flows
4.1 Creator-Led Live Stream Flow (Whatnot-Style)
4.2 Traditional Auction House Flow (Sotheby's-Style)
4.3 Secondary Marketplace Flow
Section 5 — Full Mobile App Flow (React Native)
5.1 App Architecture Overview
5.2 Screen Map
5.3 React Native Component Library
Section 6 — Figma-Style Screen Map
Section 7 — TV / IPTV Flow
7.1 Platform Targets
7.2 TV UX Principles
7.3 TV Screen Flow
7.4 IPTV Integration
Section 8 — Web Demo Architecture
8.1 Tech Stack
8.2 Web Page Structure
8.3 Responsive Breakpoints
8.4 Web-Specific Features
Section 9 — Backend Architecture
9.1 Services Overview
9.2 Real-Time Bidding Engine
9.3 Data Models
Section 10 — Monetization Model
Section 11 — Implementation Roadmap
Section 12 — Appendix
12.1 Glossary of Terms
12.2 Third-Party Dependencies
12.3 Compliance Checklist
12.4 Brand Asset Usage Guidelines

--- TABLE ---
SECTION 1 — EXECUTIVE SUMMARY
--- END TABLE ---

MoneyMart is a next-generation hybrid live-commerce and auction platform that fuses the energy and immediacy of creator-led live shopping — pioneered by platforms such as Whatnot — with the structure, trust, and prestige of traditional auction houses such as Sotheby's and Christie's. The result is a single, unified platform capable of serving casual buyers, serious collectors, emerging creators, professional sellers, and institutional consignors, all within one coherent product experience.
MoneyMart operates simultaneously across four distinct but interlinked platform pillars:
Live Auctions — Creator-hosted real-time bidding events streamed directly to buyers on mobile, web, and television
Creator Streams — Monetised live shopping content with integrated auction mechanics and fan engagement
Traditional Auctions — Formally catalogued, expert-reviewed auction events following established auction-house process
Secondary Marketplace — Buy Now, Make Offer, and authenticated resale listings adjacent to live auction activity
[Heading 2] 1.1 Target Markets
At launch, MoneyMart targets five primary markets: Nigeria, USA, United Kingdom, Canada, and broader Africa (with Phase 3 expansion to Kenya, Ghana, and South Africa). This multi-market approach is underpinned by localised payment rails, multi-currency support, multi-language UI, and country-specific regulatory compliance layers, making MoneyMart genuinely global from day one rather than US-first with international as an afterthought.
[Heading 2] 1.2 Core Value Propositions
Real-time bidding with sub-second WebSocket-powered bid updates and anti-snipe protection
Creator monetisation through revenue sharing, fan subscriptions, and live drop mechanics
Multi-currency support with dynamic conversion and geo-IP currency defaulting
Mobile-first architecture with TV/IPTV and full web extensions for maximum reach
Trust infrastructure — MoneyMart Verified badge, provenance records, condition reports, and escrow payment processing
[Heading 2] 1.3 Business Model Overview
MoneyMart generates revenue through a diversified stack of monetisation mechanisms: seller listing fees, buyer's premiums on traditional auctions, creator revenue share (platform retains 15% of GMV), buyer and creator subscription tiers, featured listing boosts, cross-border transaction fees, and brand partnership campaigns. This multi-stream model reduces dependency on any single revenue source and aligns platform incentives with both buyers and sellers.

--- TABLE ---
KEY METRICS TARGET — v2.0 LAUNCH / GMV Target (Year 1): $25M+ across Nigeria + USA  |  Registered Users: 500,000  |  Active Creators: 2,000+  |  Auction Events per Month: 10,000+  |  Platform Uptime SLA: 99.95%
--- END TABLE ---


--- TABLE ---
SECTION 2 — BRAND IDENTITY
--- END TABLE ---

Brand Name: MoneyMart    Tagline: "Bid. Stream. Win."    Version: v2.0, October 2026
[Heading 2] 2.1 Logo Concept
The MoneyMart logotype centres on a bold "MM" monogram — the two letterforms are constructed in geometric sans-serif capitals with the crossbar of the second M forming the handle of an upward-rising auction gavel, integrating brand symbolism directly into the letterform without requiring a separate icon. Beneath the monogram, an Electric Green pulse line runs the full width of the logotype, visually communicating live activity, heartbeat energy, and technological vitality. The primary lockup appears reversed (gold monogram on Deep Navy field) for digital surfaces, and solid navy on white for print and document usage.
[Heading 2] 2.2 Color Palette

--- TABLE ---
Color Name | Hex Code | RGB | Role | Meaning & Usage
Primary Gold | #F5A623 | 245, 166, 35 | Primary brand color | Energy, wealth, ambition. Used on CTAs, bid buttons, price tags, section accents, and highlights.
Deep Navy | #0D1B2A | 13, 27, 42 | Secondary / Background | Trust, authority, professionalism. Primary background for header bars, footers, and dark UI surfaces.
Electric Green | #00D4A1 | 0, 212, 161 | Accent / Live indicator | Live activity, tech forward, success. Used on LIVE badges, winning state, confetti accents, and success toasts.
Pure White | #FFFFFF | 255, 255, 255 | Surface / Background | Clean space and readability. Primary card and page background; reversed text on dark surfaces.
Charcoal | #1C1C1E | 28, 28, 30 | Dark surface | Dark UI surfaces, body copy on light, secondary backgrounds in stream overlay panels.
--- END TABLE ---

[Heading 2] 2.3 Typography

--- TABLE ---
Role | Typeface | Weight(s) | Usage
Display | Clash Display | Bold, ExtraBold | Hero headlines, section titles, cover art, auction event names
Body / UI | Inter | Regular, Medium, SemiBold | Body copy, UI labels, descriptions, navigation, form fields
Accent / Data | Space Grotesk | Medium, Bold | Live prices, bid counts, countdown timers, lot numbers, currency display
--- END TABLE ---

[Heading 2] 2.4 Brand Voice
MoneyMart's brand voice is energetic — communicating the thrill of live bidding and winning; trustworthy — grounded in the authority and process of professional auction houses; community-driven — celebrating creators, collectors, and buyers as equal participants in a shared ecosystem; and globally inclusive — written to resonate across Nigeria, the USA, the UK, Canada, and broader Africa without cultural flattening.
[Heading 2] 2.5 Iconography & Motion Design
Iconography: Custom gavel icon set (auction gavel, mini gavel, falling hammer); live pulse indicators (animated concentric rings); bid counter numerals (tabular figures, monospaced); country flag micro-icons (rectangular, 16x12px, flat style, no drop shadows)
Confetti burst: Triggered on winning bid — gold, green, and white particle burst from the bid button; 1.2-second duration; GPU-accelerated via React Native Reanimated
Pulse ring: Radiating green ring on all LIVE status indicators; 1.8-second loop; opacity fade from 100% to 0%
Card flip: Smooth 180° Y-axis flip for auction item reveal transitions; 400ms ease-in-out; front shows teaser image, back reveals full item card with starting price

--- TABLE ---
SECTION 3 — MULTI-COUNTRY STRATEGY
--- END TABLE ---

MoneyMart is architected as a multi-country platform from the ground up. Each market receives a fully localised experience — currency, language, payment rails, category emphasis, and regulatory compliance — rather than a single global product with bolted-on localisation. The following matrix defines the launch configuration for each primary market.
[Heading 2] 3.1 Country Market Matrix

--- TABLE ---
Country | Currency | Payment Rails | Language(s) | Key Categories | Regulatory Notes
Nigeria | NGN (₦) | Paystack, Flutterwave, USSD, Bank Transfer | English, Yoruba, Igbo, Hausa | Fashion, Electronics, Art, Collectibles | CBN payment regulations; FCCPC consumer compliance; KYC requirements per CBN directive
USA | USD ($) | Stripe, PayPal, Apple Pay, Google Pay | English | Sneakers, Trading Cards, Watches, Jewelry | FTC auction rules; state-level auctioneer licensing (varies by state); FinCEN compliance for high-value items
UK | GBP (£) | Stripe, GoCardless, Open Banking (PSD2) | English | Antiques, Art, Designer Goods | FCA regulations; Consumer Rights Act 2015; ASA advertising rules; HMRC VAT on auction services
Canada | CAD ($) | Stripe, Interac e-Transfer | English, French | Art, Collectibles, Vehicles | CRTC digital media rules; provincial auction laws (ON, BC, QC differ); PIPEDA data privacy
Africa (Broader) | Multi-currency (KES, GHS, ZAR, XOF, etc.) | M-Pesa, MTN MoMo, Airtel Money, local bank rails | 50+ languages (English, French, Arabic, Portuguese, Swahili) | Agricultural equipment, Vehicles, Art, Real estate | Country-by-country compliance layer; Phase 3 rollout; legal review required per jurisdiction
--- END TABLE ---

[Heading 2] 3.2 Global Platform Features
The following capabilities apply platform-wide and enable the multi-country strategy at the infrastructure level:
Dynamic currency conversion at checkout — real-time FX rates via Open Exchange Rates API; displayed to buyer before bid confirmation
Geo-IP based currency defaulting — user's local currency presented on first visit; manual override available in settings
Multi-language UI (i18n / l10n) — React Native i18n for mobile; Next.js i18n routing for web; RTL (right-to-left) layout support for Arabic; translation managed via Crowdin
Country-specific compliance banners and disclosures — buyer's premium disclosures, VAT notices, and regulatory statements triggered by user's registered country
Cross-border shipping integration — DHL, FedEx, and local couriers (GIG Logistics in Nigeria; Sendle in Canada) integrated at order confirmation
Duty and VAT calculation at checkout — powered by Avalara AvaTax; applied automatically on cross-border transactions above declared thresholds

--- TABLE ---
SECTION 4 — PLATFORM ARCHITECTURE: HYBRID FLOWS
--- END TABLE ---

MoneyMart operates three distinct but architecturally unified auction and commerce flows. Each flow shares the same authentication, payments, and notifications infrastructure while delivering a tailored UX appropriate to its format.
[Heading 2] 4.1 Creator-Led Live Stream Flow (Whatnot-Style)
This flow powers real-time, creator-hosted auction events streamed live to buyers. It is the primary growth driver and differentiating experience of MoneyMart.
Step 1 — Creator Setup: Creator completes profile verification (ID check + payment method linked) → selects auction category → schedules stream event with date/time → lists items pre-stream with photos, starting prices, and descriptions. Items are queued in the Creator Dashboard in planned drop order.
Step 2 — Pre-Stream Lobby: 15-minute countdown timer activates on the stream card → chat is enabled for early joiners → creator's followers receive push notification ("Stream starts in 15 min") → item teaser cards are displayed with blurred pricing to build anticipation.
Step 3 — Live Stream Active: On mobile: video feed occupies top 70% of viewport; bid panel anchored to bottom 30%. On web: side-by-side layout (stream left, bid panel + chat right). On TV: full-screen 16:9 with overlaid bid controls via D-pad.
Step 4 — Item Drop: Creator selects "Drop Item" in dashboard → item card animates into view (card-flip reveal) → starting price and configurable countdown timer displayed (30–120 seconds, creator-set per item).
Step 5 — Bidding: Viewers tap the gold Bid Button to place bids at defined increments → real-time price updates via WebSocket push → Auto-bid option allows buyers to set a maximum bid and increment; system bids on their behalf → outbid push notification triggers within 1 second.
Step 6 — Item Won: Timer expires → winner determined → confetti burst animation plays → winner banner displayed in stream overlay → auto-checkout initiated (payment held from linked method) → next queued item loads automatically for seamless stream continuity.
Step 7 — Stream End: Creator clicks "End Stream" → summary screen shows: total items sold, total GMV, average sale price, new followers gained, earnings breakdown → buyers receive order confirmation emails + in-app notifications with shipping instructions.
[Heading 2] 4.2 Traditional Auction House Flow (Sotheby's-Style)
This flow mirrors the process and prestige of established auction houses, serving high-value, curated items with expert oversight, preview periods, and formal bidding events.
Step 1 — Consignment: Seller submits item via the Selling Flow → MoneyMart's expert review team assesses submission within 3–5 business days → valuation report generated with estimated price range → seller approves reserve price → consignment agreement signed digitally.
Step 2 — Catalogue Production: Professional photography instructions sent to seller (or MoneyMart studio shoot arranged for high-value items) → expert writes detailed description including maker, period, materials, condition → provenance research completed → PDF catalogue generated and published to platform 14 days prior to auction.
Step 3 — Preview Period: 7–14 day preview window → detailed condition reports available to registered bidders → absentee bids accepted (buyer sets maximum; system bids to that limit) → in-person preview events can be scheduled for premium lots.
Step 4 — Live Auction Event: Scheduled live event with professional auctioneer video feed → buyers register for paddle (virtual, assigned at registration) → incremental bidding with lot timer displayed → auctioneer can accept floor bids (by proxy) alongside online bids.
Step 5 — Hammer Fall: Winning bid confirmed by auctioneer → "SOLD" state triggered in platform → buyer's premium added to hammer price (15% standard; 20% for luxury/premium category lots) → formal invoice generated and emailed within 60 seconds.
Step 6 — Settlement: Payment processing (5-business-day payment window) → shipping or collection arranged via integrated logistics partners → Certificate of Authenticity (CoA) issued for eligible items → seller payout released after buyer confirmation (typically 7–10 business days post-auction).
[Heading 2] 4.3 Secondary Marketplace Flow
The Secondary Marketplace provides a persistent, always-on commerce layer alongside scheduled live and traditional auction events, capturing buyer intent between auction moments.
Buy Now listings — Fixed-price items listed alongside or independent of auction events; checkout flow mirrors standard e-commerce (instant payment, immediate order confirmation)
Make an Offer functionality — Buyers submit custom offer price; seller receives notification and can accept, decline, or counter within 48 hours; offer thread is private between buyer and seller
Authenticated resale with MoneyMart Verified badge — Items that have passed MoneyMart's authentication review (photo verification, provenance check, or physical inspection for high-value items) display the "MV Verified" badge on all listing surfaces
Price history charts and market data — Every item category and specific model/edition displays a price history chart (last 12 months of completed sales on MoneyMart) to help buyers and sellers establish fair market value

--- TABLE ---
SECTION 5 — FULL MOBILE APP FLOW (REACT NATIVE)
--- END TABLE ---

[Heading 2] 5.1 App Architecture Overview

--- TABLE ---
Layer | Technology | Detail
Framework | React Native (Expo managed workflow) | Cross-platform iOS + Android; Expo SDK 53; EAS Build for CI/CD
State Management | Redux Toolkit + RTK Query | Global app state; API data caching; optimistic bid updates
Navigation | React Navigation v7 | Stack + Tab (bottom) + Drawer; deep-linking configured for notifications
Real-Time | Socket.IO client | Live bidding events; chat messages; viewer count updates; item drop events
Media | react-native-video + HLS streaming | HLS adaptive bitrate; Mux playback SDK for stream health; VOD replay support
Payments | Stripe React Native SDK + regional payment SDKs | Stripe for USD/GBP/CAD; Paystack SDK for NGN; M-Pesa STK Push for KES
Push Notifications | Firebase Cloud Messaging (FCM) | Outbid alerts; stream start; order updates; price drop alerts
Authentication | Firebase Auth + Social OAuth | Google, Apple, Facebook; phone number OTP (Twilio Verify); JWT session tokens
--- END TABLE ---

[Heading 2] 5.2 Screen Map
[Heading 3] Onboarding Flow — 5 Screens
Splash Screen — MoneyMart logo animation on Deep Navy background; gold pulse ring expands from logo centre; tagline "Bid. Stream. Win." fades in beneath monogram; auto-advances after 2 seconds or on tap
Welcome Carousel — 3-slide value prop walkthrough: Slide 1 "Live Auctions — Bid in Real Time" with animated gavel icon; Slide 2 "Creator Streams — Shop Live with the Creators You Love"; Slide 3 "Win Big — Score Rare Finds at Unbeatable Prices." Skip button top-right. Page dots indicator.
Country & Currency Selection — 4x3 flag grid for primary markets; auto-detect based on device locale with manual override toggle; currency symbol previewed beside each flag; search field for non-primary markets
Sign Up / Sign In — Email + password with real-time validation; Google SSO; Apple SSO; Facebook SSO; "Use phone number" toggle opens OTP flow (6-digit code, 60-second expiry); Terms & Privacy link inline
Profile Setup — Display name (auto-suggested from OAuth name); avatar upload (camera or gallery; AI background removal applied); category interest selection (multi-select chips: Fashion, Electronics, Art, Collectibles, Watches, etc.); notification preferences (Outbid alerts, Stream starts, Order updates — toggle per type)
[Heading 3] Home Tab — 3 Main Views
For You Feed — Personalised vertical scroll combining: live stream cards (with live viewer badge and muted auto-play preview), ending-soon auction cards (red countdown <1 hour), and recommended item cards. Horizontal scroll category filter chips at top (All / Live / Ending Soon / Fashion / Art / etc.).
Live Now — Full-screen horizontal scroll carousel of all currently active streams; viewer count badge on each card; muted auto-playing preview thumbnail cycles every 3 seconds; tap to enter stream full-screen.
Ending Soon — Grid of auction items closing within 60 minutes; animated countdown timer card (MM:SS format); current bid displayed prominently; sort by: time remaining, current price, most bids.
[Heading 3] Discovery Tab
Search Screen — Unified search bar with voice search icon; trending searches section (updated hourly); recent searches with clear-all option; "Creators to Follow" horizontal scroll below
Category Browser — 3-column icon grid of top-level categories with custom MoneyMart icons; tap to sub-category drill-down (up to 3 levels); breadcrumb navigation at top
Results Screen — Sort/filter panel (price range slider, condition dropdown, seller location, auction type, ending time); list and grid toggle (list default on mobile, grid on tablet+); result count displayed; pagination via infinite scroll
Item Detail Page — Image carousel (swipe + pinch-to-zoom); below fold: full description, bid history table (anonymised), seller profile card (rating, total sales, response time), related items horizontal scroll; sticky bottom CTA bar: "Bid Now" (gold) / "Buy Now" (green) / "Watch" (navy outline)
[Heading 3] Live Stream Screen — Core Experience
Full-screen portrait video feed with HLS adaptive bitrate; controls auto-hide after 3 seconds
Overlaid top bar: Creator name + gold verification tick + Electric Green "LIVE" badge + viewer count
Chat panel: scrollable, newest-at-bottom; pinned message (creator-set) with gold pin icon; emoji reaction strip (7 quick reactions); chat auto-pauses on bid interaction to prevent accidental misses
Current item card anchored bottom-left: item thumbnail + title + current price (Space Grotesk bold) + time remaining bar
Bid Button: large, Electric Green, full-width above system nav; animated pulse on each new bid received; shows current increment price ("Bid $47")
Top-right overlay: Share icon + Follow Creator button (collapsed to icon once following)
Auto-bid modal (accessed via long-press on Bid Button): set maximum bid, choose increment size (Minimum / Mid / Aggressive), toggle on/off, confirm with biometric auth
[Heading 3] Auction Detail Screen
Lot number + lot title in Display typeface
Full-screen capable image gallery with swipe navigation and pinch-to-zoom
Collapsible description section (show more/less toggle)
Tabbed detail panel: Description | Provenance | Condition Report (each tab opens rich-text content)
Bid History: anonymised bidder IDs (e.g., "Bidder #0041"), bid amounts, and timestamps in chronological order; live-updating via WebSocket
Reserve indicator chip: Reserve Met or  Reserve Not Met
Bid input field with increment selector (dropdown: Minimum / Standard / Jump Bid); prominent "Place Bid" CTA
Days:Hours:Minutes:Seconds countdown timer (red when <1 hour remaining)
Buyer's premium disclosure in a callout box at base of screen (non-dismissable)
[Heading 3] Selling Flow — 5 Steps
Item Type Selection — 2x2 card grid: Live Stream Listing / Traditional Auction / Buy Now / Make an Offer. Each card has icon, short description, and fee preview.
Item Details — Category → Sub-category (drill-down select) → Title (character counter, SEO hints) → Description (rich text, 2000-char max) → Condition grading (New / Like New / Good / Fair / Parts Only with visual condition guide)
Photo Upload — Up to 20 photos; AI-assisted background removal toggle; 360° spin upload option (24-frame sequence); main image selector (drag to reorder); minimum resolution warning
Pricing & Duration — Starting price field; Reserve price (optional, shown as locked until met); Buy It Now price (optional, turns item to BIN once set above starting bid); Auction duration selector (1 / 3 / 5 / 7 / 10 / 14 days); fee calculator showing estimated platform fee at various sale prices
Review & Publish — Full preview card rendered as buyer sees it; fee summary table; "Submit for Review" (Traditional Auction path, enters moderation queue) or "Schedule / Go Live" (Stream path, opens stream scheduling modal)
[Heading 3] Profile & Account Screens
Public Profile — Avatar, display name, bio (280 chars), seller star rating (1–5, weighted average), active listings count, total items sold, follower / following count; "Follow" + "Message" CTAs for other users' profiles
Private Dashboard — 30-day earnings chart (bar chart via Victory Native); payout settings (bank account / mobile money / wallet balance); upcoming streams calendar widget; performance tips
Wallet — Available balance (large, Space Grotesk); pending balance (awaiting buyer confirmation); "Add Funds" + "Withdraw" CTAs; full transaction history list (filterable by date, type)
Orders — Buying tab (Pending Payment / Awaiting Shipment / Shipped / Complete / Disputed) and Selling tab (Sold / Awaiting Shipment / Shipped / Paid Out); each order card links to order detail with shipping tracker integration
Settings — Language, currency display, notification preferences (granular per-type toggles), privacy (public/private profile, bid history visibility), linked payment methods, identity verification status & upload, help & support, logout
[Heading 3] Notifications Screen
Categorised tabs: Bids / Streams / Orders / System (with unread count badge per tab)
"Mark all read" button (top right)
Each notification is deep-linked: tap opens directly to relevant screen (outbid alert → auction detail; stream start → stream screen; order shipped → order detail)
Notification age displayed (Just now / 5m ago / 2h ago / Yesterday)
[Heading 2] 5.3 React Native Component Library

--- TABLE ---
Component Name | Type | Key Props | Usage
BidButton | Pressable | price, isActive, onPress, pulseColor | Live stream screen and auction detail CTA
StreamCard | View | streamId, thumbnail, title, viewerCount, isLive | Home feed, Discovery results, Live Now tab
AuctionCard | View | lotId, image, title, currentBid, endsAt, reserveMet | All auction listing contexts
CountdownTimer | Text (Animated) | endsAt, size, colorScheme | Auction cards, stream item timer, ending soon
PriceTag | Text | amount, currency, size, variant (current/starting/buyNow) | All listing and bid screens
BidHistory | FlatList | bids[], anonymized (bool), maxVisible | Auction detail screen
CreatorAvatar | Image | userId, size, isVerified, isLive | Stream overlays, search results, profile headers
AutoBidModal | Modal | currentPrice, increment, onConfirm, onDismiss | Live stream screen (long-press bid button)
CategoryChip | Pressable | label, icon, isSelected, onPress | Home filter bar, search filters, onboarding interests
CurrencySelector | Modal | supported[], defaultCurrency, onSelect | Onboarding country screen, account settings
LiveIndicator | Animated.View | color, size, label | Any LIVE-status element (stream cards, creator avatars)
ConfettiBlast | Animated | trigger (bool), duration, colors[] | Win screen overlay after successful bid
PaymentSheet | Modal | amount, currency, methods[], onSuccess, onError | Checkout flow, wallet top-up
--- END TABLE ---


--- TABLE ---
SECTION 6 — FIGMA-STYLE SCREEN MAP
--- END TABLE ---

The following hierarchical screen architecture represents the full MoneyMart design system as it would be organised within Figma — page-by-page, with parent-child screen relationships expressed as indented outline nodes. This structure serves as the definitive reference for the design team's component organisation.

--- TABLE ---
Page 1 — Onboarding / Splash /    └── Welcome-Slide-1 (Live Auctions) /        └── Welcome-Slide-2 (Creator Streams) /            └── Welcome-Slide-3 (Win Big) /                └── Country & Currency Select /                    ├── Auth — Sign Up /                    │     └── OTP Verify /                    └── Auth — Sign In /                          └── Profile Setup /                                └── Interest Select → Notification Opt-In → Home
--- END TABLE ---


--- TABLE ---
Page 2 — Home & Discovery / Home (For You / Live Now / Ending Soon tabs) /    ├── Stream Card → Live Stream Screen → Item Won Screen /    ├── Auction Card → Auction Detail → Bid Confirm → Bid Placed Screen /    └── Search Screen /          └── Results Screen /                └── Item Detail Page /                      └── Seller Profile (public)
--- END TABLE ---


--- TABLE ---
Page 3 — Live Stream Experience / Stream Lobby (pre-stream countdown) /    └── Stream Active (full-screen) /        ├── Chat Panel /        │     └── Pinned Message View /        ├── Item Drop Modal /        │     ├── Bid Input /        │     ├── Outbid Alert (toast) /        │     └── Win Screen (confetti) /        └── Auto-Bid Setup Modal /              ├── Auto-Bid Active State (indicator chip) /              └── Auto-Bid Won Screen
--- END TABLE ---


--- TABLE ---
Page 4 — Selling / Sell Home → Item Type Select /    ├── LIVE STREAM PATH /    │     └── Item Setup → Schedule Stream → Go Live → Stream Dashboard /    │              └── End Stream → Earnings Summary → Payout /    └── AUCTION PATH /          └── Item Details → Photo Upload → Pricing & Duration → Review /                  └── Submitted → Under Review → Approved → Live → Sold → Payout
--- END TABLE ---


--- TABLE ---
Page 5 — Profile & Account / My Profile (public view) → Edit Profile /    ├── My Listings → Active / Ended / Drafts /    ├── My Orders /    │     ├── Buying: Pending / Shipped / Complete / Disputed /    │     └── Selling: Sold / Awaiting Ship / Shipped / Paid Out /    ├── Wallet → Add Funds → Withdraw → Transaction History /    └── Settings /          ├── Language / Currency / Notifications /          ├── Payment Methods → Add Card / Add Bank / Mobile Money /          ├── ID Verification → Upload ID → Selfie Check → Verified /          └── Help & Support → FAQ / Live Chat / Raise Ticket
--- END TABLE ---


--- TABLE ---
Page 6 — TV / IPTV / TV Home (hero carousel + auction grid) /    ├── Live Stream View (full-screen 16:9) /    │     ├── Bid Panel (slide-in from right) /    │     └── QR Code Bridge (scan to bid on phone) /    ├── Auction Browse (D-pad grid) /    │     └── Item Detail (TV) → Bid CTA → Bid Confirm /    └── Account (TV — simplified) /          └── Watch History / Watchlist / Settings
--- END TABLE ---


--- TABLE ---
SECTION 7 — TV / IPTV FLOW
--- END TABLE ---

[Heading 2] 7.1 Platform Targets

--- TABLE ---
Platform | Distribution Channel | Framework / SDK | Phase
Android TV | Google Play for TV | React Native TV (tvOS/Android TV fork); Leanback library | Phase 3 (Q3 2027)
Apple TV (tvOS) | Apple App Store (tvOS) | React Native tvOS; TVUIKit focus engine | Phase 3 (Q3 2027)
Samsung Smart TV (Tizen) | Samsung TV Plus / Tizen Store | Tizen Web App (HTML5 + JS); HLS player | Phase 3 (Q3 2027)
LG Smart TV (webOS) | LG Content Store | webOS Web App (Enact framework); HLS player | Phase 3 (Q3 2027)
Amazon Fire TV | Amazon Appstore | React Native TV; Fire TV SDK | Phase 3 (Q3 2027)
IPTV Middleware | MAG boxes, Formuler, IPTV Smarters | HLS channel ingest + EPG XML feed + HbbTV overlay | Phase 3 (Q3 2027)
--- END TABLE ---

[Heading 2] 7.2 TV UX Principles
D-pad navigation only — no touch input assumed; all interactive elements navigable via Up / Down / Left / Right / Select / Back / Home keys
Large text baseline — minimum 32pt body text; minimum 56pt section headings; all text must be legible at 3 metres (10-foot UI standard)
High contrast required — all text meets WCAG 2.1 AA contrast ratio (4.5:1 for body, 3:1 for large text) against background; Deep Navy + Pure White is the default pairing
Wide focus targets — all focusable elements have a minimum width of 200px and height of 80px on 1080p; focus state is indicated by a gold (#F5A623) border, 4px, with a subtle background highlight
No modal overload — maximum one action prompt per screen state; confirmation steps are kept to a single "Yes / No" D-pad selection rather than full modal sheets
Row-based layout — all TV screens use horizontal row-based composition: hero row (1 item full-width), content rows (5–7 items per row), filter row (chips at top)
[Heading 2] 7.3 TV Screen Flow
TV Home: Hero carousel auto-advances every 8 seconds through featured live streams; below hero: row of "Ending Soon" auction cards; row of "Top Creators Live Now"; row of "Just Added" items. D-pad navigates left/right within rows, up/down between rows.
Live Stream View: Full-screen 16:9 video; D-pad focus cycles (using Left/Right) through overlay control buttons: Watch (default focus, hides controls), Chat (opens chat panel), Bid (opens bid panel), Share (displays share code). Controls auto-hide after 5 seconds of inactivity.
Bid Panel (TV): Slides in from right edge over ~30% of screen width; shows: current item name, current bid price, next increment options (Low / Mid / High bid amounts), and Confirm button. D-pad Up/Down selects increment; Select confirms; Back dismisses panel.
QR Code Bridge: "Scan to bid on your phone" QR code displayed as overlay on right side of Bid Panel; QR encodes a deep-link URL containing the auction item ID and a time-limited authentication token; scanning on a logged-in MoneyMart mobile app opens the item bid screen pre-authenticated.
Auction Browse: 4x3 grid layout; D-pad navigation highlighted in gold; filter row at top (Category chips, Sort chips); item cards show: thumbnail, lot title, current bid, time remaining bar.
Item Detail (TV): Two-column layout — full image left 60%, detail panel right 40% (description, bid history, current bid, bid CTA); D-pad focus manages column switching.
Account (TV — Simplified): Only three sections available on TV: Watch History (items watched in last 30 days), Watchlist (saved items with countdown timers), and Settings (display language, notification sound toggle). Full account management explicitly directed to mobile or web.
[Heading 2] 7.4 IPTV Integration
HLS live stream embedding — MoneyMart's live auction streams can be embedded in IPTV channel bouquets as dedicated channels; stream delivered via same Mux/AWS MediaLive pipeline as mobile
EPG (Electronic Program Guide) integration — Scheduled auction events published as XML EPG feed (XMLTV format); auction event name, duration, category, and featured lots appear in the EPG grid on compatible IPTV middleware
Interactive overlay via HbbTV standard — On HbbTV-compatible televisions, a layered interactive overlay provides: current bid display, QR-to-bid code, item teaser card; activated by pressing the Red button on the remote
IPTV SDK for middleware vendors — Documented REST API + webhook integration guide published for MAG, Formuler, and IPTV Smarters developers to embed MoneyMart stream tokens in their own UIs
Stream authentication via token-based URL signing — HLS stream URLs are signed with time-limited tokens (15-minute window) generated server-side; prevents stream redistribution and ensures only authenticated MoneyMart users can access streams

--- TABLE ---
SECTION 8 — WEB DEMO ARCHITECTURE
--- END TABLE ---

[Heading 2] 8.1 Tech Stack

--- TABLE ---
Layer | Technology | Detail / Purpose
Framework | Next.js 15 (App Router) | SSR + SSG hybrid; React Server Components; streaming SSR for auction pages
Styling | Tailwind CSS + shadcn/ui | Utility-first CSS; shadcn components extended with MoneyMart design tokens
State | Zustand + TanStack React Query | Lightweight client state (Zustand); server data fetching and caching (React Query)
Real-Time | Socket.IO (client) | Same backend Socket.IO server as mobile; real-time bid events, chat, viewer count
Media Player | Video.js + HLS.js | HLS adaptive bitrate stream playback; Picture-in-Picture API integration
Authentication | NextAuth.js + Firebase Auth | Shared auth backend with mobile; Google, Apple, email providers; session management
Payments | Stripe.js (web) | Payment Element for multi-method checkout; Stripe Link for returning customers
Deployment | Vercel + CDN | Edge network deployment; CloudFront CDN for media assets; preview deployments per PR
Analytics | Mixpanel + PostHog | Mixpanel for funnel and cohort analysis; PostHog for session recording and feature flags
--- END TABLE ---

[Heading 2] 8.2 Web Page Structure (Site Map)

--- TABLE ---
Route | Page Name | Key Content & Features
/ | Landing Page | Hero section with live stream embed preview + CTA; featured auctions row; "How it works" explainer; testimonials carousel; country selector; app download CTA (App Store + Play Store)
/live | Live Streams | Live streams grid (3-column desktop, 2-column tablet, 1-column mobile); category filter; search; embedded stream player modal
/auctions | Auction Browse | All auctions; sort/filter panel; auction calendar view (monthly events); upcoming scheduled events highlighted
/auctions/[id] | Auction Detail | Image gallery; full lot description; bid history table; live bid panel (WebSocket); countdown timer; buyer's premium disclosure; related lots
/stream/[id] | Stream View | Responsive embedded stream player; chat panel (right sidebar desktop); bid panel; item queue; creator info; viewer count
/sell | Seller Landing | Seller value proposition; fee calculator; seller onboarding wizard CTA; seller success stories; FAQ
/seller/[id] | Seller Profile | Public seller profile; active listings grid; completed sales history; star rating; reviews list; "Follow" CTA
/account | Account Dashboard | Protected route (auth required); dashboard with earnings chart; orders; wallet; settings; linked payment methods; notification preferences
/admin | Internal CMS | Internal-only; listing approval queue; stream management (kill switch, delay trigger); user management; financial reporting; moderation queue; feature flags
--- END TABLE ---

[Heading 2] 8.3 Responsive Breakpoints

--- TABLE ---
Breakpoint | Viewport Width | Layout | Navigation
Mobile | 375 – 767px | Single column; full-width cards; stacked sections | Bottom tab navigation bar (5 tabs)
Tablet | 768 – 1023px | 2-column grid; sidebar appears for auction detail | Collapsible side navigation rail
Desktop | 1024 – 1439px | 3-column grid; full side panel on stream view; filter panels visible | Full top navigation bar + expanded side nav
Wide | 1440px+ | Max-width container centred; multi-panel stream layout (2-up grid for power bidders) | Full nav + persistent right panel for watchlist
--- END TABLE ---

[Heading 2] 8.4 Web-Specific Features
Picture-in-Picture (PiP) stream — Uses the browser PiP API; stream detaches into floating mini-player when user navigates away from the stream page, allowing browsing of other items while staying in the auction
Keyboard shortcuts for power bidders — B = Place Bid at current increment; Space = Pause/play stream; Arrow Up = Increase bid increment; Arrow Down = Decrease bid increment; W = Add to Watchlist; Escape = Close panels
Multi-item watch mode — On 1440px+ screens, users can open a 2-up stream grid to watch two live auction streams simultaneously in split-screen layout, each with independent chat and bid panels
Desktop notifications via Web Push API — Users opt in to browser push notifications; outbid alerts, stream-start notifications, and auction-ending alerts delivered even when browser tab is not in focus
Browser extension (Phase 4) — Chrome and Firefox extension provides a price history overlay when visiting supported external auction sites (eBay, Invaluable, etc.); shows equivalent MoneyMart sold prices for matched items, driving platform awareness and cross-traffic

--- TABLE ---
SECTION 9 — BACKEND ARCHITECTURE
--- END TABLE ---

[Heading 2] 9.1 Services Overview

--- TABLE ---
Service | Technology | Purpose
API Gateway | Node.js + Express / Kong Gateway | Route all client requests; rate limiting (per-user, per-IP); JWT auth middleware; request logging
Auth Service | Firebase Auth + custom JWT layer | User authentication; session management; OAuth token exchange; role-based access control (buyer, seller, creator, admin)
Auction Engine | Node.js + Redis (Redis Cluster) | Real-time bid processing; bid validation; atomic bid ordering; WebSocket event broadcasting; anti-snipe timer extension
Stream Service | AWS MediaLive + Mux | Ingest RTMP from creator devices; transcode to HLS (multiple bitrates: 360p, 720p, 1080p); deliver via CloudFront CDN; DVR recording for VOD replay
Payments Service | Stripe + regional SDKs (Paystack, Flutterwave) | Charge buyers at bid win; hold funds in escrow; release to sellers post-confirmation; payout to bank / mobile money; refund processing
Notifications Service | FCM + APNs + SendGrid + Twilio | Push notifications (mobile); email notifications (SendGrid); SMS fallback for critical alerts (Twilio); in-app notification feed
Search Service | Elasticsearch 8.x | Full-text search across items, creators, and lots; faceted filtering (category, price, condition, location); autocomplete suggestions; similarity-based recommendations
Analytics Service | Segment + Mixpanel | Event tracking (bid placed, stream joined, item purchased, etc.); funnel analysis; cohort retention; creator dashboard GMV metrics; A/B test tracking
Content Moderation | AWS Rekognition + human review queue | Automated image moderation (adult content, prohibited items); live stream moderation (keyword filter on chat); escalation to human moderation team for review
Storage | AWS S3 + CloudFront CDN | Item images (original + compressed variants); video VOD files; PDF catalogues; certificates of authenticity; user avatars
--- END TABLE ---

[Heading 2] 9.2 Real-Time Bidding Engine
The Auction Engine is the most performance-critical service in the MoneyMart stack. It must process bids with sub-100ms latency, guarantee atomic bid ordering, prevent race conditions, and handle thousands of concurrent auction rooms simultaneously.
Bid queue: Bids are pushed via LPUSH to a Redis list keyed by auction item ID (e.g., auction:bids:item_1234); LRANGE retrieves ordered bid history atomically — Redis single-thread guarantees ordering without distributed locks
WebSocket rooms: Each auction item has its own Socket.IO room (room:auction:item_1234); bid events are broadcast to all room members within milliseconds of bid acceptance
Bid validation pipeline: (1) User funds check — confirm payment method on file or wallet balance sufficient; (2) Increment check — bid must meet minimum increment above current price; (3) Time check — bid must arrive before countdown expiry; (4) Anti-snipe extension — if bid arrives within the last 10 seconds of timer, countdown automatically extends by 30 seconds to prevent auction sniping
Optimistic UI: Mobile and web clients display the optimistic bid update (user's bid showing as current) immediately on Submit; confirmed or rejected via Socket.IO event within 200ms; rejection triggers a toast notification with reason
WebSocket fallback: If WebSocket connection is lost, clients fall back to HTTP long-polling at 2-second intervals; reconnection attempts follow exponential backoff (1s, 2s, 4s, 8s, max 30s)
[Heading 2] 9.3 Data Models — Key Entities
[Heading 3] User
id, email, phone, displayName, avatarUrl, countryCode, currencyCode, role (buyer / seller / creator / admin), verificationStatus, kycLevel, createdAt, lastLoginAt, followersCount, followingCount
[Heading 3] Item
id, sellerId, title, description, categoryId, subcategoryId, condition, images[], provenance, conditionReport, authenticityStatus, isVerified, createdAt, updatedAt
[Heading 3] Auction
id, itemId, sellerId, auctionType (live_stream / traditional / buy_now / make_offer), startingPrice, reservePrice, currentBid, currentBidderId, buyItNowPrice, startTime, endTime, status (draft / scheduled / live / ended / sold / cancelled), buyersPremiumRate, currency, lotNumber (Traditional), streamId (if Live)
[Heading 3] Bid
id, auctionId, bidderId, amount, currency, timestamp, isAutoBid, status (pending / accepted / rejected / outbid / winning)
[Heading 3] Stream
id, creatorId, title, scheduledStartTime, actualStartTime, endTime, status (scheduled / live / ended), viewerCount, peakViewerCount, hlsUrl, rtmpKey, itemQueue[], totalGMV, chatEnabled, recordingUrl
[Heading 3] Order
id, auctionId, buyerId, sellerId, hammerPrice, buyersPremium, totalAmount, currency, paymentStatus (pending / paid / failed / refunded), shippingAddress, trackingNumber, courierName, orderStatus (pending / processing / shipped / delivered / disputed / complete), createdAt, completedAt
[Heading 3] Payout
id, sellerId, orderId[], grossAmount, platformFee, netAmount, currency, payoutMethod (bank / mobile_money / wallet), status (pending / processing / paid / failed), initiatedAt, completedAt, referenceId

--- TABLE ---
SECTION 10 — MONETIZATION MODEL
--- END TABLE ---

MoneyMart's revenue architecture is designed to be multi-stream, aligned with platform growth, and fair to creators and sellers at scale. The model scales with GMV rather than charging high fixed costs that would deter early-stage sellers and creators.

--- TABLE ---
Revenue Stream | Description | Rate / Structure
Seller Listing Fee | Fee to list items on Traditional Auction track | Free for first 10 listings/month; $0.50–$5.00 per item thereafter (tiered by category and reserve price)
Buyer's Premium | Percentage added to hammer price on all Traditional Auction sales; disclosed at listing and checkout | 15% standard; 20% for luxury/premium category (Watches, Jewelry, Fine Art, Vehicles)
Creator Revenue Share | Platform retains a percentage of all GMV generated through creator-led Live Stream auctions | 85% Creator / 15% Platform split on all live stream GMV
Creator Subscription | Fans subscribe to individual creators for exclusive access (early drops, private streams, discounts, content) | $4.99 / $9.99 / $19.99 per month (creator sets tier); 70% Creator / 30% Platform revenue split
Featured Listing Boost | Sellers pay to promote items to the top of search, category feeds, and home page recommendation rows | $5 – $50 per boost slot (7-day duration); competitive auction-based pricing in high-demand categories
MoneyMart Pro (Buyer) | Premium buyer subscription granting early access to drops, reduced buyer's premium, saved searches, and priority customer support | $9.99/month or $89.99/year; buyer's premium reduced to 10% (Standard) / 15% (Luxury) for Pro subscribers
Cross-Border Transaction Fee | Fee applied on transactions where buyer and seller are in different countries, covering FX conversion and cross-border payment processing costs | 1.5% on cross-border transaction total (buyer-side); displayed transparently at checkout
Brand Partnerships | Sponsored live drops, co-branded auction events, category sponsorship, and in-stream advertising for verified brands and retailers | Custom rates; minimum campaign spend $5,000; performance pricing available (CPM + conversion share)
--- END TABLE ---


--- TABLE ---
REVENUE PROJECTION NOTE / At target Year 1 GMV of $25M: Creator Revenue Share generates ~$3.75M; Buyer's Premium on Traditional Auctions (estimated 30% of GMV) generates ~$1.1M; Subscriptions (target 20,000 Pro buyers + 5,000 creator subscribers) generate ~$2.4M. Combined projected Year 1 revenue: $7–9M. Full financial model maintained separately.
--- END TABLE ---


--- TABLE ---
SECTION 11 — IMPLEMENTATION ROADMAP
--- END TABLE ---


--- TABLE ---
Phase | Timeline | Key Deliverables | Markets
Phase 1 — MVP | Q1 2027 / (Jan – Mar) | React Native app (iOS + Android) — App Store + Play Store submission Creator-led live stream auctions (core flow) Stripe payments (USD) + Paystack (NGN) Firebase Auth (email, Google, Apple) Basic seller listing and moderation FCM push notifications (outbid, stream start, order) Admin CMS (listing approval, user management) | Nigeria, USA
Phase 2 — Expansion | Q2 2027 / (Apr – Jun) | UK + Canada launch (Stripe GBP/CAD; GoCardless; Interac) Next.js web platform launch Traditional auction house flow (full consignment-to-payout) Creator subscription tiers MoneyMart Verified badge program Secondary Marketplace (Buy Now + Make Offer) Elasticsearch search service | UK, Canada
Phase 3 — Scale | Q3 2027 / (Jul – Sep) | Android TV + Apple TV apps IPTV channel integration + EPG feed Africa expansion: Kenya (M-Pesa), Ghana, South Africa Multi-language UI (Yoruba, Igbo, Hausa, French, Swahili) Duty/VAT calculation at checkout (Avalara) MoneyMart Pro buyer subscription launch Price history charts + market data Brand partnership programme launch | Africa (Kenya, Ghana, South Africa)
Phase 4 — Platform | Q4 2027 / (Oct – Dec) | Browser extension (Chrome + Firefox) — price history overlay Public API for third-party integrations (auction data, creator listings) International shipping network (DHL + FedEx integrations) Multi-item watch mode (2-up stream grid, web) Samsung Tizen + LG webOS TV apps Advanced analytics dashboard for creators and sellers HbbTV interactive overlay for IPTV | Global
--- END TABLE ---


--- TABLE ---
SECTION 12 — APPENDIX
--- END TABLE ---

[Heading 2] 12.1 Glossary of Terms

--- TABLE ---
Term | Definition
Hammer Price | The final accepted bid price at the moment the auctioneer (virtual or human) declares the item sold. Does not include buyer's premium or taxes. The hammer price is the amount the seller receives minus platform and seller fees.
Buyer's Premium | An additional percentage fee charged to the buyer on top of the hammer price on Traditional Auction sales. On MoneyMart, this is 15% (standard) or 20% (luxury). Always disclosed before bidding.
Reserve Price | The minimum price below which a seller is not obligated to sell. Set confidentially between seller and platform. Displayed to buyers as "Reserve Met" or "Reserve Not Met" — the exact amount is never disclosed publicly.
Lot | A single item or group of items offered as a single unit in a Traditional Auction. Each lot is assigned a sequential lot number within a given auction event and is accompanied by a detailed catalogue description.
Starting Bid | The minimum bid amount required to open bidding on an item. Set by the seller; typically below the reserve price to encourage initial participation.
Auto-Bid | A MoneyMart feature that allows a buyer to set a maximum bid ceiling and increment size. The system automatically places bids on the buyer's behalf, incrementally, each time they are outbid, up to their stated maximum — without requiring real-time manual input.
Live Drop | A creator-curated item released mid-stream for immediate live auction. Announced by the creator during a live stream; typically generates the highest engagement and fastest bidding activity of any item type on the platform.
Anti-Snipe Extension | A MoneyMart auction mechanic that automatically extends the countdown timer by 30 seconds any time a bid is placed within the final 10 seconds. Prevents last-second bid sniping and ensures fair competition.
MoneyMart Verified (MV) | A quality and authenticity badge awarded to items that have passed MoneyMart's authentication process. Required for high-value categories; builds buyer trust and commands price premiums in the secondary marketplace.
GMV | Gross Merchandise Value. The total dollar value of all items sold on the platform, before deducting fees, refunds, or returns. The primary top-line metric for MoneyMart's marketplace health.
--- END TABLE ---

[Heading 2] 12.2 Third-Party Dependencies

--- TABLE ---
Layer | Dependency | Purpose
Mobile | React Native (Expo SDK 53), React Navigation v7, Redux Toolkit, RTK Query, Socket.IO client, react-native-video, Firebase SDK (Auth + FCM), Stripe React Native SDK, Paystack React Native, Victory Native (charts), React Native Reanimated, Expo Camera, Expo Image Picker | Full mobile app dependency stack — iOS + Android
Web | Next.js 15, React 19, Tailwind CSS, shadcn/ui, Zustand, TanStack Query, Socket.IO client, Video.js, HLS.js, NextAuth.js, Stripe.js, Mixpanel JS SDK, PostHog JS | Full web platform stack
Backend | Node.js 22, Express.js, Socket.IO (server), Redis Cluster, MongoDB Atlas, Elasticsearch 8, Kong Gateway, Firebase Admin SDK, AWS SDK (S3, MediaLive, Rekognition), Bull (job queue), Winston (logging), Jest + Supertest (testing) | Backend services and infrastructure
Payments | Stripe (USD/GBP/CAD), Paystack (NGN), Flutterwave (Africa), M-Pesa Daraja API (KES), MTN MoMo API, Avalara AvaTax (tax), Open Exchange Rates API (FX) | Multi-market payment processing and tax compliance
Media | Mux (stream hosting, playback SDK, VOD), AWS MediaLive (live ingest/transcode), AWS CloudFront (CDN), AWS S3 (storage), Cloudinary (image optimisation and transformation) | Live streaming, VOD, image delivery pipeline
Ops / Infra | Vercel (web hosting), AWS ECS Fargate (backend containers), GitHub Actions (CI/CD), EAS Build (mobile CI/CD), Sentry (error tracking), Datadog (APM and infrastructure monitoring), Crowdin (translation management), Twilio Verify (OTP) | Operational infrastructure and observability
--- END TABLE ---

[Heading 2] 12.3 Compliance Checklist by Country

--- TABLE ---
Requirement | Nigeria | USA | UK | Canada
Data Protection / Privacy | NDPR (Nigeria Data Protection Regulation) | CCPA (California); state-level laws | UK GDPR + Data Protection Act 2018 | PIPEDA; Quebec Law 25
Payment / Financial | CBN payment service provider licence; FCCPC | FinCEN MSB registration; state money transmitter licences | FCA authorisation (Payment Institution) | FINTRAC registration; PCMLTFA compliance
Auction-Specific | FCCPC consumer protection compliance | FTC Guides on auction practices; state auctioneer licences (varies) | Consumer Rights Act 2015; ASA advertising rules | Provincial auction acts (ON, BC, QC, AB differ)
Tax / VAT | VAT (7.5%) on services; WHT on creator payouts | Sales tax via Avalara (state-by-state); 1099-K reporting | VAT (20%) on buyer's premium + fees; Making Tax Digital | GST/HST on fees (varies by province)
KYC / AML | BVN verification for NGN payouts; NIN for high-value | SSN / EIN for 1099-K; Stripe Identity for high-value sellers | UK ID verification; enhanced due diligence for items >£10,000 | SIN collection for tax reporting; ID verification
Age Verification | 18+ required for account creation | 18+ required; COPPA for under-13 (children's content restriction) | 18+ required; ICO Age Appropriate Design Code | 18+ required
--- END TABLE ---


--- TABLE ---
NOTE ON COMPLIANCE / This checklist is a high-level guide only. MoneyMart must retain qualified legal counsel in each operating jurisdiction before launch. Regulatory requirements are subject to change. Country-specific compliance reviews should be conducted quarterly.
--- END TABLE ---

[Heading 2] 12.4 Brand Asset Usage Guidelines
Logo lockup: Always use the official MoneyMart logo files provided in the brand asset library. Do not recreate the logo from scratch. Minimum clear space around the logo is equal to the height of the "M" letterform on all sides.
Color usage: Primary Gold (#F5A623) should never be used as body text color — it is reserved for backgrounds, CTAs, and graphic accents against Deep Navy or white surfaces only. Electric Green (#00D4A1) is reserved exclusively for live/active state indicators, success states, and earning-related data points.
Typography: Do not use Clash Display below 18pt. Inter is the only approved typeface for UI text, form fields, and body copy in digital interfaces. Space Grotesk is exclusively for numerical/data display (prices, counts, timers) — do not use for general copy.
Tagline: "Bid. Stream. Win." must always appear with three periods as shown. Do not alter, abbreviate, or punctuate differently. The tagline is always set in either Primary Gold or Deep Navy — never in another color.
Photography style: Item photography must use clean white or light grey (#F5F5F5) backgrounds. No lifestyle photography for item listings. Creator photography may use branded backgrounds (Deep Navy with Electric Green lighting accents).
Co-branding: Third-party brand logos used in partner integrations must appear at 80% of the MoneyMart logo height and be separated by a 1px vertical divider in Charcoal (#1C1C1E). MoneyMart's logo always appears first (left) in co-branded lockups.
Prohibited uses: Do not place the logo on photographic backgrounds without an approved opacity barrier. Do not use the logo in colors other than the approved brand palette. Do not distort, rotate, or apply effects to the logo. Do not use the Electric Green color on error states or warning messages (reserved for positive/live states only; use red #E53E3E for errors).
MoneyMart Master Product Blueprint  |  Version 2.0  |  October 2026  |  Prepared by MoneyMart Product Team
 CONFIDENTIAL — This document is intended solely for authorised MoneyMart team members and approved partners. Do not distribute externally without written approval from the MoneyMart executive team.
 © 2026 MoneyMart. All rights reserved. "Bid. Stream. Win."