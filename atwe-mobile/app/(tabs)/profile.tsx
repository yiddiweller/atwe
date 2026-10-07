import { useMemo, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Alert, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { HapticInput } from '@/components/HapticInput';
import { MeGroup, MeRow } from '@/components/MeRow';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, row, spacing } from '@/theme/tokens';
import { useAuth } from '@/auth/AuthProvider';
import { money } from '@/api/wallet';
import { haptics } from '@/lib/haptics';
import { ME_HUB_FOOT, ME_HUB_TAIL, meExternal, meFind, meLabel, meSections } from '@/me/sections';

/**
 * Account — the web's Me hub, rebuilt.
 *
 * It was a flat list of ~35 rows under uppercase headings with blue-tint icon
 * discs, which is the design the web itself threw out: an identity hero, then a
 * WALLET card, then a search bar, then section rows that each open a page of
 * their own. That is what this is now, to the web's own numbers.
 *
 * The page has no top bar on purpose — the hero leads with a clean top, and
 * everything above the sections is what you came here to see rather than
 * chrome.
 */
export default function Profile() {
  const { c } = useTheme();
  const { user, logout } = useAuth();
  const router = useRouter();
  const [q, setQ] = useState('');
  const sections = useMemo(() => (user ? meSections(user) : []), [user]);
  const hits = useMemo(() => (user ? meFind(q, user) : []), [q, user]);
  if (!user) return null;

  const insets = useSafeAreaInsets();
  const isBiz = user.accountType === 'business';
  const searching = q.trim().length > 0;

  /* NO TOP INSET. The page's own SafeAreaView filled that strip with the page
     colour, so content scrolled under a hard black band — the founder
     photographed exactly that. `StatusScrim` covers the clock now, and it fades
     out instead of ending on a line. */
  return (
    <Screen edges={[]}>
      <ScrollView
        /* The inset is padding now, not a SafeAreaView background: the content
           starts below the clock at rest and scrolls UNDER the fading strip,
           instead of stopping at a painted black band. Read live rather than
           from a module constant so it is right whatever the device. */
        contentContainerStyle={[styles.page, { paddingTop: insets.top + 2 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* `.me-hero` — who you are, opening your public profile. */}
        <Pressable
          onPress={() => { haptics.tap(); if (user.username) router.push(`/user/${user.username}`); }}
          accessibilityRole="button"
          accessibilityLabel="View your profile"
          style={({ pressed }) => [
            styles.hero, { backgroundColor: c.s2 }, pressed && { transform: [{ scale: 0.99 }] },
          ]}
        >
          <Avatar name={user.name} avatar={user.avatar} biz={isBiz} size={62} />
          <View style={styles.heroMain}>
            <View style={styles.heroNameRow}>
              <Text style={styles.heroName} numberOfLines={1}>{user.name}</Text>
              {user.verified && <VerifiedBadge size={16} />}
            </View>
            {!!user.username && (
              <Text style={[styles.heroHandle, { color: c.t3 }]} numberOfLines={1}>@{user.username}</Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={19} color={c.t4} />
        </Pressable>

        {/* `.me-wallet` — the balance, pinned under the identity header, with
            the three things you do with money one tap away. */}
        <Pressable
          onPress={() => { haptics.tap(); router.push('/wallet'); }}
          accessibilityRole="button"
          accessibilityLabel="Atwe Wallet"
          style={({ pressed }) => [pressed && { transform: [{ scale: 0.99 }] }]}
        >
          <LinearGradient
            colors={[c.accent, '#123f96']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.wallet}
          >
            <View style={styles.walletHead}>
              <Text style={styles.walletCap}>Atwe Wallet</Text>
              <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.75)" />
            </View>
            <Text style={styles.walletBal}>{money(user.balanceCents ?? 0)}</Text>
            <View style={styles.walletActs}>
              {([
                ['Send', '/wallet-send'],
                ['Request', '/wallet-requests'],
                ['Add', '/wallet-topup'],
              ] as const).map(([label, to]) => (
                <Pressable
                  key={label}
                  onPress={() => { haptics.tap(); router.push(to); }}
                  accessibilityRole="button" accessibilityLabel={label}
                  style={({ pressed }) => [
                    styles.walletAct,
                    { backgroundColor: pressed ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.18)' },
                  ]}
                >
                  <Text style={styles.walletActTxt}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </LinearGradient>
        </Pressable>

        {/* `.me-search` — how you reach one of ~35 destinations you can already
            name, without guessing which section holds it. */}
        <View style={[styles.search, { backgroundColor: c.s2 }]}>
          <Ionicons name="search" size={17} color={c.t3} />
          <HapticInput
            value={q}
            onChangeText={setQ}
            placeholder="Search your account"
            placeholderTextColor={c.t3}
            style={[styles.searchIn, { color: c.text }]}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel="Search your account"
          />
          {searching && (
            <Pressable onPress={() => setQ('')} hitSlop={10}
              accessibilityRole="button" accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={c.t3} />
            </Pressable>
          )}
        </View>

        {searching ? (
          hits.length ? (
            <MeGroup>
              {hits.map((h, i) => (
                <MeRow
                  key={h.section.id + String(h.item.l)}
                  icon={h.item.ic}
                  label={meLabel(h.item, user)}
                  sub={h.section.title}
                  onPress={() => {
                    haptics.tap();
                    if (meExternal(h.item.to)) void Linking.openURL(h.item.to);
                    else router.push(h.item.to as never);
                  }}
                  last={i === hits.length - 1}
                />
              ))}
            </MeGroup>
          ) : (
            <Text style={[styles.none, { color: c.t3 }]}>Nothing in your account matches “{q.trim()}”.</Text>
          )
        ) : (
          <>
            {/* The eleven-ish section rows, one card. */}
            <MeGroup>
              {sections.map((s, i) => (
                <MeRow
                  key={s.id}
                  icon={s.ic}
                  label={s.title}
                  /* No subtitle under a section name (owner) — the names carry
                     it. `sub` stays in the table because the search results use
                     it, and because it is what the section page is for. */
                  onPress={() => { haptics.tap(); router.push(`/me/${s.id}` as never); }}
                  last={i === sections.length - 1}
                />
              ))}
            </MeGroup>

            {/* Settings and Help each get their OWN card: neither is a category,
                and gluing them to the bottom of the sections list reads as two
                more sections. One card EACH, not one shared card — two unrelated
                destinations stacked together read as a pair. */}
            {ME_HUB_TAIL.map((it) => (
              <MeGroup key={String(it.l)}>
                <MeRow icon={it.ic} label={meLabel(it, user)} staff={it.staff} last
                  onPress={() => {
                    haptics.tap();
                    if (meExternal(it.to)) void Linking.openURL(it.to);
                    else router.push(it.to as never);
                  }} />
              </MeGroup>
            ))}

            {ME_HUB_FOOT.map((it) => (
              <MeGroup key={String(it.l)}>
                <MeRow icon={it.ic} label={meLabel(it, user)} danger={it.danger} last noChevron={it.danger}
                  onPress={() => {
                    haptics.tap();
                    Alert.alert('Log out?', 'You can sign back in any time.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Log out', style: 'destructive', onPress: () => { void logout(); } },
                    ]);
                  }} />
              </MeGroup>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  /* Every gap down this page is 12 — the hero, the wallet, the search bar and
     each card sit the same distance apart, so the stack reads as one rhythm. */
  page: { paddingHorizontal: spacing.gutter, paddingBottom: 120 },
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 15,
    paddingVertical: 18, paddingHorizontal: 17, marginBottom: 12,
    borderRadius: radius.card,
  },
  heroMain: { flex: 1, minWidth: 0 },
  heroNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroName: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  heroHandle: { fontSize: 14.5, marginTop: 2 },
  wallet: {
    borderRadius: radius.card, marginBottom: 12,
    paddingTop: 15, paddingHorizontal: 18, paddingBottom: 14,
  },
  walletHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  walletCap: { fontSize: 13, fontWeight: '600', color: '#fff', opacity: 0.9 },
  walletBal: { fontSize: 29, fontWeight: '800', color: '#fff', letterSpacing: -0.29, marginTop: 5, marginBottom: 12, lineHeight: 34},
  walletActs: { flexDirection: 'row', gap: 8 },
  walletAct: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.pill },
  walletActTxt: { fontSize: 13, fontWeight: '600', color: '#fff' },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingVertical: 12, paddingHorizontal: 15, marginBottom: 12,
    minHeight: row.height, borderRadius: radius.pill,
  },
  searchIn: { flex: 1, minWidth: 0, fontSize: 15.5, padding: 0 },
  none: { fontSize: 14, textAlign: 'center', marginTop: 22, paddingHorizontal: 20, lineHeight: 20 },
});
