/**
 * MoneyMart TV — HLS playback for the 10-foot surface (§7).
 *
 * Smart TV browsers split the same way desktop ones do: Tizen and webOS are
 * Chromium-based and need hls.js, while Safari-based TV shells play HLS
 * natively. Both paths are handled.
 *
 * Two TV-specific constraints shape this component:
 *
 *  • **Autoplay is essential.** A viewer cannot click a video with a remote, so
 *    playback starts muted (the only state browsers permit) and unmuting is an
 *    explicit D-pad action.
 *  • **No small hit targets.** Every control is a focusable element sized to the
 *    §7.2 minimum, not a native video control bar.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import type { PlaybackMode } from '@moneymart/types';

type PlayerState = 'loading' | 'playing' | 'paused' | 'error' | 'offline';

const MAX_RECOVERIES = 4;

export function TvHlsPlayer({
  src,
  poster,
  mode,
  label,
  onReady,
}: {
  src?: string;
  poster?: string;
  mode: PlaybackMode;
  label?: string;
  onReady?: (video: HTMLVideoElement) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const recoveries = useRef(0);

  const [state, setState] = useState<PlayerState>(src ? 'loading' : 'offline');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);

  const teardown = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    recoveries.current = 0;
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src || mode === 'offline') {
      setState('offline');
      return;
    }

    let cancelled = false;
    setError(null);
    setState('loading');

    const attemptPlay = () => {
      void video.play().catch(() => {
        // Even muted autoplay can be refused; expose a Play action instead.
        if (!cancelled) setState('paused');
      });
    };

    if (video.canPlayType('application/vnd.apple.mpegurl') !== '') {
      video.src = src;
      video.addEventListener('loadedmetadata', attemptPlay, { once: true });
      video.addEventListener('error', () => !cancelled && setState('error'), { once: true });
      return () => {
        cancelled = true;
        video.removeAttribute('src');
        video.load();
      };
    }

    if (!window.MediaSource) {
      setState('error');
      setError('This TV browser cannot play HLS video.');
      return;
    }

    let disposed = false;
    void import('hls.js').then(({ default: HlsCtor }) => {
      if (cancelled || disposed || !videoRef.current) return;
      if (!HlsCtor.isSupported()) {
        setState('error');
        setError('This TV browser cannot play HLS video.');
        return;
      }

      const hls = new HlsCtor({ lowLatencyMode: true, liveSyncDurationCount: 3, maxBufferLength: 20 });
      hlsRef.current = hls;

      hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
        setState('playing');
        attemptPlay();
      });

      hls.on(HlsCtor.Events.ERROR, (_event, data) => {
        if (cancelled || !data.fatal) return;
        if (recoveries.current >= MAX_RECOVERIES) {
          setState('error');
          setError(`Playback stopped: ${data.details}`);
          return;
        }
        recoveries.current += 1;
        if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else {
          setState('error');
          setError(`Playback stopped: ${data.details}`);
        }
      });

      hls.loadSource(src);
      hls.attachMedia(video);
    });

    return () => {
      cancelled = true;
      disposed = true;
      teardown();
    };
  }, [src, mode, teardown]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    if (videoRef.current) onReady?.(videoRef.current);
  }, [onReady]);

  const showVideo = Boolean(src) && mode !== 'offline' && state !== 'error';

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#04080d' }}>
      <video
        ref={videoRef}
        poster={poster}
        playsInline
        muted={muted}
        autoPlay
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: showVideo ? 'block' : 'none' }}
      />

      {!showVideo ? (
        <div style={{ position: 'absolute', inset: 0 }}>
          {poster ? (
            <img src={poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.4 }} />
          ) : null}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.75rem',
            }}
          >
            <span className="tv-body tv-body-lg" style={{ fontWeight: 700, color: 'rgba(255,255,255,0.75)' }}>
              {mode === 'offline' ? 'NOT LIVE YET' : 'PLAYBACK UNAVAILABLE'}
            </span>
            <span className="tv-caption" style={{ maxWidth: '46ch', textAlign: 'center' }}>
              {error ?? label ?? 'Waiting for the broadcast to begin.'}
            </span>
          </div>
        </div>
      ) : null}

      {showVideo && state === 'loading' ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.35)',
          }}
        >
          <span className="tv-caption" style={{ letterSpacing: '0.2em' }}>
            CONNECTING…
          </span>
        </div>
      ) : null}

      {/* D-pad reachable controls — no native chrome, which a remote cannot drive. */}
      {showVideo && state !== 'loading' ? (
        <div style={{ position: 'absolute', bottom: '2rem', left: '2rem', display: 'flex', gap: '1rem' }} id="player-controls">
          {mode === 'demo' ? (
            <span className="tv-pill tv-pill--gold" style={{ fontSize: '1.1rem' }} title="A public demo manifest, not a live broadcast">
              DEMO STREAM
            </span>
          ) : null}
          {state === 'paused' ? (
            <button
              type="button"
              className="tv-focusable tv-pill"
              onClick={() => void videoRef.current?.play()}
              style={{ cursor: 'pointer', fontSize: '1.1rem' }}
            >
              Play
            </button>
          ) : null}
          <button
            type="button"
            className="tv-focusable tv-pill"
            onClick={() => setMuted((value) => !value)}
            style={{ cursor: 'pointer', fontSize: '1.1rem' }}
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default TvHlsPlayer;
