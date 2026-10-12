/**
 * MoneyMart — HLS playback surface (§5.3).
 *
 * Browser support splits two ways, so the component handles both rather than
 * assuming one: Safari and iOS play HLS natively through the video element,
 * while Chromium and Firefox need hls.js and its Media Source Extensions.
 *
 * Two behaviours matter more than the happy path:
 *
 *  • **Autoplay is not guaranteed.** Browsers block audible autoplay, so the
 *    element starts muted and exposes an unmute control instead of silently
 *    never playing.
 *  • **Livestreams stall.** Recoverable network and media errors are retried
 *    with a bound on attempts, and only terminal errors surface to the viewer.
 *    An HLS edge that returns 404 for a segment must not kill the room.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import type { PlaybackMode } from '@moneymart/types';

export interface HlsPlayerProps {
  /** Manifest URL. Absent means there is nothing to play. */
  src?: string;
  poster?: string;
  mode: PlaybackMode;
  label?: string;
  /** Muted-by-default is required for autoplay to be permitted. */
  autoPlay?: boolean;
  className?: string;
  onReady?: (video: HTMLVideoElement) => void;
}

type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'error' | 'unsupported';

const MAX_RECOVERIES = 4;

export function HlsPlayer({
  src,
  poster,
  mode,
  label,
  autoPlay = true,
  className = '',
  onReady,
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const recoveries = useRef(0);

  const [state, setState] = useState<PlayerState>('idle');
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<{ index: number; height: number }[]>([]);
  const [activeLevel, setActiveLevel] = useState(-1);

  const teardown = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    recoveries.current = 0;
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) {
      setState(src ? 'loading' : 'idle');
      return;
    }

    let cancelled = false;
    setError(null);
    setState('loading');
    setLevels([]);
    setActiveLevel(-1);

    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';

    /* ── Path 1: native HLS (Safari, iOS, some TV browsers) ───────────── */
    if (nativeHls) {
      video.src = src;
      const onLoaded = () => !cancelled && setState('playing');
      const onError = () => !cancelled && setState('error');
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);
      void video.play().catch(() => {
        /* Autoplay refused — the muted flag and controls let the viewer start it. */
        if (!cancelled) setState('paused');
      });
      return () => {
        cancelled = true;
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
        video.removeAttribute('src');
        video.load();
      };
    }

    /* ── Path 2: Media Source Extensions via hls.js ───────────────────── */
    if (!window.MediaSource) {
      setState('unsupported');
      setError('This browser cannot play HLS video.');
      return;
    }

    /**
     * Loaded lazily so the ~400 KB player never enters the initial bundle for
     * anyone who does not open a stream room.
     */
    let disposed = false;
    void import('hls.js').then(({ default: HlsCtor }) => {
      if (cancelled || disposed) return;
      const video2 = videoRef.current;
      if (!video2) return;

      if (!HlsCtor.isSupported()) {
        setState('unsupported');
        setError('This browser cannot play HLS video.');
        return;
      }

      const hls = new HlsCtor({
        // Keep the buffer tight for live; a deep buffer adds latency to bids.
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        maxBufferLength: 20,
        enableWorker: true,
      });
      hlsRef.current = hls;

      hls.on(HlsCtor.Events.MANIFEST_PARSED, (_event, data) => {
        if (cancelled) return;
        setLevels(
          data.levels
            .map((level, index) => ({ index, height: level.height ?? 0 }))
            .filter((level) => level.height > 0),
        );
        setState('playing');
        void video2.play().catch(() => setState('paused'));
      });

      hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_event, data) => setActiveLevel(data.level));

      hls.on(HlsCtor.Events.ERROR, (_event, data) => {
        if (cancelled) return;
        if (!data.fatal) return;

        /**
         * A fatal error means hls.js stopped. Recover what is recoverable and
         * only then surface a failure, so a transient segment 404 does not end
         * the room.
         */
        if (recoveries.current >= MAX_RECOVERIES) {
          setState('error');
          setError(`Playback stopped: ${data.details}`);
          return;
        }
        recoveries.current += 1;

        if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          setState('error');
          setError(`Playback stopped: ${data.details}`);
        }
      });

      hls.loadSource(src);
      hls.attachMedia(video2);
    });

    return () => {
      cancelled = true;
      disposed = true;
      teardown();
    };
  }, [src, teardown]);

  // Keep the element's muted state in step with the control.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    if (videoRef.current && onReady) onReady(videoRef.current);
  }, [onReady]);

  const chooseLevel = (index: number) => {
    if (hlsRef.current) hlsRef.current.currentLevel = index;
  };

  const showVideo = Boolean(src) && mode !== 'offline' && state !== 'unsupported';

  return (
    <div className={`relative h-full w-full overflow-hidden bg-[#04080d] ${className}`}>
      <video
        ref={videoRef}
        poster={poster}
        playsInline
        muted={muted}
        autoPlay={autoPlay}
        controls={false}
        className="h-full w-full object-cover"
        style={{ display: showVideo ? 'block' : 'none' }}
      />

      {/* Offline / unsupported: show the poster with a clear reason, never a
          silent black rectangle. */}
      {!showVideo ? (
        <div className="absolute inset-0">
          {poster ? <img src={poster} alt="" className="h-full w-full object-cover opacity-45" /> : null}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <span className="text-[13px] font-semibold tracking-[0.2em] text-white/70">
              {mode === 'offline' ? 'NOT LIVE YET' : state === 'unsupported' ? 'PLAYBACK UNSUPPORTED' : 'CONNECTING'}
            </span>
            <span className="max-w-[36ch] text-[12.5px] leading-relaxed text-white/45">
              {error ?? label ?? 'Waiting for the broadcast to begin.'}
            </span>
          </div>
        </div>
      ) : null}

      {/* Buffering indicator, only while genuinely loading. */}
      {showVideo && (state === 'loading' || state === 'idle') ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/35">
          <span className="text-[12px] tracking-[0.22em] text-white/70">CONNECTING…</span>
        </div>
      ) : null}

      {/* Player chrome. Kept minimal: the bid panel is the focus of the room. */}
      {showVideo && state !== 'loading' ? (
        <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-2">
          {mode === 'demo' ? (
            <span
              className="rounded-full border px-2.5 py-1 text-[10.5px] font-semibold tracking-[0.14em]"
              style={{ borderColor: 'rgba(245,166,35,0.45)', background: 'rgba(245,166,35,0.14)', color: 'var(--mm-gold)' }}
              title="Playback is a public demo manifest, not a live broadcast"
            >
              DEMO STREAM
            </span>
          ) : null}

          {state === 'paused' ? (
            <button
              type="button"
              onClick={() => void videoRef.current?.play()}
              className="rounded-full border border-white/25 bg-black/55 px-3 py-1 text-[11px] font-semibold text-white"
            >
              Play
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setMuted((value) => !value)}
            className="rounded-full border border-white/25 bg-black/55 px-3 py-1 text-[11px] font-semibold text-white"
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>

          {levels.length > 1 ? (
            <select
              value={activeLevel}
              onChange={(event) => chooseLevel(Number(event.target.value))}
              className="rounded-full border border-white/25 bg-black/55 px-2 py-1 text-[11px] font-semibold text-white"
              title="Quality"
            >
              <option value={-1}>Auto</option>
              {levels.map((level) => (
                <option key={level.index} value={level.index}>
                  {level.height}p
                </option>
              ))}
            </select>
          ) : null}

          {error ? <span className="text-[11px] text-[#FF7A7A]">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export default HlsPlayer;
