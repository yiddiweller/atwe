import { useEffect } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { AtweMark } from './AtweMark';
import { GlassIcon } from './Glass';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/auth/AuthProvider';
import { spacing, radius } from '@/theme/tokens';
import { haptics } from '@/lib/haptics';

/**
 * The side menu, ported from the web's own sidebar.
 *
 * IT IS THE WEB'S CONTENT, NOT AN INVENTION. `renderSidebarNav()` in
 * `public/index.html` builds: the five worlds, a divider, the hub rows
 * (Collections · Communities · Circles · Go Live), a divider, Pro while there
 * is something to upgrade to, and a footer trio of Account · Settings · Help &
 * feedback. Same rows here, same order, same rule about Pro disappearing once
 * you are Pro.
 *
 * THE MATERIAL, and why the panel is not Liquid Glass. A drawer is a large
 * surface, and `UIGlassEffect` LENSES — it bends and brightens what is near its
 * edges, which blooms across anything that wide (round seventeen, when the top
 * bar did exactly that over a field of blue bubbles). Apple's own division:
 * glass on CONTROLS, the plain material behind a panel. So the panel is a
 * uniform blur with the page's own tint over it, and the two controls ON it —
 * the account button and the compose pill — are real glass.
 *
 * The page behind slides and dims rather than staying put, which is what makes
 * the drawer read as ON TOP of the app rather than beside it.
 */
const WIDTH = Math.min(320, Dimensions.get('window').width * 0.84);
const OPEN = { duration: 260, easing: Easing.out(Easing.cubic) };
const SHUT = { duration: 200, easing: Easing.in(Easing.cubic) };

type Row = {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  go: string;
  /** Blue, like the web's `.sb-upgrade`. */
  accent?: boolean;
};

/** The five worlds, in the web's order. */
const WORLDS: Row[] = [
  { label: 'Home', icon: 'home-outline', go: '/' },
  { label: 'Beam', icon: 'chatbubbles-outline', go: '/beam' },
  { label: 'Engine', icon: 'compass-outline', go: '/engine' },
  { label: 'Alerts', icon: 'notifications-outline', go: '/notifications' },
  { label: 'Account', icon: 'person-outline', go: '/profile' },
];

/** The web's hub group, verbatim. */
const HUB: Row[] = [
  { label: 'Collections', icon: 'bookmark-outline', go: '/starred' },
  { label: 'Communities', icon: 'people-outline', go: '/communities' },
  { label: 'Circles', icon: 'ellipse-outline', go: '/circles' },
  { label: 'Marketplace', icon: 'storefront-outline', go: '/marketplace' },
];

/** The web's footer trio. */
const FOOT: Row[] = [
  { label: 'Settings', icon: 'settings-outline', go: '/settings' },
  { label: 'Help & feedback', icon: 'help-circle-outline', go: '/feedback' },
];

export function Sidebar({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withTiming(visible ? 1 : 0, visible ? OPEN : SHUT);
  }, [visible, t]);

  const panel = useAnimatedStyle(() => ({
    transform: [{ translateX: -WIDTH * (1 - t.value) }],
  }));
  const scrim = useAnimatedStyle(() => ({ opacity: t.value * 0.5 }));

  const go = (to: string) => {
    haptics.tap();
    onClose();
    /* Let the drawer start closing before the screen changes, so the two read
       as one movement rather than a swap behind a sliding panel. */
    setTimeout(() => router.push(to as never), 120);
  };

  if (!visible && t.value === 0) return null;
  const isPro = user?.plan === 'pro';

  const Line = ({ r }: { r: Row }) => (
    <Pressable
      onPress={() => go(r.go)}
      accessibilityRole="button"
      accessibilityLabel={r.label}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.s2 }]}
    >
      <Ionicons name={r.icon} size={23} color={r.accent ? c.accent : c.text} />
      <Text variant="body" weight="600" style={{ color: r.accent ? c.accent : c.text, flex: 1 }}>
        {r.label}
      </Text>
    </Pressable>
  );

  return (
    /* Above every screen's own chrome (zIndex 20) — without this the top bar
       painted over the drawer's first rows. Below the root status strip (30),
       which is right: the clock stays legible over everything. */
    <View style={[StyleSheet.absoluteFill, { zIndex: 25 }]} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
      </Animated.View>

      <Animated.View style={[styles.panel, { width: WIDTH }, panel]}>
        {/* SOLID, and that is the founder's own reference. A drawer is a PLACE
            you have moved to, not a window onto the page behind: at 0.82 the
            feed read straight through it and the rows sat in a jumble of posts,
            and even at 0.97 the headlines were still legible underneath.
            Their screenshot shows a solid panel carrying glass CONTROLS — which
            is also the division this app settled on in round seventeen, so a
            blur here would be a layer that costs a frame and shows nothing. */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]} />

        <View style={{ paddingTop: insets.top + 10, flex: 1 }}>
          <View style={styles.brand}>
            <AtweMark size={26} still />
            <Text variant="title" style={{ color: c.text }}>Atwe</Text>
          </View>

          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {WORLDS.map((r) => <Line key={r.label} r={r} />)}
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            {HUB.map((r) => <Line key={r.label} r={r} />)}
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            {/* Gone once you ARE Pro — the same rule the web applies, and the
                same one the account menu applies to its plan row: there is
                nothing here for a paying member to do. */}
            {!isPro && <Line r={{ label: 'Upgrade to Pro', icon: 'star-outline', go: '/settings', accent: true }} />}
            {FOOT.map((r) => <Line key={r.label} r={r} />)}
          </ScrollView>

          {/* The two controls, and the only real glass on the panel. */}
          <View style={[styles.foot, { paddingBottom: Math.max(spacing.md, insets.bottom) }]}>
            <GlassIcon size={44} label="Your account" onPress={() => go('/profile')}>
              <Avatar name={user?.name} avatar={user?.avatar}
                biz={user?.accountType === 'business'} size={44} />
            </GlassIcon>
            <Pressable
              onPress={() => go('/compose')}
              accessibilityRole="button"
              accessibilityLabel="New post"
              style={({ pressed }) => [
                styles.compose,
                { backgroundColor: c.primary },
                pressed && { opacity: 0.9, transform: [{ scale: 0.97 }] },
              ]}
            >
              <Ionicons name="add" size={21} color={c.onPrimary} />
              <Text variant="headline" style={{ color: c.onPrimary }}>New post</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: '#000' },
  panel: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0,
    overflow: 'hidden',
    /* Depth, so it reads as ON the app rather than cut into it. */
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 6, height: 0 },
  },
  brand: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingHorizontal: spacing.gutter, paddingBottom: 18,
  },
  scroll: { paddingBottom: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    paddingHorizontal: spacing.gutter, minHeight: 52,
    borderRadius: radius.card, marginHorizontal: 6,
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 10, marginHorizontal: spacing.gutter },
  foot: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: spacing.md, paddingTop: 10,
  },
  compose: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 46, borderRadius: radius.pill,
  },
});
