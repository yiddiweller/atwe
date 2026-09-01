import { useMemo, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromeButton } from '@/components/Chrome';
import { HapticInput } from '@/components/HapticInput';
import { MeGroup, MeRow } from '@/components/MeRow';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, row, spacing } from '@/theme/tokens';
import { useAuth } from '@/auth/AuthProvider';
import { haptics } from '@/lib/haptics';
import { setFind, setGroups } from '@/settings/pages';

/**
 * Settings — the web's `#settingsOverlay`, rebuilt.
 *
 * A sticky header with a back arrow and the title only (no trailing Done — the
 * arrow already closes it), the search bar inline at the top of the list, then
 * grouped cards of rows with a plain outline glyph, a subtitle and a chevron.
 * Every leaf is a real page of its own.
 */
export default function Settings() {
  const { c } = useTheme();
  const { user, logout } = useAuth();
  const router = useRouter();
  const [q, setQ] = useState('');
  const groups = useMemo(() => (user ? setGroups(user) : []), [user]);
  const hits = useMemo(() => (user ? setFind(q, user) : []), [q, user]);
  if (!user) return null;
  const searching = q.trim().length > 0;

  const open = (p: { id: string; to?: string }) => {
    haptics.tap();
    router.push((p.to ?? `/settings/${p.id}`) as never);
  };

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <ChromeButton onPress={() => { haptics.tap(); router.back(); }} label="Back">
            <Ionicons name="chevron-back" size={22} color={c.text} />
          </ChromeButton>
          <Text style={styles.title}>Settings</Text>
        </View>

        {/* `.iset-search` — the SAME component as the Account page's bar, on
            purpose: the two settings-shaped surfaces are meant to read as one
            system. Hub only, as in iOS Settings. */}
        <View style={[styles.search, { backgroundColor: c.s2 }]}>
          <Ionicons name="search" size={17} color={c.t3} />
          <HapticInput
            value={q} onChangeText={setQ}
            placeholder="Search settings" placeholderTextColor={c.t3}
            style={[styles.searchIn, { color: c.text }]}
            autoCorrect={false} autoCapitalize="none" returnKeyType="search"
            accessibilityLabel="Search settings"
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
              {hits.map((p, i) => (
                <MeRow key={p.id} icon={p.ic} label={p.label} sub={p.sub}
                  onPress={() => open(p)} last={i === hits.length - 1} />
              ))}
            </MeGroup>
          ) : (
            <Text style={[styles.none, { color: c.t3 }]}>No setting matches “{q.trim()}”.</Text>
          )
        ) : (
          <>
            {groups.map((g, gi) => (
              <MeGroup key={gi}>
                {g.map((p, i) => (
                  <MeRow key={p.id} icon={p.ic} label={p.label} sub={p.sub}
                    onPress={() => open(p)} last={i === g.length - 1} />
                ))}
              </MeGroup>
            ))}
            <MeGroup>
              <MeRow icon="log-out-outline" label="Sign out" danger last noChevron
                onPress={() => {
                  haptics.tap();
                  Alert.alert('Sign out?', 'You can sign back in any time.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Sign out', style: 'destructive', onPress: () => { void logout(); } },
                  ]);
                }} />
            </MeGroup>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.gutter, paddingTop: 2, paddingBottom: 60 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 14 },
  back: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginLeft: -9 },
  /* `.iset-title` — 24/800, the same as a section page's, so the two settings-
     shaped surfaces read as one system. */
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.48, lineHeight: 29},
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingVertical: 12, paddingHorizontal: 15, marginBottom: 12,
    minHeight: row.height, borderRadius: radius.pill,
  },
  searchIn: { flex: 1, minWidth: 0, fontSize: 15.5, padding: 0 },
  none: { fontSize: 14, textAlign: 'center', marginTop: 22, lineHeight: 20 },
});
