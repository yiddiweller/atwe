import { useState } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, Alert, Linking, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { PageHeader } from '@/components/PageHeader';
import { useTheme } from '@/theme/ThemeProvider';
import { useNewsletter, subscribeNewsletter, priceOrFree } from '@/api/discover';
import { mediaUri } from '@/lib/media';
import { compact, monthYear } from '@/lib/format';
import { haptics } from '@/lib/haptics';

/** One newsletter: what it is, who writes it, and its issues. */
export default function NewsletterDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius, spacing: sp } = useTheme();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useNewsletter(id);
  const n = data?.newsletter;
  const issues = data?.issues ?? [];
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (!n) return;
    setBusy(true);
    try {
      const r = await subscribeNewsletter(n.id, !n.subscribed);
      // A paid newsletter answers with a Stripe URL, like a ticketed event.
      if (r.url) { await Linking.openURL(r.url); return; }
      haptics.success();
      await refetch();
    } catch (e) {
      haptics.error();
      Alert.alert('Newsletters', (e as Error).message);
    } finally { setBusy(false); }
  };

  const o = n?.owner;
  return (
    <Screen edges={['top']}>
      <PageHeader title={n?.title ?? 'Newsletter'} />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !n ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">This newsletter is no longer here.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
          {!!mediaUri(n.cover) && (
            <Image source={{ uri: mediaUri(n.cover) }} style={[styles.cover, { backgroundColor: c.s2 }]}
              contentFit="cover" transition={120} />
          )}
          <View style={{ padding: sp.lg }}>
            <Text variant="display" weight="800">{n.title}</Text>
            <Text variant="caption" tone="t3" style={{ marginTop: 4 }}>
              {compact(n.subscribers)} reader{n.subscribers === 1 ? '' : 's'} · {n.issues} issue{n.issues === 1 ? '' : 's'}
              {n.priceCents > 0 ? ` · ${priceOrFree(n.priceCents)} a month` : ''}
            </Text>

            {!!o && (
              <Pressable
                onPress={() => o.username && router.push(`/user/${o.username}`)}
                style={[styles.who, { backgroundColor: c.s1, borderRadius: radius.card }]}
                accessibilityRole="button" accessibilityLabel={`View ${o.name}`}
              >
                <Avatar name={o.name} avatar={o.avatar} biz={o.business} size={40} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <View style={styles.nameLine}>
                    <Text variant="headline" numberOfLines={1}>{o.name}</Text>
                    {o.verified && <VerifiedBadge size={14} />}
                  </View>
                  <Text variant="caption" tone="t3">Writes this</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.t3} />
              </Pressable>
            )}

            {!!n.description && (
              <Text variant="body" tone="t2" style={{ marginTop: 16, lineHeight: 23 }}>
                {n.description}
              </Text>
            )}

            {!n.mine && (
              <View style={{ marginTop: 22 }}>
                <Button
                  title={n.subscribed ? 'Subscribed' : n.priceCents > 0
                    ? `Subscribe · ${priceOrFree(n.priceCents)}/mo` : 'Subscribe'}
                  kind={n.subscribed ? 'secondary' : 'primary'}
                  loading={busy}
                  onPress={toggle}
                />
              </View>
            )}

            {issues.length > 0 && (
              <View style={{ marginTop: 26 }}>
                <Text variant="headline">Issues</Text>
                {issues.map((i) => (
                  <Pressable
                    key={i.id}
                    onPress={() => {
                      if (n.locked) {
                        haptics.warning();
                        Alert.alert('Subscribers only', 'Subscribe to read the issues.');
                        return;
                      }
                      router.push(`/newsletter/issue/${i.id}`);
                    }}
                    style={styles.issue}
                    accessibilityRole="button"
                    accessibilityLabel={i.title}
                  >
                    <View style={{ flex: 1 }}>
                      <Text variant="callout" weight="700" numberOfLines={2}>{i.title}</Text>
                      <Text variant="micro" tone="t3">{monthYear(i.createdAt)}</Text>
                    </View>
                    <Ionicons name={n.locked ? 'lock-closed' : 'chevron-forward'} size={16} color={c.t3} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  cover: { width: '100%', aspectRatio: 2.4 },
  who: { flexDirection: 'row', alignItems: 'center', padding: 12, marginTop: 16 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  issue: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
});
