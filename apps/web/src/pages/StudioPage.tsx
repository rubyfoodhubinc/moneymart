/**
 * MoneyMart Studio — the no-code creator storefront builder.
 *
 * Wix-model editing applied to an auction platform: creators assemble their shop
 * from blocks, theme it with the mandated brand palette, edit copy inline,
 * preview live against real lots, and publish to every surface at once.
 *
 * Layout: block library (left) · live canvas (centre) · inspector (right).
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Storefront } from '@moneymart/types';
import { AuctionCard } from '@/components/auction';
import { PageHeader, Section } from '@/components/site-shell';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Pill,
  Skeleton,
  VerifiedBadge,
} from '@/components/ui';
import {
  CheckIcon,
  CloseIcon,
  GavelIcon,
  GlobeIcon,
  PlusIcon,
  ShareIcon,
  SparkIcon,
  StoreIcon,
  TrendIcon,
  UsersIcon,
} from '@/components/icons';
import { api } from '@/lib/api';
import {
  BLOCK_LIBRARY,
  DENSITY_SCALE,
  RADIUS_SCALE,
  SURFACE_BG,
  THEME_PRESETS,
  newBlock,
  type BlockKind,
  type StoreBlock,
  type StoreTheme,
  type Storefront as StorefrontDoc,
} from '@/lib/storefront';
import { useSession } from '@/store/session';
import { formatMoney } from '@/lib/format';

export default function StudioPage() {
  const user = useSession((state) => state.user);
  const queryClient = useQueryClient();
  const handle = user?.handle;

  const loaded = useQuery({
    queryKey: ['storefront', handle],
    queryFn: () => api.storefront(handle!),
    enabled: Boolean(handle),
  });

  const [doc, setDoc] = useState<StorefrontDoc | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [adding, setAdding] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Hydrate the editable document from the server.
  useEffect(() => {
    const incoming = loaded.data?.storefront;
    if (!incoming) return;
    if (doc && dirty) return; // never clobber unsaved creator work
    setDoc(incoming as unknown as StorefrontDoc);
    setDirty(false);
    if (!selectedId && incoming.blocks.length) setSelectedId(incoming.blocks[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded.data]);

  const save = useMutation({
    mutationFn: (payload: Storefront) => api.saveStorefront(payload),
    onSuccess: () => {
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString());
      void queryClient.invalidateQueries({ queryKey: ['storefront', handle] });
    },
  });

  const reset = useMutation({
    mutationFn: () => api.resetStorefront(handle!),
    onSuccess: (data) => {
      setDoc(data.storefront as unknown as StorefrontDoc);
      setDirty(false);
      setSelectedId(null);
      void queryClient.invalidateQueries({ queryKey: ['storefront', handle] });
    },
  });

  const blocks = doc?.blocks ?? [];
  const selected = blocks.find((block) => block.id === selectedId) ?? null;
  const lots = loaded.data?.lots ?? [];
  const profile = loaded.data?.profile;
  const stream = loaded.data?.stream;

  const patchDoc = (patch: Partial<StorefrontDoc>) => {
    setDoc((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  };

  const patchBlock = (id: string, patch: Partial<StoreBlock>) => {
    setDoc((current) =>
      current
        ? {
            ...current,
            blocks: current.blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)),
          }
        : current,
    );
    setDirty(true);
  };

  const patchCopy = (id: string, copy: Partial<StoreBlock['copy']>) => {
    setDoc((current) =>
      current
        ? {
            ...current,
            blocks: current.blocks.map((block) =>
              block.id === id ? { ...block, copy: { ...block.copy, ...copy } } : block,
            ),
          }
        : current,
    );
    setDirty(true);
  };

  const addBlock = (kind: BlockKind) => {
    const block = newBlock(kind);
    setDoc((current) => (current ? { ...current, blocks: [...current.blocks, block] } : current));
    setSelectedId(block.id);
    setAdding(false);
    setDirty(true);
  };

  const removeBlock = (id: string) => {
    setDoc((current) => (current ? { ...current, blocks: current.blocks.filter((b) => b.id !== id) } : current));
    setSelectedId(null);
    setDirty(true);
  };

  const moveBlock = (id: string, direction: -1 | 1) => {
    setDoc((current) => {
      if (!current) return current;
      const index = current.blocks.findIndex((block) => block.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.blocks.length) return current;
      const next = [...current.blocks];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return { ...current, blocks: next };
    });
    setDirty(true);
  };

  const duplicateBlock = (id: string) => {
    setDoc((current) => {
      if (!current) return current;
      const index = current.blocks.findIndex((block) => block.id === id);
      if (index < 0) return current;
      const clone: StoreBlock = {
        ...current.blocks[index]!,
        id: `blk_${Math.random().toString(36).slice(2, 9)}`,
        copy: { ...current.blocks[index]!.copy },
      };
      const next = [...current.blocks];
      next.splice(index + 1, 0, clone);
      return { ...current, blocks: next };
    });
    setDirty(true);
  };

  const theme = doc?.theme;

  if (!user) {
    return (
      <Section>
        <EmptyState
          title="Sign in to open Studio"
          body="Studio is where creators build their MoneyMart storefront. Switch to a creator identity from the account menu to try it."
          icon={<StoreIcon size={22} />}
        />
      </Section>
    );
  }

  return (
    <Section className="py-6">
      <PageHeader
        eyebrow="Storefront Studio"
        title="Build your shop without writing code"
        subtitle="Drag-and-drop blocks, brand-safe themes, inline copy editing, and one-click publish to web, mobile and TV surfaces."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {savedAt ? (
              <Pill tone="green">
                <CheckIcon size={11} /> Saved {savedAt}
              </Pill>
            ) : dirty ? (
              <Pill tone="gold">Unsaved changes</Pill>
            ) : null}
            <Button
              size="sm"
              variant="navy"
              icon={<ShareIcon size={14} />}
              onClick={() => handle && window.open(`/shop/${handle}`, '_blank')}
            >
              View shop
            </Button>
            <Button
              size="sm"
              variant="gold"
              loading={save.isPending}
              disabled={!doc}
              onClick={() => doc && save.mutate(doc)}
              icon={<CheckIcon size={14} />}
            >
              Publish
            </Button>
          </div>
        }
      />

      {loaded.isLoading || !doc ? (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr_320px]">
          <Skeleton className="h-[520px]" />
          <Skeleton className="h-[520px]" />
          <Skeleton className="h-[520px]" />
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[268px_minmax(0,1fr)_330px]">
          {/* ── Left: identity + block library ────────────────────────── */}
          <div className="flex flex-col gap-4">
            <Card className="p-4">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Shop identity
              </p>
              <label className="block text-[11px] text-white/45">Shop name</label>
              <input
                value={doc.name}
                onChange={(event) => patchDoc({ name: event.target.value })}
                className="mt-1.5 w-full rounded-[10px] border border-white/10 bg-white/[0.04] px-3 py-2 text-[13.5px] outline-none"
              />
              <label className="mt-3 block text-[11px] text-white/45">Tagline</label>
              <input
                value={doc.tagline}
                onChange={(event) => patchDoc({ tagline: event.target.value })}
                className="mt-1.5 w-full rounded-[10px] border border-white/10 bg-white/[0.04] px-3 py-2 text-[13.5px] outline-none"
              />
              <label className="mt-3 block text-[11px] text-white/45">Logo monogram (1–2 chars)</label>
              <input
                value={doc.logoText}
                maxLength={2}
                onChange={(event) => patchDoc({ logoText: event.target.value.toUpperCase() })}
                className="data mt-1.5 w-full rounded-[10px] border border-white/10 bg-white/[0.04] px-3 py-2 text-[15px] font-bold outline-none"
              />
            </Card>

            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                  Blocks ({blocks.length})
                </p>
                <button
                  type="button"
                  onClick={() => setAdding((value) => !value)}
                  className="inline-flex items-center gap-1 text-[11.5px] font-semibold"
                  style={{ color: 'var(--mm-gold)' }}
                >
                  <PlusIcon size={12} /> Add
                </button>
              </div>

              <ul className="space-y-1.5">
                {blocks.map((block, index) => {
                  const meta = BLOCK_LIBRARY.find((entry) => entry.kind === block.kind);
                  const active = block.id === selectedId;
                  return (
                    <li key={block.id}>
                      <div
                        className="group flex items-center gap-2 rounded-[10px] border px-2.5 py-2 transition-all"
                        style={{
                          borderColor: active ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.08)',
                          background: active ? 'rgba(245,166,35,0.1)' : 'rgba(255,255,255,0.02)',
                          opacity: block.visible ? 1 : 0.5,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedId(block.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <span aria-hidden>{meta?.emoji}</span>
                          <span className="min-w-0 flex-1">
                            <span className="clamp-1 block text-[12.5px] font-medium text-white/90">
                              {meta?.label ?? block.kind}
                            </span>
                            <span className="clamp-1 block text-[10.5px] text-white/40">
                              {block.copy.title ?? '—'}
                            </span>
                          </span>
                        </button>
                        <span className="flex shrink-0 flex-col">
                          <button
                            type="button"
                            aria-label="Move up"
                            disabled={index === 0}
                            onClick={() => moveBlock(block.id, -1)}
                            className="px-1 text-[10px] text-white/35 hover:text-white disabled:opacity-20"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            aria-label="Move down"
                            disabled={index === blocks.length - 1}
                            onClick={() => moveBlock(block.id, 1)}
                            className="px-1 text-[10px] text-white/35 hover:text-white disabled:opacity-20"
                          >
                            ▼
                          </button>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {adding ? (
                <div className="mt-3 space-y-1.5 border-t pt-3" style={{ borderColor: 'var(--mm-divider)' }}>
                  {BLOCK_LIBRARY.map((entry) => (
                    <button
                      key={entry.kind}
                      type="button"
                      onClick={() => addBlock(entry.kind)}
                      className="flex w-full items-start gap-2.5 rounded-[10px] border border-white/8 px-3 py-2.5 text-left transition-all hover:border-[var(--mm-gold-line)]"
                      style={{ background: 'rgba(255,255,255,0.02)' }}
                    >
                      <span aria-hidden className="text-[15px]">
                        {entry.emoji}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-semibold text-white/90">{entry.label}</span>
                        <span className="block text-[11px] leading-snug text-white/45">{entry.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </Card>

            <Card className="p-4">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Shop stats
              </p>
              <div className="space-y-2.5">
                <StatLine icon={<GavelIcon size={13} />} label="Live lots" value={String(lots.filter((lot) => lot.isLive).length)} />
                <StatLine icon={<TrendIcon size={13} />} label="Lifetime sales" value={String(loaded.data?.sold ?? profile?.totalSales ?? 0)} />
                <StatLine icon={<UsersIcon size={13} />} label="Followers" value={(profile?.followersCount ?? 0).toLocaleString()} />
                <StatLine icon={<GlobeIcon size={13} />} label="Ships from" value={profile?.countryCode ?? '—'} />
              </div>
              <Button
                size="sm"
                variant="ghost"
                full
                className="mt-3"
                loading={reset.isPending}
                onClick={() => reset.mutate()}
              >
                Reset to default layout
              </Button>
            </Card>
          </div>

          {/* ── Centre: live canvas ──────────────────────────────────── */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex gap-1 rounded-[11px] border border-white/8 p-1" style={{ background: 'rgba(255,255,255,0.03)' }}>
                {(['desktop', 'mobile'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDevice(mode)}
                    className="rounded-[8px] px-3 py-1.5 text-[12px] font-semibold capitalize transition-all"
                    style={{
                      background: device === mode ? 'rgba(245,166,35,0.14)' : 'transparent',
                      color: device === mode ? 'var(--mm-gold)' : 'rgba(255,255,255,0.6)',
                    }}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <p className="text-[11.5px] text-white/40">
                Click any block to edit it · changes preview instantly
              </p>
            </div>

            <div
              className="mx-auto w-full overflow-hidden rounded-[16px] border transition-all duration-300"
              style={{
                maxWidth: device === 'mobile' ? 390 : '100%',
                borderColor: 'rgba(255,255,255,0.1)',
                background: SURFACE_BG[theme?.surface ?? 'navy'],
              }}
            >
              {/* Canvas chrome: the shop's own header */}
              <div
                className="flex items-center justify-between gap-3 border-b px-4 py-3"
                style={{ borderColor: 'rgba(255,255,255,0.08)' }}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="grid h-9 w-9 place-items-center font-display text-[14px] font-bold"
                    style={{
                      background: `${theme?.accent}22`,
                      color: theme?.accent,
                      border: `1.5px solid ${theme?.accent}`,
                      borderRadius: RADIUS_SCALE[theme?.radius ?? 'soft'].sm,
                    }}
                  >
                    {doc.logoText || 'MM'}
                  </span>
                  <span>
                    <span className="block text-[13.5px] font-semibold text-white">{doc.name}</span>
                    {theme?.showTagline ? (
                      <span className="block text-[10.5px] uppercase tracking-[0.18em]" style={{ color: theme.accent }}>
                        {doc.tagline}
                      </span>
                    ) : null}
                  </span>
                </div>
                <span className="hidden items-center gap-2 text-[11.5px] text-white/50 sm:flex">
                  {profile ? <VerifiedBadge compact /> : null}
                  {doc.published ? 'Published' : 'Draft'}
                </span>
              </div>

              {/* Rendered blocks */}
              {blocks.filter((block) => block.visible).length === 0 ? (
                <div className="p-10 text-center">
                  <p className="text-[14px] text-white/70">Your shop is empty</p>
                  <p className="mt-1.5 text-[12.5px] text-white/45">Add a block from the library to start building.</p>
                  <Button className="mt-4" variant="gold" onClick={() => setAdding(true)} icon={<PlusIcon size={14} />}>
                    Add your first block
                  </Button>
                </div>
              ) : (
                blocks
                  .filter((block) => block.visible)
                  .map((block) => (
                    <div
                      key={block.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(block.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') setSelectedId(block.id);
                      }}
                      className="relative cursor-pointer outline-none transition-all"
                      style={{
                        boxShadow:
                          block.id === selectedId ? `inset 0 0 0 2px ${theme?.accent}` : 'inset 0 0 0 1px transparent',
                      }}
                    >
                      {block.id === selectedId ? (
                        <span
                          className="absolute right-2 top-2 z-10 rounded-full px-2 py-[3px] text-[10px] font-bold uppercase tracking-wider"
                          style={{ background: theme?.accent, color: '#0D1B2A' }}
                        >
                          Editing
                        </span>
                      ) : null}
                      <BlockRenderer
                        block={block}
                        accent={theme?.accent ?? '#F5A623'}
                        radius={RADIUS_SCALE[theme?.radius ?? 'soft']}
                        density={DENSITY_SCALE[theme?.density ?? 'comfortable']}
                        lots={lots}
                        profile={profile}
                        streamTitle={stream?.title}
                        streamId={stream?.id}
                      />
                    </div>
                  ))
              )}
            </div>
          </div>

          {/* ── Right: inspector ─────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            <Card className="p-4">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Theme</p>
              <div className="grid grid-cols-2 gap-2">
                {THEME_PRESETS.map((preset) => {
                  const active = theme?.accent === preset.theme.accent && theme?.surface === preset.theme.surface;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => patchDoc({ theme: { ...preset.theme } })}
                      className="rounded-[11px] border p-2.5 text-left transition-all"
                      style={{
                        borderColor: active ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.08)',
                        background: active ? 'rgba(245,166,35,0.1)' : 'rgba(255,255,255,0.02)',
                      }}
                    >
                      <span className="mb-1.5 flex gap-1">
                        <span className="h-3 w-3 rounded-full" style={{ background: preset.theme.accent }} />
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{
                            background:
                              preset.theme.surface === 'navy'
                                ? '#0D1B2A'
                                : preset.theme.surface === 'charcoal'
                                  ? '#1C1C1E'
                                  : '#070F18',
                            border: '1px solid rgba(255,255,255,0.2)',
                          }}
                        />
                      </span>
                      <span className="block text-[11.5px] font-semibold text-white/90">{preset.name}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <p className="mb-1.5 text-[11px] text-white/45">Accent colour</p>
                  <div className="flex gap-2">
                    {['#F5A623', '#00D4A1', '#4A9DEC', '#FF8A65'].map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Accent ${color}`}
                        onClick={() => theme && patchDoc({ theme: { ...theme, accent: color } })}
                        className="h-7 w-7 rounded-full transition-transform hover:scale-110"
                        style={{
                          background: color,
                          border: theme?.accent === color ? '2px solid #fff' : '2px solid transparent',
                        }}
                      />
                    ))}
                  </div>
                </div>
                <SelectRow
                  label="Corner style"
                  value={theme?.radius ?? 'soft'}
                  options={['sharp', 'soft', 'pill']}
                  onChange={(value) => theme && patchDoc({ theme: { ...theme, radius: value as StoreTheme['radius'] } })}
                />
                <SelectRow
                  label="Spacing"
                  value={theme?.density ?? 'comfortable'}
                  options={['compact', 'comfortable', 'spacious']}
                  onChange={(value) =>
                    theme && patchDoc({ theme: { ...theme, density: value as StoreTheme['density'] } })
                  }
                />
                <button
                  type="button"
                  onClick={() => theme && patchDoc({ theme: { ...theme, showTagline: !theme.showTagline } })}
                  className="flex w-full items-center justify-between rounded-[10px] border border-white/8 px-3 py-2.5"
                  style={{ background: 'rgba(255,255,255,0.025)' }}
                >
                  <span className="text-[12.5px] text-white/80">Show tagline</span>
                  <span
                    className="relative h-[20px] w-[36px] rounded-full transition-colors"
                    style={{ background: theme?.showTagline ? 'var(--mm-green)' : 'rgba(255,255,255,0.14)' }}
                  >
                    <span
                      className="absolute top-[3px] h-3.5 w-3.5 rounded-full bg-white transition-all"
                      style={{ left: theme?.showTagline ? 19 : 3 }}
                    />
                  </span>
                </button>
              </div>
            </Card>

            {selected ? (
              <Card className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                    {BLOCK_LIBRARY.find((entry) => entry.kind === selected.kind)?.label ?? selected.kind}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeBlock(selected.id)}
                    className="text-white/35 transition-colors hover:text-[#FF8080]"
                    aria-label="Delete block"
                  >
                    <CloseIcon size={15} />
                  </button>
                </div>

                <div className="space-y-3">
                  {(selected.kind === 'hero' ||
                    selected.kind === 'cta' ||
                    selected.kind === 'featuredLots' ||
                    selected.kind === 'about' ||
                    selected.kind === 'liveNow' ||
                    selected.kind === 'stats' ||
                    selected.kind === 'recentSales' ||
                    selected.kind === 'testimonials' ||
                    selected.kind === 'newsletter' ||
                    selected.kind === 'categoryGrid') && (
                    <Field
                      label="Title"
                      value={selected.copy.title ?? ''}
                      onChange={(value) => patchCopy(selected.id, { title: value })}
                    />
                  )}

                  {['hero', 'featuredLots', 'newsletter'].includes(selected.kind) ? (
                    <Field
                      label="Subtitle"
                      value={selected.copy.subtitle ?? ''}
                      onChange={(value) => patchCopy(selected.id, { subtitle: value })}
                    />
                  ) : null}

                  {['about', 'hero'].includes(selected.kind) ? (
                    <Field
                      label="Body"
                      multiline
                      value={selected.copy.body ?? ''}
                      onChange={(value) => patchCopy(selected.id, { body: value })}
                    />
                  ) : null}

                  {['hero', 'cta', 'liveNow'].includes(selected.kind) ? (
                    <>
                      <Field
                        label="Button label"
                        value={selected.copy.ctaLabel ?? ''}
                        onChange={(value) => patchCopy(selected.id, { ctaLabel: value })}
                      />
                      <Field
                        label="Button link"
                        value={selected.copy.ctaHref ?? ''}
                        onChange={(value) => patchCopy(selected.id, { ctaHref: value })}
                      />
                    </>
                  ) : null}

                  {['testimonials', 'categoryGrid'].includes(selected.kind) ? (
                    <Field
                      label="Items (one per line)"
                      multiline
                      value={(selected.copy.items ?? []).join('\n')}
                      onChange={(value) =>
                        patchCopy(selected.id, { items: value.split('\n').filter((line) => line.trim()) })
                      }
                    />
                  ) : null}

                  {selected.kind === 'featuredLots' ? (
                    <SelectRow
                      label="Columns"
                      value={String(selected.options?.columns ?? 4)}
                      options={['2', '3', '4']}
                      onChange={(value) =>
                        patchBlock(selected.id, { options: { ...selected.options, columns: Number(value) } })
                      }
                    />
                  ) : null}

                  <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: 'var(--mm-divider)' }}>
                    <Button
                      size="sm"
                      variant="navy"
                      onClick={() => patchBlock(selected.id, { visible: !selected.visible })}
                    >
                      {selected.visible ? 'Hide block' : 'Show block'}
                    </Button>
                    <Button size="sm" variant="navy" onClick={() => duplicateBlock(selected.id)}>
                      Duplicate
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-5">
                <EmptyState
                  title="No block selected"
                  body="Pick a block on the canvas or in the library to edit its copy, spacing and visibility."
                  icon={<SparkIcon size={20} />}
                />
              </Card>
            )}

            <Card className="p-4">
              <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                <StoreIcon size={13} /> Publish targets
              </p>
              <p className="text-[12px] leading-relaxed text-white/55">
                One document renders your shop on the web, inside the MoneyMart mobile app, and on the TV app
                (Phase 3). Publish once — every surface updates.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Pill tone="green">Web</Pill>
                <Pill tone="green">Mobile</Pill>
                <Pill>TV · Phase 3</Pill>
                <Pill>IPTV · Phase 3</Pill>
              </div>
            </Card>
          </div>
        </div>
      )}
    </Section>
  );
}

/* ── Canvas block renderer ─────────────────────────────────────────────── */

function BlockRenderer({
  block,
  accent,
  radius,
  density,
  lots,
  profile,
  streamTitle,
  streamId,
}: {
  block: StoreBlock;
  accent: string;
  radius: { sm: string; md: string; lg: string };
  density: string;
  lots: { id: string; isLive: boolean }[];
  profile?: { displayName: string; avatarUrl?: string; rating: number; totalSales: number; followersCount: number; isVerified: boolean; bio?: string };
  streamTitle?: string;
  streamId?: string;
}) {
  const { copy, kind } = block;

  switch (kind) {
    case 'hero':
      return (
        <div className={`px-5 ${density}`}>
          <h2 className="text-[clamp(20px,3vw,32px)] text-white">{copy.title}</h2>
          {copy.subtitle ? <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-white/65">{copy.subtitle}</p> : null}
          {copy.body ? <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-white/55">{copy.body}</p> : null}
          {copy.ctaLabel ? (
            <span
              className="mt-4 inline-block px-5 py-2.5 text-[13px] font-semibold text-[#0D1B2A]"
              style={{ background: accent, borderRadius: radius.md }}
            >
              {copy.ctaLabel}
            </span>
          ) : null}
        </div>
      );

    case 'liveNow':
      return (
        <div className={`px-5 ${density}`}>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>
            {copy.title}
          </p>
          <div
            className="mt-3 flex items-center gap-3 p-3"
            style={{ background: 'rgba(255,255,255,0.04)', borderRadius: radius.md }}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#00D4A1' }} />
            <span className="min-w-0 flex-1">
              <span className="clamp-1 block text-[13px] font-semibold text-white/90">
                {streamTitle ?? 'No stream scheduled'}
              </span>
              <span className="block text-[11.5px] text-white/45">
                {streamTitle ? 'Live now — tap to join' : 'Schedule a stream to fill this block'}
              </span>
            </span>
            {copy.ctaLabel ? (
              <span
                className="px-3.5 py-2 text-[12px] font-semibold text-[#0D1B2A]"
                style={{ background: accent, borderRadius: radius.sm }}
              >
                {copy.ctaLabel}
              </span>
            ) : null}
          </div>
          {streamId ? null : null}
        </div>
      );

    case 'featuredLots': {
      const columns = block.options?.columns ?? 4;
      const shown = lots.slice(0, block.options?.limit ?? 4);
      return (
        <div className={`px-5 ${density}`}>
          <h3 className="text-[17px] text-white">{copy.title}</h3>
          {copy.subtitle ? <p className="mt-1 text-[12.5px] text-white/55">{copy.subtitle}</p> : null}
          <div
            className="mt-4 grid gap-3"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {shown.length ? (
              shown.map((lot) => (
                <div
                  key={(lot as { id: string }).id}
                  className="p-3"
                  style={{ background: 'rgba(255,255,255,0.04)', borderRadius: radius.md }}
                >
                  <p className="clamp-1 text-[12px] font-medium text-white/85">
                    {(lot as { title?: string }).title ?? 'Lot'}
                  </p>
                  <p className="data mt-1 text-[13px] font-bold" style={{ color: accent }}>
                    {formatMoney(((lot as { currentBid?: number }).currentBid ?? 0) || ((lot as { startingPrice?: number }).startingPrice ?? 0), 'USD')}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-[12px] text-white/45">No lots yet — publish a listing to fill this grid.</p>
            )}
          </div>
        </div>
      );
    }

    case 'categoryGrid':
      return (
        <div className={`px-5 ${density}`}>
          <h3 className="text-[17px] text-white">{copy.title}</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {(copy.items ?? []).map((item) => (
              <span
                key={item}
                className="px-3.5 py-2 text-[12.5px] capitalize text-white/80"
                style={{ background: 'rgba(255,255,255,0.05)', borderRadius: radius.sm }}
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      );

    case 'about':
      return (
        <div className={`px-5 ${density}`}>
          <h3 className="text-[17px] text-white">{copy.title}</h3>
          {profile ? (
            <div className="mt-3 flex items-center gap-3">
              <Avatar name={profile.displayName} src={profile.avatarUrl} size={38} isVerified={profile.isVerified} />
              <span>
                <span className="block text-[13px] font-semibold text-white/90">{profile.displayName}</span>
                <span className="block text-[11.5px] text-white/50">
                  {profile.rating.toFixed(1)} ★ · {profile.totalSales} sales
                </span>
              </span>
            </div>
          ) : null}
          {copy.body ? <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-white/65">{copy.body}</p> : null}
        </div>
      );

    case 'stats':
      return (
        <div className={`px-5 ${density}`}>
          <h3 className="text-[17px] text-white">{copy.title}</h3>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {[
              ['Sales', String(profile?.totalSales ?? 0)],
              ['Followers', (profile?.followersCount ?? 0).toLocaleString()],
              ['Rating', `${profile?.rating.toFixed(1) ?? '—'} ★`],
            ].map(([label, value]) => (
              <div key={label} className="p-3" style={{ background: 'rgba(255,255,255,0.04)', borderRadius: radius.sm }}>
                <p className="data text-[18px] font-bold" style={{ color: accent }}>
                  {value}
                </p>
                <p className="text-[10.5px] uppercase tracking-wider text-white/45">{label}</p>
              </div>
            ))}
          </div>
        </div>
      );

    case 'testimonials':
      return (
        <div className={`px-5 ${density}`}>
          <h3 className="text-[17px] text-white">{copy.title}</h3>
          <div className="mt-3 space-y-2">
            {(copy.items ?? []).map((quote) => (
              <p
                key={quote}
                className="p-3 text-[12.5px] italic leading-relaxed text-white/70"
                style={{ background: 'rgba(255,255,255,0.04)', borderRadius: radius.sm }}
              >
                “{quote}”
              </p>
            ))}
          </div>
        </div>
      );

    case 'newsletter':
      return (
        <div className={`px-5 ${density}`}>
          <h3 className="text-[17px] text-white">{copy.title}</h3>
          {copy.subtitle ? <p className="mt-1 text-[12.5px] text-white/55">{copy.subtitle}</p> : null}
          <div className="mt-3 flex gap-2">
            <span
              className="flex-1 px-3 py-2.5 text-[12.5px] text-white/35"
              style={{ background: 'rgba(255,255,255,0.05)', borderRadius: radius.sm }}
            >
              your@email.com
            </span>
            <span
              className="px-4 py-2.5 text-[12.5px] font-semibold text-[#0D1B2A]"
              style={{ background: accent, borderRadius: radius.sm }}
            >
              Notify me
            </span>
          </div>
        </div>
      );

    case 'recentSales':
      return (
        <div className={`px-5 ${density}`}>
          <h3 className="text-[17px] text-white">{copy.title}</h3>
          <p className="mt-2 text-[12.5px] text-white/55">
            Sold lots appear here automatically once a buyer confirms receipt.
          </p>
        </div>
      );

    case 'cta':
      return (
        <div className={`px-5 ${density}`}>
          <div
            className="flex flex-wrap items-center justify-between gap-3 p-4"
            style={{ background: `${accent}18`, borderRadius: radius.md, border: `1px solid ${accent}44` }}
          >
            <p className="text-[15px] font-semibold text-white">{copy.title}</p>
            {copy.ctaLabel ? (
              <span
                className="px-4 py-2 text-[12.5px] font-semibold text-[#0D1B2A]"
                style={{ background: accent, borderRadius: radius.sm }}
              >
                {copy.ctaLabel}
              </span>
            ) : null}
          </div>
        </div>
      );

    default:
      return null;
  }
}

/* ── Inspector controls ───────────────────────────────────────────────── */

function Field({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] text-white/45">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
          className="w-full resize-y rounded-[10px] border border-white/10 bg-white/[0.04] px-3 py-2 text-[12.5px] leading-relaxed outline-none"
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-[10px] border border-white/10 bg-white/[0.04] px-3 py-2 text-[12.5px] outline-none"
        />
      )}
    </label>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] text-white/45">{label}</p>
      <div className="flex gap-1.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className="flex-1 rounded-[9px] border px-2 py-2 text-[11.5px] font-medium capitalize transition-all"
            style={{
              borderColor: value === option ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.1)',
              background: value === option ? 'rgba(245,166,35,0.12)' : 'rgba(255,255,255,0.02)',
              color: value === option ? 'var(--mm-gold)' : 'rgba(255,255,255,0.7)',
            }}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatLine({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[12.5px]">
      <span className="flex items-center gap-2 text-white/50">
        {icon}
        {label}
      </span>
      <span className="data font-semibold text-white/90">{value}</span>
    </div>
  );
}
