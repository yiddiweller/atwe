import { View, Pressable, StyleSheet, Switch, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, row } from '@/theme/tokens';
import { haptics } from '@/lib/haptics';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * The settings-shaped card and its rows — the web's `.me-group` / `.me-row`,
 * shared by the Account hub, a section page and Settings so the three cannot
 * drift apart.
 *
 * Two rules from the web that are easy to get wrong:
 *
 *  · A card draws NO line at its own top or bottom edge. Those edges are
 *    curves, and a straight 1px line in the page colour drawn along one
 *    flattens both corners. Only the lines BETWEEN rows are real dividers; the
 *    card separates itself from the page by its own fill, which is rule 3.
 *  · A card holding ONE row is a full capsule, the way a lone row looks in
 *    iPhone Settings — and it carries no hairline either, for the same reason.
 */
export function MeGroup({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const n = Array.isArray(children) ? children.filter(Boolean).length : 1;
  return (
    <View style={[
      styles.group,
      { backgroundColor: c.s2, borderRadius: n > 1 ? radius.card : radius.pill },
      style,
    ]}>
      {children}
    </View>
  );
}

export function MeRow({ icon, label, sub, value, onPress, last, danger, staff, noChevron }: {
  icon: IconName;
  label: string;
  /** A second line naming what is inside — what makes the top level scannable. */
  sub?: string;
  /** A trailing value, like a wallet balance. */
  value?: string;
  onPress: () => void;
  last?: boolean;
  danger?: boolean;
  /** A staff-only row reads a step quieter than the app's own options. */
  staff?: boolean;
  /** A row that DOES something rather than going somewhere — Sign out. A
   *  chevron promises a destination, and there isn't one. */
  noChevron?: boolean;
}) {
  const { c } = useTheme();
  const ink = danger ? c.danger : staff ? c.t3 : c.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={sub ? `${label}. ${sub}` : label}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: c.bg, borderBottomWidth: last ? 0 : 1 },
        pressed && { backgroundColor: 'rgba(120,120,128,0.18)' },
      ]}
    >
      {/* `.me-ic` — a plain outline glyph in the text colour, NOT a tinted disc.
          The disc was the older design; the web dropped it. */}
      <View style={styles.ic}><Ionicons name={icon} size={20} color={ink} /></View>
      <View style={styles.main}>
        <Text style={[styles.lbl, { color: ink }]} numberOfLines={1}>{label}</Text>
        {!!sub && <Text style={[styles.sub, { color: c.t3 }]} numberOfLines={1}>{sub}</Text>}
      </View>
      {!!value && <Text style={[styles.val, { color: c.t3 }]} numberOfLines={1}>{value}</Text>}
      {!noChevron && <Ionicons name="chevron-forward" size={16} color={c.t4} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { overflow: 'hidden', marginBottom: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    paddingVertical: 12, paddingHorizontal: 15, minHeight: row.height,
  },
  ic: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, minWidth: 0, gap: 2 },
  /* `.me-lbl` */
  lbl: { fontSize: 15.5, fontWeight: '600', letterSpacing: -0.155 },
  /* `.me-secsub` */
  sub: { fontSize: 12.5, fontWeight: '500', letterSpacing: -0.06, lineHeight: 17 },
  val: { fontSize: 15.5, fontWeight: '500' },
});


/**
 * The same row, but the thing on the right is a switch rather than a chevron.
 * The whole row toggles it — a 51pt switch is a small target next to a 55pt row
 * that is already saying what it does.
 */
export function MeSwitchRow({ icon, label, sub, value, onChange, last, disabled }: {
  icon: IconName;
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  const flip = () => { if (disabled) return; haptics.select(); onChange(!value); };
  return (
    <Pressable
      onPress={flip}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={sub ? `${label}. ${sub}` : label}
      style={[
        styles.row,
        { borderBottomColor: c.bg, borderBottomWidth: last ? 0 : 1 },
        disabled && { opacity: 0.5 },
      ]}
    >
      <View style={styles.ic}><Ionicons name={icon} size={20} color={c.text} /></View>
      <View style={styles.main}>
        <Text style={[styles.lbl, { color: c.text }]}>{label}</Text>
        {!!sub && <Text style={[styles.sub, { color: c.t3 }]}>{sub}</Text>}
      </View>
      {/* pointerEvents none — the ROW owns the gesture, so the switch never
          double-fires the haptic or races the row's own press. */}
      <View pointerEvents="none">
        <Switch
          value={value}
          trackColor={{ true: c.accent, false: c.s3 }}
          /* Spelled out rather than left to the platform: react-native-web
             paints its own green thumb, and iOS's default off-track is a light
             grey that disappears on a dark card. */
          thumbColor="#FFFFFF"
          ios_backgroundColor={c.s3}
        />
      </View>
    </Pressable>
  );
}

/** A row that only reports a value — no chevron, nothing to tap. */
export function MeFactRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: c.bg, borderBottomWidth: last ? 0 : 1 }]}>
      <Text style={[styles.lbl, { color: c.t2, flex: 0 }]}>{label}</Text>
      <Text style={[styles.val, { color: c.text, flex: 1, textAlign: 'right' }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}
