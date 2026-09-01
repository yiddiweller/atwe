import { View, Image, Pressable, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/tokens';
import { haptics } from '@/lib/haptics';
import { money } from '@/api/wallet';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * A rich card inside a conversation — the web's `acMetaCard`.
 *
 * Beam's own pitch is "send money in the chat: pay, request or split a bill
 * without leaving the conversation", and on the phone every one of those
 * rendered as the literal text **"📎 Attachment"**. Somebody sent you $50 and
 * you saw a paperclip. An invoice arrived with no way to pay it. An order, a
 * split, a quote, a shared listing, a call that just happened — all the same
 * paperclip, all dead.
 *
 * The phone already had every destination (invoice/[id], quote/[id],
 * split/[id], order/[id], listing/[id], pool/[id], offer/[id]); the card is the
 * missing link between a conversation and them.
 *
 * MOST CARDS ARE ONE SHAPE and that is deliberate, not lazy — the web's
 * `mc-invoice`: a tinted icon disc, a title, a line of context, an amount, and
 * the whole thing taps through. Money, calls, locations, contacts, products,
 * polls and Daily replies each get their own, because each is saying something
 * a row cannot.
 */
export interface Meta {
  t: string;
  [k: string]: unknown;
}

const n = (v: unknown) => (typeof v === 'number' ? v : 0);
const s = (v: unknown) => (typeof v === 'string' ? v : '');

export function MetaCard({ meta, mine, body }: {
  meta: Meta;
  /** Whose bubble this is. Nearly every card reads differently from each side —
   *  "You sent money" against "You received money". */
  mine: boolean;
  /** The message's own text, which a Daily reply shows inside the card. */
  body?: string | null;
}) {
  const { c } = useTheme();
  const router = useRouter();
  const go = (to: string) => { haptics.tap(); router.push(to as never); };

  switch (meta.t) {
    /* ── Money ───────────────────────────────────────────────────────────── */
    case 'money':
      return (
        <Row
          icon="paper-plane" tint={c.accent}
          title={mine ? 'You sent money' : 'You received money'}
          sub={s(meta.note) || (mine ? 'Payment sent' : 'Payment received')}
          amount={(mine ? '−' : '+') + money(n(meta.amountCents))}
          amountTone={mine ? c.text : c.success}
          onPress={() => go('/wallet')}
        />
      );

    case 'moneyrequest':
      return (
        <Row
          icon="download" tint={c.accent}
          title={mine ? 'You asked for money' : 'Asked you for money'}
          sub={s(meta.note) || (mine ? 'Waiting to be paid' : 'Tap to pay')}
          amount={money(n(meta.amountCents))}
          onPress={() => go('/wallet-requests')}
        />
      );

    case 'invoice':
      return (
        <Row
          icon="receipt" tint={c.accent}
          title={s(meta.title) || 'Invoice'}
          sub={mine ? 'Invoice sent · tap to view' : 'Invoice · tap to pay'}
          amount={money(n(meta.amountCents))}
          onPress={() => meta.id && go(`/invoice/${n(meta.id)}`)}
        />
      );

    case 'quote':
      return (
        <Row
          icon="document-text" tint={c.accent}
          title={s(meta.title) || 'Quote'}
          sub={mine ? 'Quote sent · tap to view' : 'Quote · tap to review'}
          amount={money(n(meta.amountCents))}
          onPress={() => meta.id && go(`/quote/${n(meta.id)}`)}
        />
      );

    case 'split':
      return (
        <Row
          icon="pie-chart" tint={c.accent}
          title={'Split request' + (s(meta.title) ? ` · ${s(meta.title)}` : '')}
          sub={mine ? 'You requested their share' : 'Your share · tap to pay'}
          amount={money(n(meta.amountCents))}
          onPress={() => meta.splitId && go(`/split/${n(meta.splitId)}`)}
        />
      );

    case 'pool': {
      const pct = n(meta.goalCents)
        ? Math.min(100, Math.round((n(meta.raisedCents) / n(meta.goalCents)) * 100)) : 0;
      return (
        <Row
          icon="people-circle" tint={c.green}
          title={s(meta.title) || 'Money pool'}
          sub={`${money(n(meta.raisedCents))} of ${money(n(meta.goalCents))} · tap to chip in`}
          amount={`${pct}%`}
          onPress={() => meta.poolId && go(`/pool/${n(meta.poolId)}`)}
        />
      );
    }

    case 'gift':
      return (
        <Row
          icon="gift" tint={c.accent}
          title="Gift card"
          sub={mine ? 'You sent a gift card' : 'Tap to redeem'}
          amount={money(n(meta.amountCents))}
          onPress={() => go('/gift-cards')}
        />
      );

    case 'order': {
      const escrow = !!meta.escrow;
      return (
        <Row
          icon={escrow ? 'shield-checkmark' : 'bag-handle'} tint={escrow ? c.green : c.accent}
          title={escrow ? 'Protected order' : 'New order'}
          sub={escrow ? 'Payment held in escrow · tap to view' : 'Order · tap to view'}
          amount={money(n(meta.totalCents))}
          onPress={() => meta.id && go(`/order/${n(meta.id)}`)}
        />
      );
    }

    case 'digital':
      return (
        <Row
          icon="cloud-download" tint={c.accent}
          title="Digital delivery"
          /* The seller's own copy never shows what was delivered — the content
             is the buyer's. */
          sub={mine ? 'Sent · the buyer can open it' : 'Your download is ready · tap to open'}
          onPress={() => meta.orderId && go(`/order/${n(meta.orderId)}`)}
        />
      );

    case 'offer': {
      const label: Record<string, string> = {
        made: mine ? 'You made an offer' : 'Made an offer',
        countered: mine ? 'You countered' : 'Countered your offer',
        accepted: 'Offer accepted', declined: 'Offer declined', paid: 'Offer paid',
      };
      const title = label[s(meta.action)] || 'Offer';
      return (
        <Row
          icon="pricetag" tint={c.amber}
          title={title}
          sub={(s(meta.productName) ? `${s(meta.productName)} · ` : '') + 'tap to view'}
          amount={money(n(meta.amountCents))}
          onPress={() => meta.offerId && go(`/offer/${n(meta.offerId)}`)}
        />
      );
    }

    /* ── A call that happened ────────────────────────────────────────────── */
    case 'call': {
      const video = meta.kind === 'video';
      const dur = n(meta.durationSec);
      const answered = dur > 0;
      /* Direction is per-viewer: the caller's own bubble is outgoing. A call
         nobody answered is only MISSED for the person who was rung — the caller
         did not miss anything, they got no answer. */
      const missed = !answered && !mine;
      const m = Math.floor(dur / 60);
      return (
        <Row
          icon={video ? 'videocam' : 'call'}
          tint={missed ? c.danger : c.accent}
          title={
            answered ? (video ? 'Video call' : 'Voice call')
            : mine ? (video ? 'Video call' : 'Voice call')
            : (video ? 'Missed video call' : 'Missed voice call')
          }
          titleTone={missed ? c.danger : undefined}
          sub={answered ? (m ? `${m}m ${dur % 60}s` : `${dur}s`) : mine ? 'No answer' : 'Tap to call back'}
          onPress={() => go('/(tabs)/beam')}
        />
      );
    }

    /* ── Places ──────────────────────────────────────────────────────────── */
    case 'location':
    case 'livelocation': {
      const lat = n(meta.lat), lng = n(meta.lng);
      const live = meta.t === 'livelocation';
      return (
        <Pressable
          onPress={() => { haptics.tap(); void Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`); }}
          accessibilityRole="button"
          accessibilityLabel={live ? 'Live location, open in Maps' : 'Location, open in Maps'}
          style={({ pressed }) => [styles.card, { backgroundColor: c.s3 }, pressed && { opacity: 0.85 }]}
        >
          <View style={[styles.map, { backgroundColor: c.s2 }]}>
            <Ionicons name={live ? 'radio' : 'location'} size={30} color={live ? c.green : c.accent} />
          </View>
          <View style={styles.mapFoot}>
            <Text variant="callout">{live ? 'Live location' : s(meta.label) || 'Shared location'}</Text>
            <Text variant="caption" tone="t3" style={{ marginTop: 2 }}>
              {lat.toFixed(4)}, {lng.toFixed(4)} · Open in Maps
            </Text>
          </View>
        </Pressable>
      );
    }

    /* ── People and things ───────────────────────────────────────────────── */
    case 'contact':
      return (
        <View style={[styles.card, styles.rowCard, { backgroundColor: c.s3 }]}>
          <Avatar name={s(meta.name)} avatar={null} size={38} />
          <View style={styles.main}>
            <Text variant="callout" numberOfLines={1}>{s(meta.name) || 'Contact'}</Text>
            <Text variant="caption" tone="t3" numberOfLines={1}>
              {s(meta.phone) || s(meta.email) || (s(meta.username) ? `@${s(meta.username)}` : 'Contact card')}
            </Text>
          </View>
        </View>
      );

    case 'product':
    case 'cartrecovery': {
      const cart = meta.t === 'cartrecovery';
      const cents = cart ? n(meta.totalCents) : (n(meta.priceFromCents) || n(meta.priceCents));
      const img = s(meta.image);
      return (
        <Pressable
          onPress={() => {
            if (cart) { haptics.tap(); router.push('/cart'); return; }
            if (meta.productId) go(`/listing/${n(meta.productId)}`);
          }}
          accessibilityRole="button"
          accessibilityLabel={cart ? 'Your cart is waiting' : `${s(meta.name)}, tap to view`}
          style={({ pressed }) => [styles.card, styles.rowCard, { backgroundColor: c.s3 }, pressed && { opacity: 0.85 }]}
        >
          {img
            ? <Image source={{ uri: img }} style={styles.thumb} />
            : <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: c.s2 }]}>
                <Ionicons name="cube-outline" size={20} color={c.t3} />
              </View>}
          <View style={styles.main}>
            <Text variant="callout" numberOfLines={1}>
              {cart ? 'Your cart is waiting' : s(meta.name) || 'Product'}
            </Text>
            <Text variant="caption" weight="700" style={{ marginTop: 2 }}>
              {(meta.hasVariants ? 'from ' : '') + money(cents)}
            </Text>
            <Text variant="caption" tone="t3" style={{ marginTop: 1 }}>
              {cart
                ? (mine ? 'Reminder sent' : 'Tap to finish checking out')
                : (mine ? 'Shared · tap to view' : 'Tap to view & buy')}
            </Text>
          </View>
        </Pressable>
      );
    }

    /* ── A reply to a Daily ──────────────────────────────────────────────── */
    case 'storyreply': {
      const st = (meta.story || {}) as Record<string, unknown>;
      const thumb = s(st.media);
      const lead = mine
        ? (meta.emoji ? 'You reacted to their Daily' : 'You replied to their Daily')
        : (meta.emoji ? 'Reacted to your Daily' : 'Replied to your Daily');
      return (
        <View style={[styles.card, styles.rowCard, { backgroundColor: c.s3 }]}>
          {thumb
            ? <Image source={{ uri: thumb }} style={styles.storyThumb} />
            : <View style={[styles.storyThumb, { backgroundColor: c.s2 }]} />}
          <View style={styles.main}>
            <Text variant="caption" tone="t3">{lead}</Text>
            <Text
              variant={meta.emoji ? 'display' : 'callout'}
              style={{ marginTop: 3 }}
              numberOfLines={meta.emoji ? 1 : 3}
            >
              {body || ''}
            </Text>
          </View>
        </View>
      );
    }

    /* A sticker is its own shape — no card, no bubble, the way a real one is. */
    case 'sticker':
      return s(meta.image)
        ? <Image source={{ uri: s(meta.image) }} style={styles.sticker} resizeMode="contain" />
        : null;

    /* ── Anything the phone does not draw yet ────────────────────────────── */
    default:
      return null;
  }
}

/** The shared shape — the web's `mc-invoice`. */
function Row({ icon, tint, title, titleTone, sub, amount, amountTone, onPress }: {
  icon: IconName;
  tint: string;
  title: string;
  titleTone?: string;
  sub: string;
  amount?: string;
  amountTone?: string;
  onPress?: () => void;
}) {
  const { c } = useTheme();
  const inner = (
    <>
      <View style={[styles.disc, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={17} color={c.accentTint} />
      </View>
      <View style={styles.main}>
        <Text variant="callout" numberOfLines={1} style={titleTone ? { color: titleTone } : undefined}>
          {title}
        </Text>
        <Text variant="caption" tone="t3" numberOfLines={2} style={{ marginTop: 1 }}>{sub}</Text>
      </View>
      {!!amount && (
        /* Never shrunk and never wrapped: an amount broken across two lines is
           unreadable, and a truncated one is worse than unreadable. The title
           beside it is the thing that gives way. */
        <Text
          variant="headline"
          numberOfLines={1}
          style={[{ flexShrink: 0 }, amountTone ? { color: amountTone } : null]}
        >
          {amount}
        </Text>
      )}
    </>
  );
  if (!onPress) {
    return <View style={[styles.card, styles.rowCard, { backgroundColor: c.s3 }]}>{inner}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}${amount ? `. ${amount}` : ''}`}
      style={({ pressed }) => [styles.card, styles.rowCard, { backgroundColor: c.s3 }, pressed && { opacity: 0.85 }]}
    >
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /* A card sits INSIDE a fully-rounded bubble, so it takes the app's own
     card corner rather than a tighter one — a 14pt box beside a capsule
     reads as a different app. */
  card: { borderRadius: radius.card, overflow: 'hidden', minWidth: 232 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11 },
  disc: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, minWidth: 0 },
  thumb: { width: 46, height: 46, borderRadius: 10 },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  storyThumb: { width: 38, height: 54, borderRadius: 8 },
  map: { height: 92, alignItems: 'center', justifyContent: 'center' },
  mapFoot: { padding: 11 },
  sticker: { width: 132, height: 132 },
});
