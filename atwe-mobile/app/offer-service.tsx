import { useState } from 'react';
import {
  View, ScrollView, Alert, KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { GlassChip } from '@/components/GlassChip';
import { Screen } from '@/components/Screen';
import { ChromeButton, ChromeBar, useFloatingChrome } from '@/components/Chrome';
import { Button } from '@/components/Button';
import { HapticInput } from '@/components/HapticInput';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { offerService, SERVICE_CATEGORIES } from '@/api/services';
import { haptics } from '@/lib/haptics';

/** Putting up what you do. Only a title is required, same as the server. */
export default function OfferService() {
  const { c } = useTheme();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [area, setArea] = useState('');
  const [rate, setRate] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      haptics.warning();
      Alert.alert('Offer a service', 'What do you do? Give it a title.');
      return;
    }
    setBusy(true);
    try {
      const r = await offerService({
        title: title.trim(),
        category: category ?? undefined,
        area: area.trim() || undefined,
        rate: rate.trim() || undefined,
        description: description.trim() || undefined,
      });
      haptics.success();
      router.replace(`/service/${r.service.id}`);
    } catch (e) {
      haptics.error();
      Alert.alert('Offer a service', (e as Error).message);
    } finally { setBusy(false); }
  };

  const chrome = useFloatingChrome();

  return (
    <Screen edges={[]}>
      <ChromeBar onLayout={chrome.onLayout}>
        <View style={styles.head}>
          <ChromeButton onPress={() => router.back()} label="Back">
            <Ionicons name="chevron-back" size={22} color={c.text} />
          </ChromeButton>
          <Text variant="headline">Offer a service</Text>
          <View style={styles.icon} />
        </View>
      </ChromeBar>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 60 }, chrome.pad]}
          keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Field label="What do you do?" required>
            <HapticInput
              value={title} onChangeText={setTitle}
              placeholder="e.g. Emergency plumbing, 24 hours"
              placeholderTextColor={c.t3}
              style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
              accessibilityLabel="What do you do"
            />
          </Field>

          <Field label="Category">
            <View style={styles.chips}>
              {SERVICE_CATEGORIES.map((k) => {
                const on = category === k;
                return (
                  <GlassChip key={k} label={k} on={on} fill={c.accent} ink={c.accentTint}
                    onPress={() => setCategory(on ? null : k)} />
                );
              })}
            </View>
          </Field>

          <Field label="Where you work">
            <HapticInput
              value={area} onChangeText={setArea}
              placeholder="e.g. Brooklyn and Queens"
              placeholderTextColor={c.t3}
              style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
              accessibilityLabel="Where you work"
            />
          </Field>

          <Field label="What you charge">
            <HapticInput
              value={rate} onChangeText={setRate}
              placeholder="e.g. From $90 a visit"
              placeholderTextColor={c.t3}
              style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
              accessibilityLabel="What you charge"
            />
            <Text variant="micro" tone="t4" style={{ marginTop: 8 }}>
              Free text, so you can say "from", "per hour", or "ask me".
            </Text>
          </Field>

          <Field label="About it">
            <HapticInput
              value={description} onChangeText={setDescription}
              multiline
              placeholder="What you cover, how long you've done it, what makes you worth calling."
              placeholderTextColor={c.t3}
              style={[styles.input, styles.textarea, { backgroundColor: c.s1, color: c.text }]}
              accessibilityLabel="About the service"
            />
          </Field>

          <View style={{ height: 10 }} />
          <Button title="Put it up" kind="primary" loading={busy} onPress={submit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Field({ label, required, children }: {
  label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text variant="callout" tone="t2" style={{ marginBottom: 8 }}>
        {label}{required ? ' *' : ''}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 8,
  },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  input: { borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16 },
  textarea: { minHeight: 120, textAlignVertical: 'top', borderRadius: radius.bubble },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
