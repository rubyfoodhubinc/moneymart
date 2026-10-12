/**
 * MoneyMart TV — Live Stream view (§7.3).
 *
 * "Full-screen 16:9 video; D-pad focus cycles (using Left/Right) through overlay
 *  control buttons: Watch (default focus, hides controls), Chat, Bid, Share.
 *  Controls auto-hide after 5 seconds of inactivity."
 *
 * The Bid panel slides in from the right over ~30% of the screen and carries the
 * QR bridge, because entering an amount with a D-pad is hostile — the viewer
 * scans and bids on the phone instead.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuctionWithRelations, ChatMessage, StreamWithRelations } from '@moneymart/types';
import { api, type TvHandoff } from '@/lib/api';
import { useFocus, useFocusable } from '@/lib/focus';
import { TvButton, TvCountdown, TvPill, TvQrCode } from '@/components/tv';
import { formatMoney, formatViewers, minimumNextBid } from '@/lib/format';

const CONTROLS_HIDE_MS = 5000; // §7.2 TV controls auto-hide

type Panel = 'none' | 'chat' | 'bid' | 'share';

export function TvStreamScreen({ streamId, onBack }: { streamId: string; onBack: () => void }) {
  const [stream, setStream] = useState<StreamWithRelations | null>(null);
  const [queue, setQueue] = useState<AuctionWithRelations[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [panel, setPanel] = useState<Panel>('none');
  const [controlsVisible, setControlsVisible] = useState(true);
  const [share, setShare] = useState<{ handoff: TvHandoff; auction: AuctionWithRelations } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hideTimer = useRef<number | null>(null);
  const { setActiveGroup, focusFirst } = useFocus();

  const activeAuction = stream?.activeAuction ?? queue[0] ?? null;
  const minimum = activeAuction
    ? minimumNextBid(activeAuction.startingPrice, activeAuction.currentBid, activeAuction.bidCount)
    : 0;

  /* Load the room and keep the current lot fresh. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detail = await api.stream(streamId);
        if (cancelled) return;
        setStream(detail.stream);
        setQueue(detail.queue);
        setChat(detail.chat);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not open the room');
      }
    })();

    const poll = setInterval(async () => {
      try {
        const detail = await api.stream(streamId);
        if (cancelled) return;
        setStream(detail.stream);
        setQueue(detail.queue);
        setChat(detail.chat);
      } catch {
        /* keep the last good state */
      }
    }, 6000);

    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [streamId]);

  /* §7.2: controls auto-hide after five seconds of D-pad inactivity. */
  const poke = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setControlsVisible(false);
      setPanel('none');
    }, CONTROLS_HIDE_MS);
  }, []);

  useEffect(() => {
    poke();
    const onKey = () => poke();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [poke]);

  useEffect(() => setActiveGroup('controls'), [setActiveGroup]);
  useEffect(() => {
    if (stream) focusFirst('controls');
  }, [stream, focusFirst]);

  /** Request a scannable handoff for the lot currently on the block. */
  const openShare = useCallback(async () => {
    if (!activeAuction) return;
    try {
      const handoff = await api.handoff(activeAuction.id);
      setShare({ handoff, auction: activeAuction });
      setPanel('share');
      setActiveGroup('share');
      window.setTimeout(() => focusFirst('share'), 50);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the handoff code');
    }
  }, [activeAuction, setActiveGroup, focusFirst]);

  if (error && !stream) {
    return (
      <div className="tv-screen" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <h1 className="tv-heading">Room unavailable</h1>
        <p className="tv-body">{error}</p>
        <TvButton id="back" label="Back to home" onSelect={onBack} />
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#04080d' }}>
      {/* 16:9 full-screen video surface */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <img
          src={activeAuction?.item.images[0] ?? stream?.posterUrl ?? ''}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(7,15,24,0.75) 0%, rgba(7,15,24,0.05) 30%, rgba(7,15,24,0.9) 100%)',
          }}
        />
      </div>

      {/* Overlay chrome — hides after inactivity */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: 'var(--tv-overscan)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          opacity: controlsVisible || panel !== 'none' ? 1 : 0,
          transition: 'opacity 260ms ease-out',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <TvPill tone="live">
              <span className="tv-live-dot" style={{ width: '0.75rem', height: '0.75rem' }} />
              LIVE · {formatViewers(stream?.viewerCount ?? 0)}
            </TvPill>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="tv-body tv-body-lg" style={{ fontWeight: 700, color: '#fff' }}>
                {stream?.creator.displayName ?? 'Connecting…'}
              </span>
              <span className="tv-caption" style={{ fontSize: '1.4rem' }}>
                {stream?.title ?? ''}
              </span>
            </span>
          </div>

          {/* D-pad control strip: Watch (default) · Chat · Bid · Share */}
          <div style={{ display: 'flex', gap: '1rem' }} id="tv-controls">
            <TvButton
              id="ctrl-watch"
              label="Watch"
              variant="navy"
              group="controls"
              autofocus
              onSelect={() => {
                setPanel('none');
                setControlsVisible(false);
              }}
            />
            <TvButton
              id="ctrl-chat"
              label="Chat"
              variant="navy"
              group="controls"
              onSelect={() => {
                setPanel(panel === 'chat' ? 'none' : 'chat');
                setActiveGroup(panel === 'chat' ? 'controls' : 'chat');
                if (panel !== 'chat') setTimeout(() => focusFirst('chat'), 50);
              }}
            />
            <TvButton
              id="ctrl-bid"
              label="Bid"
              variant="gold"
              group="controls"
              onSelect={() => {
                setPanel(panel === 'bid' ? 'none' : 'bid');
                setActiveGroup(panel === 'bid' ? 'controls' : 'bid');
                if (panel !== 'bid') setTimeout(() => focusFirst('bid'), 50);
              }}
            />
            <TvButton
              id="ctrl-share"
              label="Share"
              variant="navy"
              group="controls"
              onSelect={() => void openShare()}
            />
          </div>
        </header>

        {/* Current lot strip */}
        {activeAuction ? (
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '2rem' }}>
            <div
              className="tv-card"
              style={{ padding: '1.6rem 2rem', maxWidth: '48%', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}
            >
              <span className="tv-caption" style={{ fontSize: '1.2rem', color: 'var(--mm-gold)', fontWeight: 700 }}>
                LOT ON THE BLOCK
              </span>
              <span className="tv-body tv-body-lg" style={{ color: '#fff', fontWeight: 600 }}>
                {activeAuction.item.title}
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '1.5rem' }}>
                <span className="tv-data" style={{ fontSize: '2.8rem', fontWeight: 700, color: 'var(--mm-gold)' }}>
                  {formatMoney(activeAuction.currentBid || activeAuction.startingPrice, activeAuction.currency)}
                </span>
                <TvCountdown endsAt={activeAuction.endTime} size="1.9rem" />
              </div>
            </div>

            <span className="tv-caption">{queue.length} lots queued in this room</span>
          </div>
        ) : null}
      </div>

      {/* Chat panel */}
      {panel === 'chat' ? (
        <ChatSidebar chat={chat} onClose={() => { setPanel('none'); setActiveGroup('controls'); }} />
      ) : null}

      {/* Bid panel — slides in from the right over ~30% of the screen */}
      {panel === 'bid' && activeAuction ? (
        <BidPanel
          auction={activeAuction}
          minimum={minimum}
          onShare={() => void openShare()}
          onClose={() => {
            setPanel('none');
            setActiveGroup('controls');
          }}
        />
      ) : null}

      {/* QR share overlay */}
      {panel === 'share' && share ? (
        <ShareOverlay
          handoff={share.handoff}
          auction={share.auction}
          onClose={() => {
            setPanel('none');
            setActiveGroup('controls');
            window.setTimeout(() => focusFirst('controls'), 50);
          }}
        />
      ) : null}

      {error ? (
        <div
          style={{
            position: 'absolute',
            bottom: 'var(--tv-overscan)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(229,62,62,0.9)',
            padding: '1rem 2rem',
            borderRadius: '12px',
            fontSize: '1.5rem',
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}

/* ── Chat sidebar ──────────────────────────────────────────────────────── */

function ChatSidebar({ chat, onClose }: { chat: ChatMessage[]; onClose: () => void }) {
  const { ref, focused, focusProps } = useFocusable({ id: 'chat-close', group: 'chat', onSelect: onClose });

  return (
    <aside
      style={{
        position: 'absolute',
        top: 'var(--tv-overscan)',
        bottom: 'var(--tv-overscan)',
        right: 'var(--tv-overscan)',
        width: '32rem',
        background: 'rgba(9,18,29,0.94)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '18px',
        padding: '1.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 className="tv-heading" style={{ fontSize: '2.2rem' }}>
          Chat
        </h2>
        <button
          ref={ref as React.RefObject<HTMLButtonElement>}
          {...focusProps}
          onClick={onClose}
          className="tv-focusable"
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: 'none',
            color: '#fff',
            fontSize: '1.6rem',
            padding: '0.8rem 1.6rem',
            borderRadius: '12px',
            cursor: 'pointer',
            ...(focused ? { outline: '4px solid var(--mm-gold)', outlineOffset: '2px' } : {}),
          }}
        >
          Close
        </button>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        {chat.slice(-24).map((message) => (
          <p key={message.id} className="tv-body" style={{ fontSize: '1.5rem', lineHeight: 1.4 }}>
            <span style={{ color: message.isCreator ? 'var(--mm-gold)' : 'var(--mm-green)', fontWeight: 600 }}>
              {message.isCreator ? '★ ' : ''}
              {message.displayName}
            </span>{' '}
            <span style={{ color: 'rgba(255,255,255,0.8)' }}>{message.body}</span>
          </p>
        ))}
        {!chat.length ? <p className="tv-caption">Chat is quiet. Say hello from your phone.</p> : null}
      </div>

      <p className="tv-caption" style={{ fontSize: '1.2rem' }}>
        Chat is read-only on TV — open the lot on your phone to join in.
      </p>
    </aside>
  );
}

/* ── Bid panel + QR bridge (§7.3) ──────────────────────────────────────── */

function BidPanel({
  auction,
  minimum,
  onShare,
  onClose,
}: {
  auction: AuctionWithRelations;
  minimum: number;
  onShare: () => void;
  onClose: () => void;
}) {
  return (
    <aside
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        right: 0,
        width: '32%',
        background: 'linear-gradient(180deg, rgba(9,18,29,0.97), rgba(6,13,20,0.99))',
        borderLeft: '1px solid rgba(245,166,35,0.28)',
        padding: 'var(--tv-overscan) 2.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '2rem',
      }}
    >
      <h2 className="tv-heading" style={{ fontSize: '2.4rem' }}>
        Place a bid
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <span className="tv-caption" style={{ fontSize: '1.25rem' }}>
          CURRENT BID
        </span>
        <span className="tv-data" style={{ fontSize: '3.2rem', fontWeight: 700, color: 'var(--mm-gold)' }}>
          {formatMoney(auction.currentBid || auction.startingPrice, auction.currency)}
        </span>
        <span className="tv-caption" style={{ fontSize: '1.25rem' }}>
          NEXT MINIMUM · {formatMoney(minimum, auction.currency)}
        </span>
      </div>

      {/* Increment options — D-pad Up/Down selects, Select confirms (per §7.3) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <span className="tv-caption" style={{ fontSize: '1.25rem' }}>
          CHOOSE YOUR BID
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }} id="bid-options">
          <TvButton id="bid-min" label={`Bid ${formatMoney(minimum, auction.currency)}`} variant="gold" group="bid" onSelect={onShare} />
          <TvButton
            id="bid-mid"
            label={`Bid ${formatMoney(minimum * 2, auction.currency)}`}
            variant="navy"
            group="bid"
            onSelect={onShare}
          />
          <TvButton
            id="bid-high"
            label={`Bid ${formatMoney(minimum * 5, auction.currency)}`}
            variant="navy"
            group="bid"
            onSelect={onShare}
          />
        </div>
      </div>

      <p className="tv-body" style={{ fontSize: '1.4rem', color: 'rgba(255,255,255,0.62)' }}>
        Bidding happens on your phone so the amount is entered on a proper keypad. Scan the code to open this lot
        pre-authenticated.
      </p>

      <div style={{ marginTop: 'auto', display: 'flex', gap: '1rem' }}>
        <TvButton id="bid-share" label="Show QR code" variant="green" group="bid" onSelect={onShare} />
        <TvButton id="bid-close" label="Back" variant="ghost" group="bid" onSelect={onClose} />
      </div>
    </aside>
  );
}

function ShareOverlay({
  handoff,
  auction,
  onClose,
}: {
  handoff: TvHandoff;
  auction: AuctionWithRelations;
  onClose: () => void;
}) {
  return (
    <div className="tv-overlay" style={{ alignItems: 'center' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <TvPill tone="gold">SCAN TO BID ON YOUR PHONE</TvPill>
        <h1 className="tv-heading" style={{ fontSize: '3rem' }}>
          {auction.item.title}
        </h1>
        <p className="tv-body tv-body-lg">
          Current bid{' '}
          <span className="tv-data" style={{ color: 'var(--mm-gold)', fontWeight: 700 }}>
            {formatMoney(auction.currentBid || auction.startingPrice, auction.currency)}
          </span>
        </p>
        <p className="tv-body" style={{ color: 'rgba(255,255,255,0.6)', fontSize: '1.5rem' }}>
          Open the MoneyMart app and scan — the lot opens pre-authenticated, or use the web fallback link on your
          phone. This code is valid for {Math.round(handoff.expiresInSeconds / 60)} minutes.
        </p>
        <p className="tv-caption" style={{ fontFamily: 'var(--mm-font-data)', fontSize: '1.6rem', letterSpacing: '0.1em' }}>
          CODE {handoff.token}
        </p>
        <div id="share-actions">
          <TvButton id="share-close" label="Done" variant="gold" group="share" autofocus onSelect={onClose} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
        <div className="tv-confirm__panel" style={{ padding: '2rem', maxWidth: 'none' }}>
          <TvQrCode matrix={handoff.qr} size={320} />
        </div>
        <p className="tv-caption" style={{ fontFamily: 'var(--mm-font-data)', fontSize: '1.3rem' }}>
          {handoff.deepLink.slice(0, 44)}…
        </p>
      </div>
    </div>
  );
}
