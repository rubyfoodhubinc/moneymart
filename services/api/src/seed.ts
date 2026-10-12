/**
 * MoneyMart demo seed — a full, living auction house.
 *
 * Generates four live creator streams, a scheduled traditional auction,
 * Buy Now / Make Offer listings, bid history, chat, orders, payouts and
 * notifications so every screen in the blueprint has real data behind it.
 *
 * Imagery is procedurally drawn (SVG gradients + crafted overlays) so the
 * platform is fully offline-capable and never shows a broken image.
 */
import type {
  AppNotification,
  Auction,
  AuctionType,
  Bid,
  ChatMessage,
  Item,
  ItemCondition,
  Order,
  Payout,
  Stream,
  User,
} from '@moneymart/types';
import type { CurrencyCode } from '@moneymart/tokens';
import { ITEM_TIMER, MONETIZATION } from '@moneymart/tokens';
import { money } from './engine/money.js';
import { escrow as escrowService } from './engine/escrow.js';
import { auctions, chat, items, notifications, orders, payouts, priceHistory, streams, store, users } from './store.js';

/* ── Procedural premium artwork ─────────────────────────────────────────────
   Each lot gets a deterministic, brand-palette SVG poster. No network calls,
   always renders, and matches the mandated colour discipline.
   ──────────────────────────────────────────────────────────────────────────*/
const ART_THEMES: Record<string, [string, string, string]> = {
  sneakers: ['#12233A', '#F5A623', '#0D1B2A'],
  watches: ['#0D1B2A', '#F5A623', '#1C1C1E'],
  jewelry: ['#1C1C1E', '#00D4A1', '#0D1B2A'],
  art: ['#0D1B2A', '#F5A623', '#00D4A1'],
  collectibles: ['#12233A', '#00D4A1', '#F5A623'],
  cards: ['#0D1B2A', '#F5A623', '#00D4A1'],
  fashion: ['#1C1C1E', '#F5A623', '#0D1B2A'],
  electronics: ['#0D1B2A', '#00D4A1', '#12233A'],
  vehicles: ['#0D1B2A', '#F5A623', '#1C1C1E'],
  antiques: ['#1C1C1E', '#F5A623', '#0D1B2A'],
};

function hash(text: string): number {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 31 + text.charCodeAt(index)) % 100000;
  }
  return value;
}

/**
 * Craft an SVG poster for a lot. Composition: depth gradient, concentric
 * "auction ring" arcs, a gavel silhouette, and the lot monogram.
 */
