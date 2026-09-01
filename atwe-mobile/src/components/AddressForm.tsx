import { useState } from 'react';
import { View, TextInput, ScrollView, Alert, StyleSheet } from 'react-native';
import { Text } from './Text';
import { Button } from './Button';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { addAddress, type Address } from '@/api/checkout';

/**
 * A new delivery address.
 *
 * Only NAME, STREET and CITY are required, and that is the server's rule rather
 * than a shortcut: much of the world has no postcode and no state, and insisting
 * on them would lock those buyers out of the shop entirely. Everything else is
 * offered and optional.
 */
export function AddressForm({ onSaved, onCancel }: {
  onSaved: (a: Address) => void;
  onCancel: () => void;
}) {
  const { c } = useTheme();
  const [v, setV] = useState({
    fullName: '', line1: '', line2: '', city: '',
    region: '', postal: '', country: 'US', phone: '', instructions: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v) => (t: string) => setV((s) => ({ ...s, [k]: t }));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      onSaved(await addAddress({ ...v, isDefault: true }));
    } catch (e) {
      Alert.alert('Address', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const Field = ({ label, k, ...rest }: {
    label: string; k: keyof typeof v;
  } & React.ComponentProps<typeof TextInput>) => (
    <View style={{ marginBottom: 12 }}>
      <Text variant="caption" tone="t3" style={{ marginBottom: 5 }}>{label}</Text>
      <TextInput
        value={v[k]}
        onChangeText={set(k)}
        style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
        placeholderTextColor={c.t3}
        accessibilityLabel={label}
        {...rest}
      />
    </View>
  );

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text variant="title" style={{ marginBottom: 14 }}>Delivery address</Text>
        <Field label="Full name" k="fullName" autoComplete="name" textContentType="name" />
        <Field label="Street address" k="line1" autoComplete="street-address" />
        <Field label="Flat, unit (optional)" k="line2" />
        <Field label="City" k="city" />
        <Field label="State / region (optional)" k="region" />
        <Field label="Postcode (optional)" k="postal" autoComplete="postal-code" />
        <Field label="Country" k="country" autoCapitalize="characters" maxLength={60} />
        <Field label="Phone (optional)" k="phone" keyboardType="phone-pad" />
        <Field label="Delivery notes (optional)" k="instructions"
          placeholder="Gate code, leave with the doorman…" />
      </ScrollView>
      <View style={[styles.foot, { borderTopColor: c.border }]}>
        <Button title="Save address" kind="primary" loading={saving}
          disabled={!v.fullName.trim() || !v.line1.trim() || !v.city.trim()}
          onPress={save} />
        <Button title="Cancel" kind="secondary" onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  body: { padding: spacing.gutter, paddingBottom: 24 },
  input: {
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  foot: {
    padding: spacing.gutter, paddingBottom: 26, gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
