/**
 * MoneyMart Design Tokens — single source of truth.
 * Blueprint §2 Brand Identity. Every surface (mobile, web, TV) imports from here.
 * Surgical rule: never hard-code a brand value in an app; import it from this module.
 */
/* ─────────────────────────────────────────────────────────────
   2.2 COLOR PALETTE — the five mandated brand colours
   ───────────────────────────────────────────────────────────── */
export const palette = {
    /** Primary Gold — energy, wealth, ambition. CTAs, bid buttons, price tags. */
    gold: '#F5A623',
    /** Deep Navy — trust, authority. Primary dark background. */
    navy: '#0D1B2A',
    /** Electric Green — live activity, success. LIVE badges, winning state. */
    green: '#00D4A1',
    /** Pure White — surface and readability. */
    white: '#FFFFFF',
    /** Charcoal — dark UI surfaces, secondary stream overlay panels. */
    charcoal: '#1C1C1E',
};
/** Derived brand values — extensions of the mandated five, never replacements. */
export const brand = {
    gold: palette.gold,
    goldDeep: '#D98A0F',
    goldSoft: 'rgba(245, 166, 35, 0.14)',
    goldLine: 'rgba(245, 166, 35, 0.32)',
    navy: palette.navy,
    navyDeep: '#070F18',
    green: palette.green,
    greenSoft: 'rgba(0, 212, 161, 0.14)',
    white: palette.white,
    charcoal: palette.charcoal,
    /** Error red — mandated for error/warning states (green is reserved for positive). */
    error: '#E53E3E',
    warning: '#F6A623',
    info: '#4A9DEC',
};
/** Semantic surface tokens — dark-first premium UI. */
export const surface = {
    base: '#0A1520',
    raised: '#0F1E2E',
    overlay: 'rgba(13, 27, 42, 0.82)',
    glass: 'rgba(19, 34, 52, 0.66)',
    card: '#12233A',
    cardHover: '#16294225',
    border: 'rgba(245, 166, 35, 0.16)',
    borderStrong: 'rgba(245, 166, 35, 0.38)',
    divider: 'rgba(255, 255, 255, 0.08)',
    scrim: 'rgba(7, 15, 24, 0.72)',
};
export const text = {
    primary: '#F4F7FA',
    secondary: 'rgba(244, 247, 250, 0.72)',
    tertiary: 'rgba(244, 247, 250, 0.48)',
    inverse: palette.navy,
    gold: palette.gold,
    green: palette.green,
    error: '#FF6B6B',
};
export const gradient = {
    gold: 'linear-gradient(135deg, #F5A623 0%, #FFC85C 50%, #D98A0F 100%)',
    navy: 'linear-gradient(180deg, #0D1B2A 0%, #070F18 100%)',
    live: 'linear-gradient(120deg, #00D4A1 0%, #F5A623 100%)',
    heroScrim: 'linear-gradient(180deg, rgba(7,15,24,0) 0%, rgba(7,15,24,0.65) 55%, #070F18 100%)',
    cardSheen: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 60%)',
};
/* ─────────────────────────────────────────────────────────────
   2.3 TYPOGRAPHY — Clash Display / Inter / Space Grotesk
   ───────────────────────────────────────────────────────────── */
