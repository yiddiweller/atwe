import { Modal, View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface, SheetGlass } from './Glass';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { REACTIONS } from '@/api/beam';
import { haptics } from '@/lib/haptics';

export type MessageAction = 'reply' | 'copy' | 'delete-me' | 'delete-all';

/**
 * The sheet a long-press on a message opens — the phone's reading of the web's
 * "Glide menu": a frosted card, label on the left and icon on the right, rows
 * grouped by hairline, with the reaction row riding above it.
 *
 * `myReaction` is passed in so tapping the emoji already on the message reads as
 * a toggle: it lights up, and choosing it again clears it (which is exactly what
 * the server does with a repeated emoji).
 */
export function MessageActions({
  visible, onClose, onReact, onAction, myReaction, canDeleteForEveryone, canCopy,
}: {
  visible: boolean;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onAction: (a: MessageAction) => void;
  myReaction?: string;
  /** Only your own message can be taken back from the other person. */
  canDeleteForEveryone?: boolean;
  /** A photo or a voice note has no text to put on the clipboard. */
  canCopy?: boolean;
}) {
  const { c, name } = useTheme();
  const insets = useSafeAreaInsets();

  const pick = (fn: () => void) => () => {
    haptics.tap();
    onClose();
    // Let the sheet finish dismissing before the action moves the screen under
    // it — an Alert raised from inside a closing modal is a known iOS deadlock.
    setTimeout(fn, 180);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><SheetGlass>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close">
        {/* The card stops the press so a tap INSIDE it never dismisses. */}
        <Pressable style={[styles.dock, { paddingBottom: insets.bottom + 12 }]} onPress={() => {}}>
          {/* The tapback bar is SOLID, not glass, and that is deliberate: this
              is a sheet, and a sheet is a panel with the conversation dimmed
              away behind it — there is nothing left to refract. `SheetGlass`
              (see Glass.tsx) is what makes that automatic. The emoji discs
              inside it stay transparent; only the chosen one fills. */}
          <GlassSurface radius={radius.pill} style={styles.reacts}>
            {REACTIONS.map((e) => {
              const on = myReaction === e;
              return (
                <Pressable
                  key={e}
                  onPress={pick(() => onReact(e))}
                  style={[styles.react, on && { backgroundColor: c.accentDim }]}
                  accessibilityRole="button"
                  accessibilityLabel={on ? `Remove ${e} reaction` : `React ${e}`}
                >
                  <Text style={styles.reactGlyph}>{e}</Text>
                </Pressable>
              );
            })}
          </GlassSurface>

          <BlurView
            intensity={40}
            tint={name === 'light' ? 'light' : 'dark'}
            style={[styles.card, { backgroundColor: c.s1 + 'e6' }]}
          >
            <Row label="Reply" icon="arrow-undo-outline" c={c} onPress={pick(() => onAction('reply'))} />
            {canCopy && (
              <Row label="Copy" icon="copy-outline" c={c} onPress={pick(() => onAction('copy'))} />
            )}
            <Row label="Delete for me" icon="trash-outline" c={c} danger
              onPress={pick(() => onAction('delete-me'))} last={!canDeleteForEveryone} />
            {canDeleteForEveryone && (
              <Row label="Delete for everyone" icon="trash" c={c} danger last
                onPress={pick(() => onAction('delete-all'))} />
            )}
          </BlurView>
        </Pressable>
      </Pressable>
    </SheetGlass></Modal>
  );
}

function Row({ label, icon, c, onPress, danger, last }: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  c: { text: string; danger: string; border: string };
  onPress: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  const tint = danger ? c.danger : c.text;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
        pressed && { opacity: 0.6 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text variant="headline" style={{ color: tint, flex: 1 }}>{label}</Text>
      <Ionicons name={icon} size={20} color={tint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  dock: { paddingHorizontal: spacing.gutter, gap: 10 },
  reacts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    /* Glass sizes itself to its children, so the row must still stretch. */
    alignSelf: 'stretch',
    padding: 6,
  },
  react: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  reactGlyph: { fontSize: 26, lineHeight: 32 },
  card: { borderRadius: radius.xl, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, minHeight: 54 },
});
