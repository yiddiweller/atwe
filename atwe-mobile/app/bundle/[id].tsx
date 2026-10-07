import { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { CheckoutSheet } from '@/components/CheckoutSheet';
import { useTheme } from '@/theme/ThemeProvider';
import { useBundle } from '@/api/seller';
import { money } from '@/api/wallet';
import { mediaUri } from '@/lib/media';
import { useAuth } from '@/auth/AuthProvider';

/**
 * A bundle, and buying it. It goes through the same checkout as everything else
 * — the server builds a normal multi-line order underneath, so fulfilment,
 * shipping, escrow and reviews all work exactly as they do for one item.
 */
export default function BundleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius, spacing } = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { data, isLoading, isError } = useBundle(id);
  const b = data?.bundle;
  const [buying, setBuying] = useState(false);

  const mine = !!b && !!user && b.sellerId === user.id;
  const canBuy = !!b && !mine && b.active && !b.soldOut;

  return (
    <Screen edges={[]}>
      <PageHeader title="Bundle" />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !b ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">This bundle is no longer available.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 60 }, chromePad.header]}>
          <Text variant="title">{b.name}</Text>
          {!!b.description && (
            <Text variant="body" tone="t2" style={{ marginTop: 8, lineHeight: 22 }}>{b.description}</Text>
          )}

          {/* The saving IS the product, so it is the biggest thing on screen. */}
          <View style={[styles.priceBox, { backgroundColor: c.s1, borderRadius: radius.card }]}>
            <View style={{ flex: 1 }}>
              <Text variant="display" weight="800">{money(b.priceCents)}</Text>
              {b.savingsCents > 0 && (
                <Text variant="callout" tone="t3" style={{ marginTop: 2 }}>
                  {money(b.retailCents)} bought separately
                </Text>
              )}
            </View>
            {b.savingsCents > 0 && (
              <View style={[styles.save, { backgroundColor: 'rgba(136,255,0,0.14)' }]}>
                <Text variant="callout" tone="success">save {money(b.savingsCents)}</Text>
              </View>
            )}
          </View>

          {b.soldOut && (
            <Text variant="callout" tone="warning" style={{ marginTop: 10 }}>
              Something in this bundle is out of stock.
            </Text>
          )}

          <Pressable
            onPress={() => b.seller.username && router.push(`/user/${b.seller.username}`)}
            style={[styles.seller, { backgroundColor: c.s1, borderRadius: radius.card }]}
          >
            <Avatar
              name={b.seller.name}
              avatar={b.seller.avatar}
              biz={b.seller.accountType === 'business'}
              size={38}
            />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <View style={styles.nameLine}>
                <Text variant="headline" numberOfLines={1}>{b.seller.name}</Text>
                {b.seller.verified && <VerifiedBadge size={14} />}
              </View>
              {b.seller.username && <Text variant="caption" tone="t3">@{b.seller.username}</Text>}
            </View>
            <Ionicons name="chevron-forward" size={17} color={c.t3} />
          </Pressable>

          <Text variant="caption" tone="t3" style={styles.lbl}>WHAT IS IN IT</Text>
          {b.items.map((it) => (
            <Pressable
              key={it.productId}
              onPress={() => router.push(`/listing/${it.productId}`)}
              style={[styles.item, { borderBottomColor: c.border }]}
            >
              {it.image ? (
                <Image
                  source={{ uri: mediaUri(it.image) }}
                  style={[styles.thumb, { backgroundColor: c.s2, borderRadius: radius.md }]}
                  contentFit="cover"
                  transition={120}
                />
              ) : (
                <View style={[styles.thumb, { backgroundColor: c.s2, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name="cube-outline" size={18} color={c.t3} />
                </View>
              )}
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text variant="body" numberOfLines={2}>{it.name}</Text>
                <Text variant="micro" tone="t3">
                  {money(it.priceCents)}{it.qty > 1 ? ` · ${it.qty}` : ''}
                  {it.stock === 0 ? ' · sold out' : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.t4} />
            </Pressable>
          ))}

          <View style={{ marginTop: 24 }}>
            {canBuy ? (
              <Button title={`Buy the bundle · ${money(b.priceCents)}`} onPress={() => setBuying(true)} />
            ) : mine ? (
              <Text variant="caption" tone="t3" style={{ textAlign: 'center' }}>
                This is your own bundle.
              </Text>
            ) : (
              <Text variant="caption" tone="t3" style={{ textAlign: 'center' }}>
                This bundle is not available right now.
              </Text>
            )}
          </View>
        </ScrollView>
      )}

      {!!b && (
        <CheckoutSheet
          visible={buying}
          onClose={() => setBuying(false)}
          target={{ kind: 'bundle', bundleId: b.id }}
          title={b.name}
          sub={`${b.itemCount} items from ${b.seller.name}`}
          needsShipping={b.needsShipping}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  priceBox: { flexDirection: 'row', alignItems: 'center', padding: 18, marginTop: 18 },
  save: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  seller: { flexDirection: 'row', alignItems: 'center', padding: 12, marginTop: 16 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  lbl: { marginTop: 22, marginBottom: 6, letterSpacing: 0.6 },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  thumb: { width: 46, height: 46 },
});
