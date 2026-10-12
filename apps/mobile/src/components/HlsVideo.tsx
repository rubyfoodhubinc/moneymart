/**
 * MoneyMart mobile — the stream room's video surface.
 *
 * The room had no video component at all: it rendered the lot's poster image inside
 * an `Image`, with the "playback" the API resolves never used. So on mobile the
 * stream room could only ever show a still, while web played real HLS. That made
 * "real HLS video in the stream room" true on one surface and false on the other.
 *
 * This renders the resolved manifest with expo-video, and falls back to the poster
 * whenever there is nothing playable — an offline room, a scheduled room, or a
 * manifest that fails to load. A failed player must never be shown as a black
 * rectangle, and a poster must never be mistaken for live video; the source label is
 * displayed either way so the viewer knows which they are looking at.
 */
import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { StreamPlayback } from '@moneymart/types';
import { Body, Pill } from '@/components/ui';
import { colors } from '@/theme';

interface HlsVideoProps {
  /** The server-resolved source. Absent means nothing is playable. */
  playback?: StreamPlayback;
  posterUrl?: string;
  /** Rendered over the video, e.g. the room's top bar and bid overlays. */
  children?: React.ReactNode;
}

export function HlsVideo({ playback, posterUrl, children }: HlsVideoProps) {
  /**
   * Only a `live` or `demo` source has a URL; `offline` deliberately carries none, so
   * the room shows the poster rather than a player that will fail.
   */
  const url = playback?.url;
  const playable = Boolean(url);
  const [failed, setFailed] = useState(false);

  const player = useVideoPlayer(playable ? { uri: url! } : null, (instance) => {
    // A live room should start immediately; the room is the reason the user is here.
    instance.loop = true;
    instance.muted = false;
    instance.play();
  });

  /**
   * A manifest can be advertised and still not load — a CDN outage, a codec the
   * device refuses. When that happens the poster is shown instead, because a black
   * rectangle tells the viewer nothing.
   */
  useEffect(() => {
    setFailed(false);
    if (!player) return;
    const subscription = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') setFailed(true);
    });
    return () => subscription.remove();
  }, [player, url]);

  const showingVideo = playable && !failed;

  return (
    <View style={styles.root}>
      {showingVideo ? (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
          allowsFullscreen={false}
          allowsPictureInPicture={false}
        />
      ) : (
        <Image
          source={{ uri: posterUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      )}

      {children}

      {/**
       * State the source plainly. A branded demo loop is not a broadcast, and an
       * offline room is not a stream that has silently stopped.
       */}
      {playback ? (
        <View style={styles.badge} pointerEvents="none">
          <Pill tone={playback.mode === 'live' ? 'green' : playback.mode === 'demo' ? 'gold' : 'neutral'}>
            {failed ? 'Video unavailable' : playback.label}
          </Pill>
        </View>
      ) : null}

      {failed ? (
        <View style={styles.notice} pointerEvents="none">
          <Body size={11} color={colors.ink3}>
            Playing the still image while the video source recovers.
          </Body>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  badge: { position: 'absolute', left: 12, bottom: 12 },
  notice: { position: 'absolute', right: 12, bottom: 12 },
});

export default HlsVideo;