export function posterFor(title: string, categoryId: string, seedText = ''): string {
  const [base, accent, secondary] = ART_THEMES[categoryId] ?? ART_THEMES.collectibles;
  const seed = hash(`${title}${seedText}`);
  const angle = seed % 360;
  const rings = 3 + (seed % 3);
  const initials = title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

  const ringMarkup = Array.from({ length: rings }, (_, index) => {
    const radius = 118 + index * 46;
    const opacity = (0.32 - index * 0.06).toFixed(2);
    return `<circle cx="500" cy="430" r="${radius}" fill="none" stroke="${accent}" stroke-opacity="${opacity}" stroke-width="2"/>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
<defs>
<linearGradient id="bg" gradientTransform="rotate(${angle} 0.5 0.5)">
<stop offset="0%" stop-color="${base}"/><stop offset="55%" stop-color="${secondary}"/><stop offset="100%" stop-color="#070F18"/>
</linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="${accent}"/><stop offset="100%" stop-color="#FFC85C" stop-opacity="0.85"/>
</linearGradient>
<radialGradient id="glow" cx="50%" cy="42%" r="62%">
<stop offset="0%" stop-color="${accent}" stop-opacity="0.30"/><stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
</radialGradient>
</defs>
<rect width="1000" height="1000" fill="url(#bg)"/>
<rect width="1000" height="1000" fill="url(#glow)"/>
${ringMarkup}
<g transform="translate(500 430) rotate(-24)" opacity="0.95">
<rect x="-14" y="-172" width="28" height="196" rx="8" fill="url(#gold)"/>
<rect x="-96" y="18" width="192" height="42" rx="12" fill="${accent}"/>
<rect x="-96" y="60" width="192" height="10" rx="5" fill="${accent}" opacity="0.55"/>
</g>
<text x="500" y="820" text-anchor="middle" font-family="'Space Grotesk', Inter, sans-serif" font-size="150" font-weight="700" fill="#FFFFFF" fill-opacity="0.10" letter-spacing="6">${initials}</text>
<rect x="0" y="936" width="1000" height="64" fill="#070F18" fill-opacity="0.72"/>
<rect x="0" y="936" width="${140 + (seed % 500)}" height="6" fill="url(#gold)"/>
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\n/g, ''))}`;
}

/** Circular avatar artwork with initials on a brand gradient. */
export function avatarFor(name: string, accent = '#F5A623'): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  const seed = hash(name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
<defs><linearGradient id="a" gradientTransform="rotate(${seed % 360} 0.5 0.5)">
<stop offset="0%" stop-color="#0D1B2A"/><stop offset="100%" stop-color="${accent}"/></linearGradient></defs>
<rect width="200" height="200" fill="url(#a)"/>
<text x="100" y="128" text-anchor="middle" font-family="Inter, sans-serif" font-size="78" font-weight="700" fill="#FFFFFF">${initials}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\n/g, ''))}`;
}

/* ── Users ──────────────────────────────────────────────────────────────── */

interface SeedUser extends Partial<User> {
  id: string;
  displayName: string;
  handle: string;
  countryCode: string;
  currencyCode: CurrencyCode;
  role: User['role'];
  bio: string;
}

const SEED_USERS: SeedUser[] = [
  {
    id: 'usr_ada',
    displayName: 'Ada Okonkwo',
    handle: 'adaluxe',
    countryCode: 'NG',
    currencyCode: 'NGN',
    role: 'creator',
    bio: 'Lagos luxury resale. Live every Thursday 8pm WAT. Verified consignor since 2024.',
  },
  {
    id: 'usr_marcus',
    displayName: 'Marcus Bell',
    handle: 'bellvault',
    countryCode: 'US',
    currencyCode: 'USD',
    role: 'creator',
    bio: 'Sneaker heat + grails. 20 years in the game. Every pair authenticated in-stream.',
  },
  {
    id: 'usr_priya',
    displayName: 'Priya Raman',
    handle: 'hautehour',
    countryCode: 'GB',
    currencyCode: 'GBP',
    role: 'creator',
    bio: 'London watch specialist. Fully serviced timepieces with provenance paperwork.',
  },
  {
    id: 'usr_jules',
    displayName: 'Jules Fontaine',
    handle: 'maisonjules',
    countryCode: 'CA',
    currencyCode: 'CAD',
    role: 'creator',
    bio: 'Montréal art & objects. Contemporary African and diaspora artists.',
  },
  {
    id: 'usr_house',
    displayName: 'MoneyMart House',
    handle: 'moneymarthouse',
    countryCode: 'US',
    currencyCode: 'USD',
    role: 'admin',
    bio: 'Official MoneyMart auction house. Curated traditional sales, expert catalogued.',
  },
  {
    id: 'usr_you',
    displayName: 'Ash Vale',
    handle: 'ashvale',
    countryCode: 'US',
    currencyCode: 'USD',
    role: 'buyer',
    bio: 'Collector of watches and prints. Bidding from Brooklyn.',
  },
  {
    id: 'usr_ken',
    displayName: 'Ken Adeyemi',
    handle: 'kenbids',
    countryCode: 'NG',
    currencyCode: 'NGN',
    role: 'buyer',
    bio: 'Art and cards. Always watching the last ten seconds.',
  },
  {
    id: 'usr_sofia',
    displayName: 'Sofia Marchetti',
    handle: 'sofiam',
    countryCode: 'GB',
    currencyCode: 'GBP',
    role: 'buyer',
    bio: 'Designer goods and vintage electronics.',
  },
];

function buildUsers(): User[] {
  return SEED_USERS.map((seed, index) => ({
    id: seed.id,
    email: `${seed.handle}@moneymart.demo`,
    phone: undefined,
    displayName: seed.displayName,
    handle: seed.handle,
    avatarUrl: avatarFor(seed.displayName, index % 2 === 0 ? '#F5A623' : '#00D4A1'),
    bio: seed.bio,
    countryCode: seed.countryCode,
    currencyCode: seed.currencyCode,
    role: seed.role,
    verificationStatus: seed.role === 'buyer' ? 'verified' : 'verified',
    kycLevel: seed.role === 'buyer' ? 1 : 3,
    rating: 4.6 + ((index * 7) % 4) / 10,
    totalSales: 34 + index * 61,
    followersCount: 1200 + index * 3480,
    followingCount: 88 + index * 12,
    responseTimeMinutes: 5 + index * 9,
    isPro: seed.id === 'usr_you',
    createdAt: new Date(Date.now() - (400 - index * 12) * 86_400_000).toISOString(),
    lastLoginAt: store.iso(-index * 3_600_000),
  }));
}

/* ── Lots ───────────────────────────────────────────────────────────────── */

interface SeedLot {
  id: string;
  sellerId: string;
  title: string;
  description: string;
  categoryId: string;
  condition: ItemCondition;
  type: AuctionType;
  currency: CurrencyCode;
  startingPrice: number;
  currentBid: number;
  reservePrice?: number;
  buyItNowPrice?: number;
  /** minutes from now (negative = already started) */
  endsInMinutes: number;
  startedMinutesAgo: number;
  streamId?: string;
  lotNumber?: string;
  provenance?: string;
  conditionReport?: string;
  verified?: boolean;
  featured?: boolean;
}

const SEED_LOTS: SeedLot[] = [
  {
    id: 'auc_rolex',
    sellerId: 'usr_priya',
    title: 'Rolex Datejust 36 — 2016, Full Set',
    description:
      'Stainless steel Oyster case with fluted white gold bezel, silver sunray dial and Jubilee bracelet. Complete with original box, warranty card dated 2016, and service receipt from 2024. Running within +2s/day on our timing machine.',
    categoryId: 'watches',
    condition: 'like_new',
    type: 'live_stream',
    currency: 'GBP',
    startingPrice: 6200,
    currentBid: 8450,
    reservePrice: 7800,
    endsInMinutes: 9,
    startedMinutesAgo: 26,
    streamId: 'str_hautehour',
    provenance: 'Purchased new at Watches of Switzerland, London, March 2016. Two owners.',
    conditionReport:
      'Case: excellent, light hairlines to lugs. Bezel: crisp fluting, no polish loss. Bracelet: 90% stretch-free, 12 links. Crystal: flawless. Movement: serviced 2024, +2s/day, 68h reserve.',
    verified: true,
    featured: true,
  },
  {
    id: 'auc_adire',
    sellerId: 'usr_ada',
    title: 'Adire Eleko Indigo Panel — Hand-Dyed, 1960s',
    description:
      'Museum-grade Yoruba adire eleko cloth, hand-painted with cassava paste resist and dyed in natural indigo. Twenty-eight classic motifs including Ibadan dun and Olokun. Exhibited twice; stable, unfaded colour.',
    categoryId: 'art',
    condition: 'good',
    type: 'live_stream',
    currency: 'NGN',
    startingPrice: 380000,
    currentBid: 512000,
    reservePrice: 450000,
    endsInMinutes: 4,
    startedMinutesAgo: 41,
    streamId: 'str_adaluxe',
    provenance: 'Private collection, Ibadan, acquired 1978. Gallery documentation included.',
    conditionReport:
      'Cloth: sound, no holes. Indigo: deep and even, minimal fugitive loss at lower edge. Edges: original hem intact. Size 178 x 92 cm.',
    verified: true,
    featured: true,
  },
  {
    id: 'auc_airmax',
    sellerId: 'usr_marcus',
    title: 'Nike Air Max 1 "Cherrywood" — US 10, OG Box',
    description:
      'Deadstock pair with original box, tissue and hangtag. Never laced, never worn. Stored in a climate-controlled room since release. A grail for any serious Air Max collector.',
    categoryId: 'sneakers',
    condition: 'new',
    type: 'live_stream',
    currency: 'USD',
    startingPrice: 1400,
    currentBid: 1875,
    reservePrice: 1800,
    endsInMinutes: 11,
    startedMinutesAgo: 18,
    streamId: 'str_bellvault',
    provenance: 'Purchased at retail, single owner, never worn. Receipt on file.',
    conditionReport: 'Deadstock. Midsole un-yellowed. Box: 9/10 with minor shelf wear.',
    verified: true,
    featured: true,
  },
  {
    id: 'auc_banksy',
    sellerId: 'usr_jules',
    title: 'Banksy — "Girl with Balloon" Signed Print',
    description:
      'Screen print in colours on wove paper, signed and numbered from an edition of 150. Pest Control certificate of authenticity included. Float-mounted in a museum frame with UV glass.',
    categoryId: 'art',
    condition: 'like_new',
    type: 'live_stream',
    currency: 'CAD',
    startingPrice: 18000,
    currentBid: 26400,
    reservePrice: 22000,
    endsInMinutes: 16,
    startedMinutesAgo: 12,
    streamId: 'str_maisonjules',
    provenance: 'Acquired from a London gallery in 2009. Pest Control certificate #PC-04412.',
    conditionReport: 'Sheet: full margins, no foxing, no fading. Frame: minor scuff to lower rail.',
    verified: true,
  },
  {
    id: 'auc_charizard',
    sellerId: 'usr_marcus',
    title: 'Charizard Base Set Holo — PSA 9',
    description:
      '1999 Pokémon Base Set Charizard, unlimited print, graded PSA 9 (MINT). Sharp corners, strong centring and a clean holo surface. Ships double-boxed and fully insured.',
    categoryId: 'cards',
    condition: 'like_new',
    type: 'live_stream',
    currency: 'USD',
    startingPrice: 1800,
    currentBid: 2280,
    reservePrice: 2000,
    endsInMinutes: 22,
    startedMinutesAgo: 8,
    streamId: 'str_bellvault',
    provenance: 'Pulled from sealed product in 1999. Graded 2025, case never opened.',
    conditionReport: 'PSA 9. Centring 55/45. Holo: no scratching under raking light. Case: flawless.',
    verified: true,
  },
  {
    id: 'auc_walkman',
    sellerId: 'usr_sofia',
    title: 'Sony Walkman WM-EX9 — Fully Serviced',
    description:
      'The slimmest cassette Walkman Sony ever produced. New belts, new pinch roller, professionally aligned. Includes original remote, gumstick battery and charging dock.',
    categoryId: 'electronics',
    condition: 'good',
    type: 'buy_now',
    currency: 'GBP',
    startingPrice: 385,
    currentBid: 0,
    buyItNowPrice: 385,
    endsInMinutes: 60 * 24 * 9,
    startedMinutesAgo: 180,
    provenance: 'Single owner since 1998. Full service record from 2025.',
    conditionReport: 'Cosmetic: light edge wear. Function: tape transport verified, azimuth aligned.',
    verified: false,
  },
  {
    id: 'auc_nollywood',
    sellerId: 'usr_ada',
    title: 'Nollywood Golden Era Poster Collection — 12 Sheets',
    description:
      'Twelve original hand-painted cinema posters from the 1980s Lagos video boom. Sold as a single lot. Each sheet photographed and catalogued individually.',
    categoryId: 'collectibles',
    condition: 'fair',
    type: 'make_offer',
    currency: 'NGN',
    startingPrice: 240000,
    currentBid: 0,
    endsInMinutes: 60 * 24 * 12,
    startedMinutesAgo: 90,
    provenance: 'Salvaged from the Ijora cinema archive, 2019.',
    conditionReport: 'Folding creases throughout, one sheet with a 4cm edge tear. Painted surfaces bright.',
    verified: false,
  },
  {
    id: 'auc_audi',
    sellerId: 'usr_house',
    title: 'Lagos Canvas Series — Contemporary Art, 6 Lots',
    description:
      'Formally catalogued evening sale of six contemporary works from West African and diaspora artists. Expert-written descriptions, full provenance research, condition reports by our conservator.',
    categoryId: 'art',
    condition: 'good',
    type: 'traditional',
    currency: 'USD',
    startingPrice: 9500,
    currentBid: 12200,
    reservePrice: 11000,
    endsInMinutes: 60 * 24 * 6,
    startedMinutesAgo: 0,
    lotNumber: 'LOT 114',
    provenance: 'Direct from each artist studio unless noted. Full catalogue published.',
    conditionReport: 'Conservator reports per lot inside the digital catalogue.',
    verified: true,
    featured: true,
  },
  {
    id: 'auc_patek',
    sellerId: 'usr_priya',
    title: 'Patek Philippe Calatrava 5196G — White Gold',
    description:
      'A quietly perfect dress watch in 18k white gold with a silver opaline dial and small seconds. Full set with extract from the archives. Serviced by Patek in 2025.',
    categoryId: 'watches',
    condition: 'like_new',
    type: 'traditional',
    currency: 'GBP',
    startingPrice: 17500,
    currentBid: 19800,
    reservePrice: 21000,
    endsInMinutes: 60 * 24 * 4,
    startedMinutesAgo: 0,
    lotNumber: 'LOT 87',
    provenance: 'Purchased 2014, Geneva. One owner, extract from the archives on file.',
    conditionReport: 'Case: unpolished, sharp. Dial: flawless. Movement: Patek service 2025, warranty to 2027.',
    verified: true,
  },
  {
    id: 'auc_ps5',
    sellerId: 'usr_jules',
    title: 'PS5 Pro Bundle + 3 Sealed Titles',
    description:
      'PS5 Pro console with two DualSense controllers, vertical stand and three sealed launch titles. Adult-owned, smoke-free home, under six hours of use.',
    categoryId: 'electronics',
    condition: 'like_new',
    type: 'buy_now',
    currency: 'CAD',
    startingPrice: 880,
    currentBid: 0,
    buyItNowPrice: 880,
    endsInMinutes: 60 * 24 * 20,
    startedMinutesAgo: 240,
    provenance: 'Retail purchase, single owner.',
    conditionReport: 'Console: as new, no scratches. Controllers: sealed spares unused.',
    verified: false,
  },
  {
    id: 'auc_grandfather',
    sellerId: 'usr_house',
    title: 'George III Mahogany Longcase Clock, c.1790',
    description:
      'Eight-day longcase clock with a moonphase arch dial by a noted provincial maker. Original movement recently overhauled; case retains superb figure and patina.',
    categoryId: 'antiques',
    condition: 'good',
    type: 'traditional',
    currency: 'GBP',
    startingPrice: 4200,
    currentBid: 5600,
    reservePrice: 5000,
    endsInMinutes: 60 * 24 * 2,
    startedMinutesAgo: 0,
    lotNumber: 'LOT 42',
    provenance: 'By descent through a Somerset family since 1901.',
    conditionReport: 'Case: minor veneer losses to base. Movement: overhauled 2025, striking correctly on the hour.',
    verified: true,
  },
  {
    id: 'auc_hublot',
    sellerId: 'usr_marcus',
    title: 'Hublot Big Bang Steel — 44mm, Boxed',
    description:
      'Ceramic bezel, rubber strap, automatic chronograph. Complete with box and papers. A bold daily wear with real presence on the wrist.',
    categoryId: 'watches',
    condition: 'good',
    type: 'live_stream',
    currency: 'USD',
    startingPrice: 5200,
    currentBid: 6100,
    reservePrice: 6000,
    endsInMinutes: 6,
    startedMinutesAgo: 33,
    streamId: 'str_bellvault',
    provenance: 'Authorised dealer purchase 2019. One owner.',
    conditionReport: 'Case: light swirls, unpolished. Bezel: two tiny hairlines at 4 o’clock. Strap: 80% life.',
    verified: true,
  },
  {
    id: 'auc_kente',
    sellerId: 'usr_ada',
    title: 'Kente Cloth — Royal Ashanti Weave, Silk',
    description:
      'Hand-woven silk and rayon kente in the Adweneasa pattern, reserved historically for royalty. Each strip woven on a traditional narrow loom. Sold with weaving documentation.',
    categoryId: 'fashion',
    condition: 'like_new',
    type: 'live_stream',
    currency: 'NGN',
    startingPrice: 420000,
    currentBid: 465000,
    endsInMinutes: 30,
    startedMinutesAgo: 5,
    streamId: 'str_adaluxe',
    provenance: 'Commissioned directly from a master weaver in Bonwire, 2024.',
    conditionReport: 'Textile: pristine, never worn. Colours: colourfast, no running.',
    verified: true,
  },
  {
    id: 'auc_lebron',
    sellerId: 'usr_jules',
    title: 'LeBron James Rookie Card — BGS 8.5',
    description:
      '2003-04 Topps Chrome LeBron James rookie, graded BGS 8.5 with sharp edges and a clean surface. A cornerstone modern card with relentless demand.',
    categoryId: 'cards',
    condition: 'like_new',
    type: 'live_stream',
    currency: 'USD',
    startingPrice: 4200,
    currentBid: 5400,
    reservePrice: 5000,
    endsInMinutes: 3,
    startedMinutesAgo: 47,
    streamId: 'str_maisonjules',
    provenance: 'Pulled from a hobby box in 2004, held personally since.',
    conditionReport: 'BGS 8.5. Subgrades: centring 9, corners 8, edges 8.5, surface 8.5.',
    verified: true,
  },
];

const STREAM_SEED: {
  id: string;
  creatorId: string;
  title: string;
  category: string;
  status: Stream['status'];
  viewers: number;
  startOffsetMinutes: number;
  queue: string[];
}[] = [
  {
    id: 'str_adaluxe',
    creatorId: 'usr_ada',
    title: 'Lagos Luxe Live — Indigo, Kente & Gold',
    category: 'art',
    status: 'live',
    viewers: 3412,
    startOffsetMinutes: -44,
    queue: ['auc_adire', 'auc_kente'],
  },
  {
    id: 'str_bellvault',
    creatorId: 'usr_marcus',
    title: 'Bell Vault — Grail Night',
    category: 'sneakers',
    status: 'live',
    viewers: 5879,
    startOffsetMinutes: -35,
    queue: ['auc_airmax', 'auc_hublot', 'auc_charizard'],
  },
  {
    id: 'str_hautehour',
    creatorId: 'usr_priya',
    title: 'Haute Hour — London Watch Room',
    category: 'watches',
    status: 'live',
    viewers: 2154,
    startOffsetMinutes: -28,
    queue: ['auc_rolex'],
  },
  {
    id: 'str_maisonjules',
    creatorId: 'usr_jules',
    title: 'Maison Jules — Contemporary & Cards',
    category: 'art',
    status: 'live',
    viewers: 1637,
    startOffsetMinutes: -14,
    queue: ['auc_lebron', 'auc_banksy'],
  },
  {
    id: 'str_lagos_canvas',
    creatorId: 'usr_house',
    title: 'Lagos Canvas Series — Evening Sale',
    category: 'art',
    status: 'scheduled',
    viewers: 0,
    startOffsetMinutes: 60 * 24,
    queue: ['auc_audi'],
  },
];

const CHAT_LINES: [string, string][] = [
  ['usr_ken', 'This indigo is unreal 😍'],
  ['usr_sofia', 'Do you ship to Manchester?'],
  ['usr_ada', 'Yes — DHL next day, fully insured 💛'],
  ['usr_you', 'Bidding on this one for sure'],
  ['usr_ken', 'Reserve met?'],
  ['usr_ada', 'Reserve just met! Going once…'],
  ['usr_sofia', 'That bracelet is stretch-free, rare'],
  ['usr_marcus', 'Whoever takes the Cherrywoods is getting a steal'],
];

/* ── The seed ───────────────────────────────────────────────────────────── */

/**
 * Clear every collection so `seed()` is idempotent. Used by the dev reset
 * control so demo, QA and the verification suite always start from the same
 * known-good auction house instead of inheriting the last run's mutations.
 */
export function clear(): void {
  const { db } = store;
  db.users.clear();
  db.items.clear();
  db.auctions.clear();
  db.bids.clear();
  db.autoBids.clear();
  db.streams.clear();
  db.chat.clear();
  db.orders.clear();
  db.payouts.clear();
  db.notifications.clear();
  db.priceHistory.clear();
}

/** Wipe and rebuild the demo world. */
export function reseed(): void {
  clear();
  seed();
}

export function seed(): void {
  buildUsers().forEach((user) => users.upsert(user));
  store.db.session.userId = 'usr_you';

  const now = Date.now();

  SEED_LOTS.forEach((lot, index) => {
    const artwork = posterFor(lot.title, lot.categoryId, lot.id);
    const item: Item = {
      id: `itm_${lot.id.slice(4)}`,
      sellerId: lot.sellerId,
      title: lot.title,
      description: lot.description,
      categoryId: lot.categoryId,
      condition: lot.condition,
      images: [artwork, posterFor(`${lot.title} detail`, lot.categoryId, `${lot.id}-b`)],
      provenance: lot.provenance,
      conditionReport: lot.conditionReport,
      authenticityStatus: lot.verified ? 'verified' : 'unverified',
      isVerified: Boolean(lot.verified),
      createdAt: new Date(now - (index + 4) * 3_600_000).toISOString(),
      updatedAt: store.iso(-index * 600_000),
    };
    items.create(item);

    const isBuyNowOrOffer = lot.type === 'buy_now' || lot.type === 'make_offer';
    const isTraditional = lot.type === 'traditional';

    const auction: Auction = {
      id: lot.id,
      itemId: item.id,
      sellerId: lot.sellerId,
      auctionType: lot.type,
      title: lot.title,
      startingPrice: lot.startingPrice,
      reservePrice: lot.reservePrice,
      currentBid: lot.currentBid,
      bidCount: 0,
      buyItNowPrice: lot.buyItNowPrice,
      startTime: new Date(now - lot.startedMinutesAgo * 60_000).toISOString(),
      endTime: new Date(now + lot.endsInMinutes * 60_000).toISOString(),
      status: isBuyNowOrOffer ? 'live' : isTraditional ? 'scheduled' : 'live',
      buyersPremiumRate: money.buyersPremiumRate(lot.categoryId, false),
      currency: lot.currency,
      lotNumber: lot.lotNumber,
      streamId: lot.streamId,
      watchers: 40 + ((index * 137) % 900),
      featured: lot.featured,
    };

    // Buy Now lots are instantly purchasable; Make Offer lots await offers.
    if (isTraditional) {
      auction.status = 'scheduled';
    }

    auctions.create(auction);

    // Synthesise a believable bid ladder that arrives at the current price.
    if (lot.currentBid > 0) {
      const bidderPool = ['usr_ken', 'usr_sofia', 'usr_you', 'usr_marcus'];
      const steps = 6 + (index % 5);
      const floor = lot.startingPrice;
      const span = lot.currentBid - floor;
      for (let step = 0; step < steps; step += 1) {
        const ratio = step / Math.max(1, steps - 1);
        const amount = money.round2(floor + span * ratio);
        const bidderId = bidderPool[(index + step) % bidderPool.length]!;
        const bidder = users.get(bidderId)!;
        const minutesAgo = (steps - step) * (2 + (index % 4));
        const isAuto = step % 3 === 0 && step > 0;
        const bid: Bid = {
          id: store.nextId('bid'),
          auctionId: auction.id,
          bidderId,
          bidderHandle: bidder.handle,
          amount,
          currency: auction.currency,
          timestamp: new Date(now - minutesAgo * 60_000).toISOString(),
          isAutoBid: isAuto,
          status: 'accepted',
        };
        const list = store.db.bids.get(auction.id) ?? [];
        list.unshift(bid);
        store.db.bids.set(auction.id, list);
      }
      const list = store.db.bids.get(auction.id)!;
      // Newest (index 0) holds the top bid; flag the runners-up as outbid.
      list.forEach((bid, bidIndex) => {
        bid.status = bidIndex === 0 ? 'winning' : 'outbid';
      });
      auction.currentBidderId = list[0]!.bidderId;
      auction.currentBid = list[0]!.amount;
      auction.bidCount = list.length;
      auctions.save(auction);
    }
  });

  // Streams with a live clock and a seamless item queue.
  STREAM_SEED.forEach((seedStream) => {
    const creator = users.require(seedStream.creatorId);
    const isLive = seedStream.status === 'live';
    const stream: Stream = {
      id: seedStream.id,
      creatorId: seedStream.creatorId,
      title: seedStream.title,
      category: seedStream.category,
      scheduledStartTime: new Date(now + seedStream.startOffsetMinutes * 60_000).toISOString(),
      actualStartTime: isLive ? new Date(now + seedStream.startOffsetMinutes * 60_000).toISOString() : undefined,
      status: seedStream.status,
      viewerCount: seedStream.viewers,
      peakViewerCount: Math.round(seedStream.viewers * 1.35),
      hlsUrl: `https://stream.moneymart.demo/hls/${seedStream.id}/index.m3u8`,
      posterUrl: posterFor(seedStream.title, seedStream.category, seedStream.id),
      itemQueue: seedStream.queue,
      activeAuctionId: isLive ? seedStream.queue[0] : undefined,
      totalGMV: isLive ? 148_250 + seedStream.viewers * 12 : 0,
      chatEnabled: true,
      recordingUrl: undefined,
    };
    streams.create(stream);

    // Ensure the active lot's window is short and live — an item drop in progress.
    if (isLive && stream.activeAuctionId) {
      const active = auctions.get(stream.activeAuctionId);
      if (active) {
        active.status = 'live';
        active.endTime = new Date(now + (25 + (seedStream.viewers % 60)) * 1000).toISOString();
        const item = items.get(active.itemId);
        streams.save({
          ...stream,
          viewerCount: seedStream.viewers,
          posterUrl: item?.images[0] ?? stream.posterUrl,
        });
        auctions.save(active);
      }
    }

    // Chat with a pinned creator message.
    CHAT_LINES.forEach((line, lineIndex) => {
      const [userId, body] = line;
      const author = users.get(userId);
      if (!author) return;
      const message: ChatMessage = {
        id: store.nextId('msg'),
        streamId: seedStream.id,
        userId,
        displayName: author.displayName,
        body,
        isPinned: lineIndex === 5 && isLive,
        isCreator: userId === seedStream.creatorId,
        createdAt: new Date(now - (CHAT_LINES.length - lineIndex) * 26_000).toISOString(),
      };
      chat.addChat(message);
    });

    if (isLive) {
      notifications.create({
        id: store.nextId('ntf'),
        userId: 'usr_you',
        category: 'streams',
        title: `${creator.displayName} is live`,
        body: seedStream.title,
        href: `/stream/${seedStream.id}`,
        read: false,
        createdAt: store.iso(-6 * 60_000),
      });
    }
  });

  // Price history — §4.3 last 12 months of completed sales.
  const now2 = Date.now();
  const monthLabels = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now2 - (11 - index) * 30 * 86_400_000);
    return date.toLocaleDateString('en-US', { month: 'short' });
  });
  const historyBase: Record<string, number> = {
    watches: 7800,
    sneakers: 1150,
    art: 16400,
    cards: 2100,
    jewelry: 4400,
    collectibles: 900,
    electronics: 520,
    fashion: 1800,
    antiques: 3900,
    vehicles: 24000,
  };
  Object.entries(historyBase).forEach(([categoryId, base]) => {
    let value = base;
    const points = monthLabels.map((label, index) => {
      const drift = Math.sin(index / 1.7) * 0.06 + (index % 3 === 0 ? 0.03 : -0.01);
      value = Math.max(base * 0.7, value * (1 + drift));
      return { label, value: Math.round(value) };
    });
    priceHistory.set(categoryId, points);
  });

  // Orders, payouts and notifications so the account surfaces are alive.
  const buyer = users.require('usr_you');
  const completedLots = ['auc_ps5', 'auc_walkman'];
  completedLots.forEach((auctionId, index) => {
    const auction = auctions.get(auctionId);
    const item = auction ? items.get(auction.itemId) : undefined;
    if (!auction || !item) return;
    const seller = users.require(item.sellerId);
    const hammer = auction.buyItNowPrice ?? auction.startingPrice;
    const breakdown = money.costBreakdown({
      hammerPrice: hammer,
      currency: auction.currency,
      buyerCountry: buyer.countryCode,
      sellerCountry: seller.countryCode,
    });
    const statuses: Order['orderStatus'][] = ['shipped', 'complete'];
    const order: Order = {
      id: `ord_seed_${index + 1}`,
      auctionId,
      buyerId: buyer.id,
      sellerId: seller.id,
      hammerPrice: hammer,
      buyersPremium: breakdown.buyersPremium,
      shipping: breakdown.shipping,
      tax: breakdown.tax,
      totalAmount: breakdown.total,
      currency: auction.currency,
      paymentStatus: 'paid',
      shippingAddress: { line1: '88 Bedford Ave', city: 'Brooklyn', region: 'NY', postalCode: '11211', countryCode: 'US' },
      trackingNumber: index === 0 ? 'DHL7741 2290 8834' : undefined,
      courierName: index === 0 ? 'DHL Express' : undefined,
      orderStatus: statuses[index] ?? 'processing',
      createdAt: store.iso(-(index + 3) * 86_400_000),
      completedAt: index === 1 ? store.iso(-86_400_000) : undefined,
    };
    orders.create(order);

    // Give the seeded order a real escrow ledger. Shipped/complete orders have
    // already been paid into escrow, so the ledger records that honestly rather
    // than leaving historical orders without a payment trail.
    escrowService.open({
      order,
      buyerCountry: buyer.countryCode,
      sellerCountry: seller.countryCode,
    });
    if (order.orderStatus === 'shipped' || order.orderStatus === 'complete') {
      escrowService.recordHistoricalPayment({
        orderId: order.id,
        amount: order.totalAmount,
        actor: 'system',
        note: 'Backfilled from seeded order history',
      });
    }

    const payoutRecord: Payout = {
      id: `pay_seed_${index + 1}`,
      sellerId: seller.id,
      orderIds: [order.id],
      grossAmount: hammer,
      platformFee: money.round2(hammer * MONETIZATION.creatorPlatformShare),
      netAmount: money.round2(hammer * MONETIZATION.creatorShare),
      currency: auction.currency,
      payoutMethod: index === 0 ? 'bank' : 'mobile_money',
      status: index === 0 ? 'processing' : 'paid',
      initiatedAt: store.iso(-(index + 2) * 86_400_000),
      completedAt: index === 1 ? store.iso(-86_400_000) : undefined,
      referenceId: `MM-PAY-${8800 + index}`,
    };
    payouts.create(payoutRecord);
  });

  const extraNotifications: Omit<AppNotification, 'id' | 'createdAt' | 'read'>[] = [
    {
      userId: 'usr_you',
      category: 'bids',
      title: 'You were outbid',
      body: 'Rolex Datejust 36 is now £8,450. Bid again to stay in.',
      href: '/auctions/auc_rolex',
    },
    {
      userId: 'usr_you',
      category: 'orders',
      title: 'Your order shipped',
      body: 'PS5 Pro Bundle is on its way — DHL 7741 2290 8834.',
      href: '/orders/ord_seed_1',
    },
    {
      userId: 'usr_you',
      category: 'system',
      title: 'MoneyMart Pro active',
      body: 'Your buyer’s premium is reduced to 10% on standard lots.',
      href: '/account',
    },
    {
      userId: 'usr_you',
      category: 'bids',
      title: 'Outbid on Charizard Base Set',
      body: 'A new high bid of $2,280 was placed 4 minutes ago.',
      href: '/auctions/auc_charizard',
    },
  ];
  extraNotifications.forEach((entry, index) => {
    notifications.create({
      ...entry,
      id: store.nextId('ntf'),
      read: index > 1,
      createdAt: store.iso(-(index + 1) * 47 * 60_000),
    });
  });

  // Keep the very first live lot's clock meaningful for the demo.
  const firstLive = auctions.get('auc_adire');
  if (firstLive) {
    firstLive.endTime = new Date(now + 4 * 60_000).toISOString();
    auctions.save(firstLive);
  }
}

export { posterFor as lotPoster, avatarFor as userAvatar, ITEM_TIMER, MONETIZATION };
export default seed;
