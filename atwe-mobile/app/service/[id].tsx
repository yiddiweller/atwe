import { View, ScrollView, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromeButton, ChromeBar, useFloatingChrome } from '@/components/Chrome';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useService } from '@/api/services';
import { mediaUri } from '@/lib/media';

/**
 * One service. There is no checkout here on purpose — a service is arranged by
 * talking to somebody, so the one white action is Message, and everything above
 * it exists to answer "is this the right person".
 */
export default function ServiceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius, spacing: sp } = useTheme();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useService(id);
  const s = data?.service;
  const p = s?.provider;
  const cover = mediaUri(s?.image);

  const chrome = useFloatingChrome();

  return (
    <Screen edges={[]}>
      <ChromeBar onLayout={chrome.onLayout}>
        <View style={styles.head}>
          <ChromeButton onPress={() => router.back()} label="Back">
            <Ionicons name="chevron-back" size={22} color={c.text} />
          </ChromeButton>
          <View style={{ flex: 1 }} />
          <View style={styles.icon} />
        </View>
      </ChromeBar>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !s ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">This service is no longer listed.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[{ paddingBottom: 48 }, chrome.pad]} showsVerticalScrollIndicator={false}>
          {!!cover && (
            <Image source={{ uri: cover }} style={[styles.cover, { backgroundColor: c.s2 }]}
              contentFit="cover" transition={120} />
          )}
          <View style={{ padding: sp.lg }}>
            <Text variant="display" weight="800">{s.title}</Text>
            {!!s.rate && (
              <Text variant="title" weight="800" style={{ marginTop: 6 }}>{s.rate}</Text>
            )}

            {!!p && (
              <Pressable
                onPress={() => p.username && router.push(`/user/${p.username}`)}
                style={[styles.who, { backgroundColor: c.s1, borderRadius: radius.card }]}
                accessibilityRole="button"
                accessibilityLabel={`View ${p.name}`}
              >
                <Avatar name={p.name} avatar={p.avatar} biz={p.accountType === 'business'} size={40} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <View style={styles.nameLine}>
                    <Text variant="headline" numberOfLines={1}>{p.name}</Text>
                    {p.verified && <VerifiedBadge size={14} />}
                  </View>
                  {p.username && <Text variant="caption" tone="t3">@{p.username}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.t3} />
              </Pressable>
            )}

            <View style={styles.facts}>
              {!!s.area && <Fact icon="location-outline" text={s.area} />}
              {!!s.category && <Fact icon="pricetag-outline" text={s.category} />}
            </View>

            {!!s.description && (
              <Text variant="body" tone="t2" style={{ marginTop: 18, lineHeight: 23 }}>
                {s.description}
              </Text>
            )}

            {s.amenities.length > 0 && (
              <View style={styles.amenities}>
                {s.amenities.map((a) => (
                  <View key={a} style={styles.amenity}>
                    <Ionicons name="checkmark-circle" size={15} color={c.success} />
                    <Text variant="caption" tone="t2">{a}</Text>
                  </View>
                ))}
              </View>
            )}

            {!!p && (
              <View style={{ marginTop: 26 }}>
                <Button
                  title={`Message ${p.name.split(' ')[0]}`}
                  kind="primary"
                  onPress={() => router.push(`/chat/${p.id}`)}
                />
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

function Fact({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.factRow}>
      <Ionicons name={icon} size={17} color={c.t3} />
      <Text variant="body" tone="t2" style={{ flex: 1 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  cover: { width: '100%', aspectRatio: 1.9 },
  who: { flexDirection: 'row', alignItems: 'center', padding: 12, marginTop: 18 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  facts: { marginTop: 16, gap: 10 },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  amenities: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  amenity: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
