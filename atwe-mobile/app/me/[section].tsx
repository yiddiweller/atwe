import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { MeGroup, MeRow } from '@/components/MeRow';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useAuth } from '@/auth/AuthProvider';
import { money } from '@/api/wallet';
import { haptics } from '@/lib/haptics';
import { meItems, meLabel, meSection } from '@/me/sections';

/**
 * One section of the Account page — the web's `acMeSection`.
 *
 * Same card, same rows, same icon treatment as the hub; only the nesting is
 * new, which is the whole point of splitting a 35-row list in two. The web
 * animates this in-page; here it is a real route, so it gets the platform's own
 * push and the edge swipe back for free.
 */
export default function MeSectionPage() {
  const { c } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const { section } = useLocalSearchParams<{ section: string }>();
  const s = meSection(String(section));
  if (!user || !s) return null;
  const items = meItems(s, user);

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        {/* `.me-sechead` — this page has no top bar either, so the back arrow
            lives in the header beside the title. */}
        <View style={styles.head}>
          <Pressable onPress={() => { haptics.tap(); router.back(); }} hitSlop={8}
            accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
            <Ionicons name="chevron-back" size={26} color={c.text} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{s.title}</Text>
        </View>

        <MeGroup>
          {items.map((it, i) => (
            <MeRow
              key={String(it.l)}
              icon={it.ic}
              label={meLabel(it, user)}
              /* The wallet row carries the balance, the way the web does — a
                 number you were going to open the screen to read anyway. */
              value={it.to === '/wallet' ? money(user.balanceCents ?? 0) : undefined}
              onPress={() => { haptics.tap(); router.push(it.to as never); }}
              last={i === items.length - 1}
            />
          ))}
        </MeGroup>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.gutter, paddingTop: 2, paddingBottom: 120 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 14 },
  back: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginLeft: -9 },
  /* `.me-sectitle` */
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.48, flex: 1, minWidth: 0 },
});
