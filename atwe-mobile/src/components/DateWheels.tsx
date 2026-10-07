import { useEffect, useMemo, useRef } from 'react';
import { View, ScrollView, Pressable, StyleSheet, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from './Text';
import { haptics } from '@/lib/haptics';

/* The web's `.su-dob-wheels` numbers, to the pixel: a 220px box, 44px rows,
   88px of padding top and bottom so row 0 lands in the middle, a 4px gap
   between the three columns, and the month column 1.5× the other two. */
const ROW = 44;
const HEIGHT = 220;
const PAD = 88;
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/* `.su-wheel-item` — 20/600 at 32% white, the selected row full white at 800.
   The sign-in gate is black in every theme, so these are literals here for the
   same reason the web's are. */
const DIM = 'rgba(255,255,255,0.32)';

/**
 * Month · Day · Year, as three scroll wheels — the web's `.su-dob-wheels`, and
 * what a birthday is supposed to feel like on a phone.
 *
 * It replaced a plain text field asking for "YYYY-MM-DD", which is a format
 * somebody has to be TOLD, gets wrong, and cannot check at a glance.
 */
export function DateWheels({ value, onChange, defaultAge = 25 }: {
  /** ISO `YYYY-MM-DD`, or empty for "not answered yet". */
  value: string;
  onChange: (iso: string) => void;
  /** Where the wheels open when nothing is chosen yet. The web uses 25. */
  defaultAge?: number;
}) {
  const now = new Date();
  const startYear = now.getFullYear() - defaultAge;
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const y = parsed ? Number(parsed[1]) : startYear;
  const m = parsed ? Number(parsed[2]) - 1 : 0;
  const d = parsed ? Number(parsed[3]) : 1;

  const years = useMemo(() => {
    const out: number[] = [];
    for (let yr = now.getFullYear(); yr >= now.getFullYear() - 110; yr--) out.push(yr);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* How many days that month actually has — day 0 of the NEXT month is the last
     day of this one, which gets February and leap years right without a table. */
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const days = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => i + 1),
    [daysInMonth],
  );

  const emit = (ny: number, nm: number, nd: number) => {
    /* Clamp the day when the month shrinks under it — picking 31 January and
       then scrolling to February must not produce 31 February. */
    const max = new Date(ny, nm + 1, 0).getDate();
    const day = Math.min(nd, max);
    onChange(`${ny}-${String(nm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  };

  /* The wheels ALWAYS show a complete date, so the value must be complete from
     the first frame too. Without this the screen read as answered — a date
     sitting in the marked band — while `dob` was still empty and Continue
     stayed dead, with nothing on screen explaining why. Scrolling all three
     wheels was the only way out. A picker with no value is not a thing. */
  useEffect(() => {
    if (!parsed) emit(y, m, d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.wrap}>
      {/* `.su-wheel-band` — the selected row is marked by two hairlines, not a
          filled block, and marked ONCE behind all three wheels so they read as
          one control rather than three. */}
      <View pointerEvents="none" style={styles.band} />
      <Wheel items={MONTHS} index={m} onIndex={(i) => emit(y, i, d)} flex={1.5} />
      <Wheel
        items={days.map(String)}
        index={Math.min(d, daysInMonth) - 1}
        onIndex={(i) => emit(y, m, i + 1)}
        flex={1}
      />
      <Wheel
        items={years.map(String)}
        index={Math.max(0, years.indexOf(y))}
        onIndex={(i) => emit(years[i], m, d)}
        flex={1}
      />
      {/* The web fades the top and bottom of the box with a mask. React Native
          has no mask, so the same look comes from two gradients painted over
          the ends — which works because this sits on the auth screen's flat
          black rather than on anything patterned. */}
      <LinearGradient pointerEvents="none" colors={['#000', 'rgba(0,0,0,0)']} style={[styles.fade, { top: 0 }]} />
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', '#000']} style={[styles.fade, { bottom: 0 }]} />
    </View>
  );
}

function Wheel({ items, index, onIndex, flex }: {
  items: string[];
  index: number;
  onIndex: (i: number) => void;
  flex: number;
}) {
  const ref = useRef<ScrollView>(null);
  const last = useRef(index);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.y / ROW);
    const clamped = Math.max(0, Math.min(items.length - 1, i));
    if (clamped === last.current) return;
    last.current = clamped;
    /* One tick per row as it settles, the way a real picker feels. `select` is
       the whole point of the control — a value is changing under the finger. */
    haptics.select();
    onIndex(clamped);
  };

  /* Put the wheel where the value says it is. `contentOffset` alone is not
     enough: it is honoured once, at mount, and not on the web — so the year
     wheel opened on the top row while the value said something else, and a day
     clamped by a shorter month stayed visually where it was. Scrolling from an
     effect works everywhere and also tracks a later change. `last.current` is
     what stops it fighting a finger: a scroll the user themselves caused has
     already updated it, so this is a no-op then. */
  useEffect(() => {
    if (index === last.current) return;
    last.current = index;
    ref.current?.scrollTo({ y: index * ROW, animated: false });
  }, [index]);

  useEffect(() => {
    ref.current?.scrollTo({ y: index * ROW, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScrollView
      ref={ref}
      style={{ flex }}
      showsVerticalScrollIndicator={false}
      snapToInterval={ROW}
      decelerationRate="fast"
      contentOffset={{ x: 0, y: index * ROW }}
      onMomentumScrollEnd={settle}
      /* A slow drag that never gains momentum fires no momentum-end event at
         all, so the value would silently not change. */
      onScrollEndDrag={settle}
      contentContainerStyle={{ paddingVertical: PAD }}
    >
      {items.map((it, i) => (
        <Pressable
          key={it + i}
          onPress={() => { haptics.select(); onIndex(i); ref.current?.scrollTo({ y: i * ROW, animated: true }); }}
          style={styles.row}
          accessibilityRole="button"
          accessibilityLabel={it}
        >
          <Text
            style={[styles.item, i === index ? styles.itemSel : null]}
            numberOfLines={1}
          >
            {it}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', gap: 4, height: HEIGHT,
    marginTop: 14, marginBottom: 2, overflow: 'hidden',
  },
  row: { height: ROW, alignItems: 'center', justifyContent: 'center' },
  item: { fontSize: 20, fontWeight: '600', color: DIM },
  itemSel: { color: '#fff', fontWeight: '800' },
  band: {
    position: 'absolute', left: 0, right: 0, zIndex: 1,
    top: (HEIGHT - ROW) / 2, height: ROW,
    borderTopWidth: 1, borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  /* 24% of the box at each end, matching the web mask's stops. */
  fade: { position: 'absolute', left: 0, right: 0, height: HEIGHT * 0.24, zIndex: 2 },
});