export const fontFamily = {
    /** Display — hero headlines, section titles, auction event names. Never below 18pt. */
    display: "'Clash Display', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    /** Body / UI — body copy, labels, navigation, form fields. */
    body: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    /** Accent / Data — prices, bid counts, countdown timers, lot numbers. Numerals only. */
    data: "'Space Grotesk', 'Inter', ui-monospace, 'SF Mono', Menlo, monospace",
};
/** Fluid type scale. Display sizes carry the Goldilocks premium tone. */
export const fontSize = {
    '2xs': '0.6875rem', // 11
    xs: '0.75rem', // 12
    sm: '0.8125rem', // 13
    base: '0.9375rem', // 15
    md: '1rem', // 16
    lg: '1.125rem', // 18
    xl: '1.375rem', // 22
    '2xl': '1.75rem', // 28
    '3xl': '2.25rem', // 36
    '4xl': '3rem', // 48
    '5xl': '3.75rem', // 60
    '6xl': '4.75rem', // 76
};
export const fontWeight = {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800,
};
export const lineHeight = {
    tight: 1.05,
    snug: 1.2,
    normal: 1.5,
    relaxed: 1.65,
};
export const letterSpacing = {
    tighter: '-0.03em',
    tight: '-0.015em',
    normal: '0em',
    wide: '0.02em',
    wider: '0.08em',
    widest: '0.18em',
};
/* ─────────────────────────────────────────────────────────────
   SPACING / RADII / ELEVATION
   ───────────────────────────────────────────────────────────── */
export const space = {
    0: '0px',
    1: '0.25rem',
    2: '0.5rem',
    3: '0.75rem',
    4: '1rem',
    5: '1.25rem',
    6: '1.5rem',
    8: '2rem',
    10: '2.5rem',
    12: '3rem',
    16: '4rem',
    20: '5rem',
    24: '6rem',
};
export const radius = {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '22px',
    '2xl': '28px',
    pill: '999px',
    circle: '50%',
};
export const shadow = {
    sm: '0 1px 2px rgba(0,0,0,0.35)',
    md: '0 6px 20px rgba(0,0,0,0.38)',
    lg: '0 18px 48px rgba(0,0,0,0.46)',
    xl: '0 32px 80px rgba(0,0,0,0.55)',
    gold: '0 10px 34px rgba(245,166,35,0.30)',
    green: '0 10px 34px rgba(0,212,161,0.26)',
    inset: 'inset 0 1px 0 rgba(255,255,255,0.06)',
};
/* ─────────────────────────────────────────────────────────────
   2.5 MOTION — blueprint timings
   ───────────────────────────────────────────────────────────── */
export const motion = {
    /** Confetti burst on winning bid — 1.2s, GPU accelerated. */
    confetti: 1200,
    /** Pulse ring on LIVE indicators — 1.8s loop, opacity 100% → 0%. */
    pulse: 1800,
    /** Card flip reveal — 400ms ease-in-out, 180° Y-axis. */
    cardFlip: 400,
    fast: 140,
    base: 240,
    slow: 420,
    /** Stream controls auto-hide. */
    controlsHide: 3000,
    easeOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
    easeInOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};
export const zIndex = {
    base: 0,
    raised: 10,
    sticky: 100,
    overlay: 500,
    modal: 900,
    toast: 1000,
    confetti: 1100,
};
export const breakpoint = {
    mobile: 0,
    tablet: 768,
    desktop: 1024,
    wide: 1440,
};
/* ─────────────────────────────────────────────────────────────
   DOMAIN CONSTANTS — blueprint §4, §9, §10, §12.1
   ───────────────────────────────────────────────────────────── */
