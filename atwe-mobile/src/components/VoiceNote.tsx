import { useEffect, useMemo } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { mediaUri } from '@/lib/media';
import { voiceTime } from '@/lib/voice';
import { haptics } from '@/lib/haptics';

/**
 * A voice note inside a message bubble: play/pause, a bar that fills as it goes,
 * and the time. Tapping the bar seeks.
 *
 * `mine` flips it to read on the accent bubble — everything here is white on
 * blue for the sender and the theme's own colours for the recipient, so the same
 * component sits correctly on both sides of the thread.
 */
export function VoiceNote({
  uri, durationSec, mine,
}: { uri: string; durationSec?: number | null; mine?: boolean }) {
  const { c } = useTheme();
  const src = useMemo(() => mediaUri(uri) ?? uri, [uri]);
  const player = useAudioPlayer(src);
  const status = useAudioPlayerStatus(player);

  // The stored duration is what the sender's recorder measured; the player's own
  // is only known once enough has loaded. Prefer whichever we actually have, so
  // the bubble shows a real length before a single byte is fetched.
  const total = status.duration > 0 ? status.duration : (durationSec || 0);
  const at = status.currentTime || 0;
  const pct = total > 0 ? Math.min(1, at / total) : 0;

  // A finished note must rewind, or a second tap on play does nothing at all —
  // the player is sitting at the end and "playing" is instantly over.
  useEffect(() => {
    if (status.didJustFinish) player.seekTo(0).catch(() => {});
  }, [status.didJustFinish, player]);

  const ink = mine ? '#fff' : c.text;
  const dim = mine ? 'rgba(255,255,255,0.45)' : c.t3;
  const on = mine ? '#fff' : c.accent;

  const toggle = () => {
    haptics.tap();
    if (status.playing) player.pause();
    else player.play();
  };

  return (
    <View style={styles.row}>
      <Pressable
        onPress={toggle}
        hitSlop={8}
        style={[styles.btn, { backgroundColor: mine ? 'rgba(255,255,255,0.22)' : c.bg }]}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause voice note' : 'Play voice note'}
      >
        <Ionicons name={status.playing ? 'pause' : 'play'} size={16} color={ink}
          style={status.playing ? undefined : { marginLeft: 2 }} />
      </Pressable>

      <View style={styles.mid}>
        <View style={[styles.track, { backgroundColor: dim }]}>
          <View style={[styles.fill, { backgroundColor: on, width: `${pct * 100}%` }]} />
        </View>
        <Text variant="micro" style={{ color: dim, marginTop: 5 }}>
          {/* Counting UP while it plays and showing the LENGTH at rest is what
              every messaging app does — a countdown reads as time running out. */}
          {status.playing || at > 0 ? voiceTime(at) : voiceTime(total)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minWidth: 168, paddingVertical: 2 },
  btn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, marginLeft: 10 },
  track: { height: 3, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 3, borderRadius: 2 },
});
