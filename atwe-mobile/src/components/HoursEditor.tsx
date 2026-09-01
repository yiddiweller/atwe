import { View, Pressable, TextInput, StyleSheet } from 'react-native';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/tokens';
import { HapticInput } from '@/components/HapticInput';

/** The week, starting Monday — which is the order the server stores and reads. */
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export type DayHours = { closed: true } | { open: string; close: string };
export type BusinessHours = DayHours[];

export const DEFAULT_HOURS: BusinessHours = [
  { open: '09:00', close: '17:00' }, { open: '09:00', close: '17:00' },
  { open: '09:00', close: '17:00' }, { open: '09:00', close: '17:00' },
  { open: '09:00', close: '17:00' }, { closed: true }, { closed: true },
];

export function isClosed(d: DayHours | undefined): boolean {
  return !d || 'closed' in d;
}

/**
 * When a business is open.
 *
 * This is not decoration on a profile: **the bookable times are cut from it.**
 * A business with no hours has nothing for anyone to book, which is exactly the
 * dead end the Book sheet was reporting — it could say "they haven't put up
 * their hours" and there was nowhere on the phone to put them up.
 *
 * Times are typed as 24-hour HH:MM because that is what the server stores and
 * what a picker would have to convert to anyway; the field is small and the
 * placeholder shows the shape.
 */
export function HoursEditor({ value, onChange }: {
  value: BusinessHours;
  onChange: (v: BusinessHours) => void;
}) {
  const { c } = useTheme();

  const set = (i: number, d: DayHours) => {
    const next = [...value];
    next[i] = d;
    onChange(next);
  };

  return (
    <View>
      <Text variant="caption" tone="t3" style={{ marginBottom: 8 }}>
        When you're open. People book from this — the times they can pick are cut
        out of it.
      </Text>
      {DAYS.map((label, i) => {
        const d = value[i];
        const closed = isClosed(d);
        return (
          <View key={label} style={styles.row}>
            <Text variant="callout" style={{ width: 42 }}>{label}</Text>
            <Pressable
              onPress={() => set(i, closed ? { open: '09:00', close: '17:00' } : { closed: true })}
              style={[styles.toggle, { backgroundColor: closed ? c.s1 : c.accent }]}
              accessibilityRole="switch"
              accessibilityState={{ checked: !closed }}
              accessibilityLabel={`${label}, ${closed ? 'closed' : 'open'}`}
            >
              <Text variant="micro" style={{ color: closed ? c.t3 : c.accentTint }}>
                {closed ? 'Closed' : 'Open'}
              </Text>
            </Pressable>
            {!closed && (
              <>
                <HapticInput
                  value={(d as { open: string }).open}
                  onChangeText={(t) => set(i, { open: t, close: (d as { close: string }).close })}
                  placeholder="09:00" placeholderTextColor={c.t3} maxLength={5}
                  style={[styles.time, { backgroundColor: c.s1, color: c.text }]}
                  accessibilityLabel={`${label} opens`}
                />
                <Text variant="caption" tone="t3">to</Text>
                <HapticInput
                  value={(d as { close: string }).close}
                  onChangeText={(t) => set(i, { open: (d as { open: string }).open, close: t })}
                  placeholder="17:00" placeholderTextColor={c.t3} maxLength={5}
                  style={[styles.time, { backgroundColor: c.s1, color: c.text }]}
                  accessibilityLabel={`${label} closes`}
                />
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  toggle: { paddingHorizontal: 10, height: 30, borderRadius: radius.pill, justifyContent: 'center' },
  time: {
    width: 66, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 7,
    fontSize: 15, textAlign: 'center',
  },
});