export const currency = {
    NGN: { code: 'NGN', symbol: '₦', locale: 'en-NG', label: 'Nigerian Naira', country: 'Nigeria', flag: '🇳🇬' },
    USD: { code: 'USD', symbol: '$', locale: 'en-US', label: 'US Dollar', country: 'USA', flag: '🇺🇸' },
    GBP: { code: 'GBP', symbol: '£', locale: 'en-GB', label: 'Pound Sterling', country: 'UK', flag: '🇬🇧' },
    CAD: { code: 'CAD', symbol: 'CA$', locale: 'en-CA', label: 'Canadian Dollar', country: 'Canada', flag: '🇨🇦' },
    KES: { code: 'KES', symbol: 'KSh', locale: 'en-KE', label: 'Kenyan Shilling', country: 'Kenya', flag: '🇰🇪' },
    GHS: { code: 'GHS', symbol: 'GH₵', locale: 'en-GH', label: 'Ghanaian Cedi', country: 'Ghana', flag: '🇬🇭' },
    ZAR: { code: 'ZAR', symbol: 'R', locale: 'en-ZA', label: 'South African Rand', country: 'South Africa', flag: '🇿🇦' },
};
/** Static launch FX table (Open Exchange Rates stand-in for local dev). */
export const fxToUSD = {
    USD: 1,
    NGN: 1 / 1580,
    GBP: 1.27,
    CAD: 0.73,
    KES: 1 / 129,
    GHS: 1 / 15.4,
    ZAR: 0.055,
};
export const auctionType = {
    live_stream: 'Live Stream',
    traditional: 'Traditional Auction',
    buy_now: 'Buy Now',
    make_offer: 'Make an Offer',
};
export const auctionStatus = ['draft', 'scheduled', 'live', 'ended', 'sold', 'cancelled'];
export const conditionGrades = [
    { value: 'new', label: 'New', hint: 'Unused, sealed, or in original packaging.' },
    { value: 'like_new', label: 'Like New', hint: 'Used once or twice; no visible wear.' },
    { value: 'good', label: 'Good', hint: 'Light wear consistent with careful use.' },
    { value: 'fair', label: 'Fair', hint: 'Visible wear; fully functional.' },
    { value: 'parts', label: 'Parts Only', hint: 'Not functional; sold for parts or repair.' },
];
export const categories = [
    { id: 'sneakers', label: 'Sneakers', emoji: '👟' },
    { id: 'watches', label: 'Watches', emoji: '⌚' },
    { id: 'jewelry', label: 'Jewelry', emoji: '💎' },
    { id: 'art', label: 'Art', emoji: '🖼️' },
    { id: 'collectibles', label: 'Collectibles', emoji: '🏺' },
    { id: 'cards', label: 'Trading Cards', emoji: '🃏' },
    { id: 'fashion', label: 'Fashion', emoji: '🧥' },
    { id: 'electronics', label: 'Electronics', emoji: '🎧' },
    { id: 'vehicles', label: 'Vehicles', emoji: '🚗' },
    { id: 'antiques', label: 'Antiques', emoji: '🕰️' },
];
export const MONETIZATION = {
    /** §10 Creator revenue share — platform retains 15% of live GMV. */
    creatorPlatformShare: 0.15,
    creatorShare: 0.85,
    /** §10 Buyer's premium — 15% standard, 20% luxury/premium categories. */
    buyersPremiumStandard: 0.15,
    buyersPremiumLuxury: 0.2,
    /** §10 MoneyMart Pro reduces premium. */
    proBuyersPremiumStandard: 0.1,
    proBuyersPremiumLuxury: 0.15,
    /** §10 Cross-border fee. */
    crossBorderFee: 0.015,
    /** Luxury categories carrying the 20% premium. */
    luxuryCategories: ['watches', 'jewelry', 'art', 'vehicles'],
    listingFeeFreeTier: 10,
    listingFeeRange: [0.5, 5.0],
};
/** §9.2 Anti-snipe: a bid inside the final window extends the clock. */
export const ANTI_SNIPE = {
    triggerWindowMs: 10_000,
    extensionMs: 30_000,
};
/** §5.2 Stream item drops run 30–120s, creator-set. */
export const ITEM_TIMER = {
    min: 30,
    max: 120,
    default: 45,
};
/** §7.2 TV UX minimums. */
export const TV = {
    minBodyPt: 32,
    minHeadingPt: 56,
    focusBorderPx: 4,
    minFocusWidthPx: 200,
    minFocusHeightPx: 80,
    heroIntervalMs: 8000,
    controlsHideMs: 5000,
};
export const tokens = {
    palette,
    brand,
    surface,
    text,
    gradient,
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight,
    letterSpacing,
    space,
    radius,
    shadow,
    motion,
    zIndex,
    breakpoint,
    currency,
    fxToUSD,
    auctionType,
    auctionStatus,
    conditionGrades,
    categories,
    MONETIZATION,
    ANTI_SNIPE,
    ITEM_TIMER,
    TV,
};
export default tokens;
//# sourceMappingURL=index.js.map