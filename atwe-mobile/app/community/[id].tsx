import { useState } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { useTheme } from '@/theme/ThemeProvider';
import { useCommunity, joinCommunity, joinCommunityGroup } from '@/api/discover';
import { compact } from '@/lib/format';
import { haptics } from '@/lib/haptics';

/**
 * One community: its announcement channel and its group chats. Joining the
 * community also joins the announcements — that is the server's behaviour and
 * the reason the channel is not offered as a separate thing to join.
 */
export default function CommunityDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius, spacing: sp } = useTheme();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useCommunity(id);
  const x = data?.community;
  const groups = data?.groups ?? [];
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (!x) return;
    setBusy(true);
    try { await joinCommunity(x.id, !x.isMember); haptics.success(); await refetch(); }
    catch (e) { haptics.error(); Alert.alert('Communities', (e as Error).message); }
    finally { setBusy(false); }
  };

  const enterGroup = async (gid: number, isMember: boolean) => {
    if (!x) return;
    try {
      if (!isMember) { await joinCommunityGroup(x.id, gid); haptics.success(); await refetch(); }
      router.push(`/group/${gid}`);
    } catch (e) { haptics.error(); Alert.alert('Communities', (e as Error).message); }
  };

  return (
    <Screen edges={['top']}>
      <PageHeader title={x?.name ?? 'Community'} />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !x ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">This community is no longer here.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: sp.lg, paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <Avatar name={x.name} avatar={x.avatar} size={72} />
            <Text variant="title" weight="800" style={{ marginTop: 10 }}>{x.name}</Text>
            <Text variant="caption" tone="t3" style={{ marginTop: 2 }}>
              {[
                x.members != null ? `${compact(x.members)} member${x.members === 1 ? '' : 's'}` : null,
                x.groups != null ? `${x.groups} group${x.groups === 1 ? '' : 's'}` : null,
              ].filter(Boolean).join(' · ')}
            </Text>
            {!!x.description && (
              <Text variant="body" tone="t2" style={{ marginTop: 12, textAlign: 'center', lineHeight: 22 }}>
                {x.description}
              </Text>
            )}
          </View>

          <View style={{ marginTop: 20 }}>
            <Button
              title={x.isMember ? 'Leave' : 'Join'}
              kind={x.isMember ? 'secondary' : 'primary'}
              loading={busy}
              onPress={toggle}
            />
          </View>

          {x.isMember && !!x.announceGroupId && (
            <Pressable
              onPress={() => router.push(`/group/${x.announceGroupId}`)}
              style={[styles.row, { backgroundColor: c.s1, borderRadius: radius.card, marginTop: 18 }]}
              accessibilityRole="button"
              accessibilityLabel="Announcements"
            >
              <View style={[styles.disc, { backgroundColor: c.accentDim }]}>
                <Ionicons name="megaphone-outline" size={18} color={c.accent} />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text variant="callout" weight="700">Announcements</Text>
                <Text variant="micro" tone="t3">From whoever runs this</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.t3} />
            </Pressable>
          )}

          {groups.length > 0 && (
            <View style={{ marginTop: 24 }}>
              <Text variant="headline" style={{ marginBottom: 8 }}>Groups</Text>
              {groups.map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => enterGroup(g.id, g.isMember)}
                  style={[styles.row, { backgroundColor: c.s1, borderRadius: radius.card, marginBottom: 10 }]}
                  accessibilityRole="button"
                  accessibilityLabel={g.name}
                >
                  <Avatar name={g.name} avatar={g.avatar} size={40} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text variant="callout" weight="700" numberOfLines={1}>{g.name}</Text>
                    <Text variant="micro" tone="t3">
                      {compact(g.members)} member{g.members === 1 ? '' : 's'}
                      {g.isMember ? ' · joined' : ''}
                    </Text>
                  </View>
                  <Text variant="micro" style={{ color: g.isMember ? c.t3 : c.accent }}>
                    {g.isMember ? 'Open' : 'Join'}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  hero: { alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  disc: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
