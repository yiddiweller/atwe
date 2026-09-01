import { useState } from 'react';
import {
  View, TextInput, ScrollView, Pressable, Alert, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { Button } from './Button';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { createListing, updateListing, type ListingInput } from '@/api/selling';
import { KIND_LABEL, type Listing, type ListingKind } from '@/api/marketplace';
import { pickPhoto, pickPhotoMessage } from '@/lib/pickPhoto';
import { mediaUri } from '@/lib/media';
import { HapticInput } from '@/components/HapticInput';
import { haptics } from '@/lib/haptics';

const KINDS: ListingKind[] = ['physical', 'digital', 'service'];

/**
 * Put something up for sale, or change it.
 *
 * Deliberately the small form, not the whole one the web has. What is here is
 * what a listing cannot go up without — a name, a price, what kind of thing it
 * is, a photo, and for something posted, whether it costs to send. Variants,
 * rentals, wholesale, auctions, subscriptions and structured specs all exist
 * server-side and stay on the web for now; a half-built variant editor that
 * saves the wrong thing is worse than not offering one.
 *
 * The one trap this has to avoid: a PATCH only sends what CHANGED. The
 * my-listings payload has been missing a field before, and a form that sends
 * every field back would then write that missing field's default over the real
 * value — silently switching off local pickup on any listing whose owner edited
 * anything at all.
 */
export function ListingForm({ listing, onSaved, onCancel }: {
  listing?: Listing;
  onSaved: (l: Listing) => void;
  onCancel: () => void;
}) {
  const { c } = useTheme();
  const editing = !!listing;
  const [name, setName] = useState(listing?.name ?? '');
  const [desc, setDesc] = useState(listing?.description ?? '');
  const [price, setPrice] = useState(
    listing ? (listing.priceCents / 100).toFixed(2).replace(/\.00$/, '') : '',
  );
  const [kind, setKind] = useState<ListingKind>(
    (listing?.kind === 'rental' ? 'physical' : listing?.kind) ?? 'physical',
  );
  const [image, setImage] = useState<string | null>(listing?.image ?? null);
  const [imageChanged, setImageChanged] = useState(false);
  const [stock, setStock] = useState(
    typeof listing?.stock === 'number' ? String(listing.stock) : '',
  );
  const [shipFree, setShipFree] = useState(listing?.shipFree !== false);
  const [shipFee, setShipFee] = useState(
    listing?.shipFeeCents ? (listing.shipFeeCents / 100).toFixed(2).replace(/\.00$/, '') : '',
  );
  const [category, setCategory] = useState(listing?.category ?? '');
  const [saving, setSaving] = useState(false);

  const cents = (s: string) => Math.round(Number(s.replace(/[^0-9.]/g, '')) * 100) || 0;
  const priceCents = cents(price);
  const valid = name.trim().length > 0 && priceCents > 0;

  const choosePhoto = async () => {
    const r = await pickPhoto();
    if (r.ok) { setImage(r.dataUrl); setImageChanged(true); return; }
    const m = pickPhotoMessage(r.reason);
    if (m) Alert.alert('Photo', m);
  };

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const body: ListingInput = {
      name: name.trim(),
      description: desc.trim(),
      priceCents,
      kind,
      category: category.trim() || null,
      // Blank means untracked — it never runs out — which is a real choice and
      // NOT the same as zero.
      stock: stock.trim() === '' ? null : Math.max(0, Math.round(Number(stock)) || 0),
    };
    if (kind === 'physical') {
      body.shipFree = shipFree;
      if (!shipFree) body.shipFeeCents = cents(shipFee);
    }
    // Only send the photo when it actually changed: the stored one comes back as
    // a signed URL, not the original data, so echoing it would try to save a URL
    // as an image.
    if (imageChanged) body.image = image;
    try {
      const saved = editing ? await updateListing(listing!.id, body) : await createListing(body);
      haptics.success();
      onSaved(saved);
    } catch (e) {
      haptics.error(); Alert.alert('Listing', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text variant="title" style={{ marginBottom: 16 }}>
          {editing ? 'Edit listing' : 'New listing'}
        </Text>

        {/* Photo */}
        <Pressable onPress={choosePhoto} style={[styles.photo, { backgroundColor: c.s1 }]}
          accessibilityRole="button" accessibilityLabel="Choose a photo">
          {image ? (
            <Image source={{ uri: mediaUri(image) }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <>
              <Ionicons name="camera-outline" size={26} color={c.t3} />
              <Text variant="caption" tone="t3" style={{ marginTop: 6 }}>Add a photo</Text>
            </>
          )}
        </Pressable>

        <Field label="Name" value={name} set={setName} c={c} placeholder="What is it?" />

        <Text variant="caption" tone="t3" style={styles.lbl}>What kind of thing</Text>
        <View style={styles.chips}>
          {KINDS.map((k) => (
            <Pressable
              key={k}
              onPress={() => { haptics.select(); setKind(k); }}
              style={[styles.chip, { backgroundColor: kind === k ? c.accent : c.s1 }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: kind === k }}
            >
              <Text variant="callout" weight="600"
                style={{ color: kind === k ? c.accentTint : c.text }}>
                {KIND_LABEL[k]}
              </Text>
            </Pressable>
          ))}
        </View>

        <Field label="Price" value={price} set={setPrice} c={c}
          keyboardType="decimal-pad" placeholder="0.00" />

        <Field label="Description (optional)" value={desc} set={setDesc} c={c}
          multiline placeholder="What someone buying it should know" />

        <Field label="Section (optional)" value={category} set={setCategory} c={c}
          placeholder="Starters, Prints, Consulting…" />

        {kind === 'physical' && (
          <>
            <Field label="How many you have (leave blank for unlimited)"
              value={stock} set={setStock} c={c} keyboardType="number-pad" placeholder="" />

            <Text variant="caption" tone="t3" style={styles.lbl}>Postage</Text>
            <View style={styles.chips}>
              <Pressable onPress={() => { haptics.select(); setShipFree(true); }}
                style={[styles.chip, { backgroundColor: shipFree ? c.accent : c.s1 }]}
                accessibilityRole="radio" accessibilityState={{ selected: shipFree }}>
                <Text variant="callout" weight="600"
                  style={{ color: shipFree ? c.accentTint : c.text }}>Free</Text>
              </Pressable>
              <Pressable onPress={() => { haptics.select(); setShipFree(false); }}
                style={[styles.chip, { backgroundColor: !shipFree ? c.accent : c.s1 }]}
                accessibilityRole="radio" accessibilityState={{ selected: !shipFree }}>
                <Text variant="callout" weight="600"
                  style={{ color: !shipFree ? c.accentTint : c.text }}>Buyer pays</Text>
              </Pressable>
            </View>
            {!shipFree && (
              <Field label="Postage cost" value={shipFee} set={setShipFee} c={c}
                keyboardType="decimal-pad" placeholder="0.00" />
            )}
          </>
        )}
      </ScrollView>

      <View style={[styles.foot, { borderTopColor: c.border }]}>
        <Button title={editing ? 'Save changes' : 'Put it up for sale'} kind="primary"
          loading={saving} disabled={!valid} onPress={save} />
        <Button title="Cancel" kind="secondary" onPress={onCancel} />
      </View>
    </View>
  );
}

/* `set`, not `onChange` — TextInput has its own `onChange` with a different
   signature, and spreading `...rest` over a prop of the same name is how the two
   collide. */
function Field({ label, value, set, c, ...rest }: {
  label: string;
  value: string;
  set: (t: string) => void;
  c: { s1: string; text: string; t3: string };
} & Omit<React.ComponentProps<typeof TextInput>, 'value' | 'onChangeText'>) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text variant="caption" tone="t3" style={{ marginBottom: 5 }}>{label}</Text>
      <HapticInput
        value={value}
        onChangeText={set}
        placeholderTextColor={c.t3}
        style={[
          styles.input,
          { backgroundColor: c.s1, color: c.text },
          rest.multiline ? { minHeight: 96, textAlignVertical: 'top' } : null,
        ]}
        accessibilityLabel={label}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  body: { padding: spacing.gutter, paddingBottom: 24 },
  photo: {
    height: 170, borderRadius: radius.lg, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  lbl: { marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { paddingHorizontal: 14, height: 38, borderRadius: radius.pill, justifyContent: 'center' },
  input: { borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  foot: {
    padding: spacing.gutter, paddingBottom: 26, gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
