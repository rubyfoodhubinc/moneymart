/**
 * MoneyMart Studio — creator storefront schema (the "Wix-style" builder).
 *
 * A storefront is a document: a theme plus an ordered list of blocks. Every
 * surface that renders a shop (web, mobile, TV, embed) reads this one schema,
 * so a creator designs once and it publishes everywhere.
 */

export const BLOCK_KINDS = [
  'hero',
  'liveNow',
  'featuredLots',
  'categoryGrid',
  'about',
  'stats',
  'testimonials',
  'newsletter',
  'cta',
  'recentSales',
] as const;

export type BlockKind = (typeof BLOCK_KINDS)[number];

export interface BlockCopy {
  title?: string;
  subtitle?: string;
  body?: string;
  ctaLabel?: string;
  ctaHref?: string;
  items?: string[];
}

export interface StoreBlock {
  id: string;
  kind: BlockKind;
  /** Creator-authored copy for this instance of the block. */
  copy: BlockCopy;
  /** Per-block presentation choices. */
  options?: {
    columns?: number;
    limit?: number;
    tone?: 'gold' | 'green' | 'neutral';
    categoryId?: string;
    fullBleed?: boolean;
  };
  visible: boolean;
}

export interface StoreTheme {
  /** Any of the mandated brand colours, or a creator accent. */
  accent: string;
  surface: 'navy' | 'charcoal' | 'midnight';
  radius: 'sharp' | 'soft' | 'pill';
  density: 'compact' | 'comfortable' | 'spacious';
  showTagline: boolean;
}

export interface Storefront {
  id: string;
  ownerId: string;
  handle: string;
  name: string;
  tagline: string;
  logoText: string;
  theme: StoreTheme;
  blocks: StoreBlock[];
  published: boolean;
  updatedAt: string;
}

/** Human labels + icons for the builder's block palette. */
export const BLOCK_LIBRARY: {
  kind: BlockKind;
  label: string;
  hint: string;
  emoji: string;
  defaults: BlockCopy;
}[] = [
  {
    kind: 'hero',
    label: 'Hero banner',
    hint: 'Full-width headline with a call to action.',
    emoji: '🎬',
    defaults: {
      title: 'Live drops every Thursday',
      subtitle: 'Rare finds, authenticated in-stream and shipped worldwide.',
      ctaLabel: 'Watch the stream',
      ctaHref: '/live',
    },
  },
  {
    kind: 'liveNow',
    label: 'Live now',
    hint: 'Embeds your active stream with a join button.',
    emoji: '🔴',
    defaults: { title: 'Live right now', ctaLabel: 'Join the room' },
  },
  {
    kind: 'featuredLots',
    label: 'Featured lots',
    hint: 'A grid of your lots currently open for bidding.',
    emoji: '🏷️',
    defaults: { title: 'On the block', subtitle: 'Bidding closes soon' },
  },
  {
    kind: 'categoryGrid',
    label: 'Category grid',
    hint: 'Browse your shop by category.',
    emoji: '🗂️',
    defaults: {
      title: 'Shop by category',
      items: ['watches', 'sneakers', 'art', 'collectibles'],
    },
  },
  {
    kind: 'about',
    label: 'About the creator',
    hint: 'Your story, verification and shipping promise.',
    emoji: '👤',
    defaults: {
      title: 'About me',
      body: 'I have been sourcing and authenticating pieces for collectors since 2016. Every lot ships insured with provenance paperwork.',
    },
  },
  {
    kind: 'stats',
    label: 'Stats row',
    hint: 'Sales, followers and rating at a glance.',
    emoji: '📊',
    defaults: { title: 'By the numbers' },
  },
  {
    kind: 'recentSales',
    label: 'Recent sales',
    hint: 'Proof of past results, auto-filled from your history.',
    emoji: '🧾',
    defaults: { title: 'Recently sold' },
  },
  {
    kind: 'testimonials',
    label: 'Testimonials',
    hint: 'Quotes from buyers, one per line.',
    emoji: '💬',
    defaults: {
      title: 'What buyers say',
      items: ['Packed like a museum. Arrived perfect.', 'Fast shipping, exactly as described.'],
    },
  },
  {
    kind: 'newsletter',
    label: 'Newsletter',
    hint: 'Collect emails before your next drop.',
    emoji: '✉️',
    defaults: { title: 'Get drop alerts', subtitle: 'One email before each stream. No spam.' },
  },
  {
    kind: 'cta',
    label: 'Call to action',
    hint: 'A bold band pushing buyers to one action.',
    emoji: '🚀',
    defaults: { title: 'Want first look?', ctaLabel: 'Follow my shop', ctaHref: '/creators' },
  },
];

export const THEME_PRESETS: { id: string; name: string; theme: StoreTheme }[] = [
  {
    id: 'signature',
    name: 'MoneyMart Signature',
    theme: { accent: '#F5A623', surface: 'navy', radius: 'soft', density: 'comfortable', showTagline: true },
  },
  {
    id: 'vault',
    name: 'Watch Vault',
    theme: { accent: '#F5A623', surface: 'midnight', radius: 'sharp', density: 'compact', showTagline: false },
  },
  {
    id: 'atelier',
    name: 'Art Atelier',
    theme: { accent: '#00D4A1', surface: 'charcoal', radius: 'soft', density: 'spacious', showTagline: true },
  },
  {
    id: 'hype',
    name: 'Hype Drop',
    theme: { accent: '#00D4A1', surface: 'navy', radius: 'pill', density: 'compact', showTagline: true },
  },
];

export function newBlock(kind: BlockKind): StoreBlock {
  const entry = BLOCK_LIBRARY.find((block) => block.kind === kind);
  return {
    id: `blk_${Math.random().toString(36).slice(2, 9)}`,
    kind,
    copy: { ...(entry?.defaults ?? {}) },
    options: {
      columns: kind === 'featuredLots' ? 4 : kind === 'categoryGrid' ? 4 : undefined,
      limit: kind === 'featuredLots' ? 8 : undefined,
      tone: 'gold',
    },
    visible: true,
  };
}

export function newStorefront(ownerId: string, handle: string, name: string): Storefront {
  return {
    id: `store_${handle}`,
    ownerId,
    handle,
    name: `${name.split(' ')[0]}’s Shop`,
    tagline: 'Bid. Stream. Win.',
    logoText: name
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join(''),
    theme: THEME_PRESETS[0]!.theme,
    blocks: [newBlock('hero'), newBlock('liveNow'), newBlock('featuredLots'), newBlock('about')],
    published: true,
    updatedAt: new Date().toISOString(),
  };
}

export const SURFACE_BG: Record<StoreTheme['surface'], string> = {
  navy: 'linear-gradient(180deg, #0D1B2A 0%, #070F18 100%)',
  charcoal: 'linear-gradient(180deg, #1C1C1E 0%, #101012 100%)',
  midnight: 'linear-gradient(180deg, #070F18 0%, #04090E 100%)',
};

export const RADIUS_SCALE: Record<StoreTheme['radius'], { sm: string; md: string; lg: string }> = {
  sharp: { sm: '4px', md: '6px', lg: '8px' },
  soft: { sm: '8px', md: '12px', lg: '18px' },
  pill: { sm: '14px', md: '22px', lg: '32px' },
};

export const DENSITY_SCALE: Record<StoreTheme['density'], string> = {
  compact: 'py-6',
  comfortable: 'py-10',
  spacious: 'py-16',
};
