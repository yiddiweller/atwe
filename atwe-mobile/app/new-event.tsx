import { useState } from 'react';
import {
  View, ScrollView, Pressable, Alert, KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromeButton, ChromeBar, useFloatingChrome } from '@/components/Chrome';
import { Button } from '@/components/Button';
import { HapticInput } from '@/components/HapticInput';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { createEvent } from '@/api/events';
import { haptics } from '@/lib/haptics';

/**
 * Hosting an event.
 *
 * Only a title and a start time are required, matching the server — a shop
 * putting up "Late-night opening, Thursday" should not be made to fill in eight
 * fields. Date and time are two plain inputs rather than a wheel picker: a
 * native picker is a whole dependency and a lot of screen, and typing a date is
 * quicker than spinning to it.
 */
export default function NewEvent() {
  const { c } = useTheme();
  const router = useRouter();

  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const [date, setDate] = useState(
    `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate() + 1 > 28 ? 28 : today.getDate() + 1)}`,
  );
  const [time, setTime] = useState('19:00');
  const [title, setTitle] = useState('');
  const [online, setOnline] = useState(false);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [capacity, setCapacity] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      haptics.warning();
      Alert.alert('Host an event', 'Give it a title.');
      return;
    }
    /* Built as LOCAL time on purpose — somebody typing 19:00 means seven in their
       own evening, and `new Date('2026-10-04T19:00')` (no Z) is exactly that. */
    const startsAt = new Date(`${date}T${time}`);
    if (isNaN(startsAt.getTime())) {
      haptics.warning();
      Alert.alert('Host an event', 'That date or time doesn’t look right. Use 2026-10-04 and 19:00.');
      return;
    }
    setBusy(true);
    try {
      const cents = Math.round(parseFloat(price.replace(/[^0-9.]/g, '')) * 100);
      const cap = parseInt(capacity.replace(/[^0-9]/g, ''), 10);
      const r = await createEvent({
        title: title.trim(),
        startsAt: startsAt.toISOString(),
        online,
        location: location.trim() || undefined,
        description: description.trim() || undefined,
        priceCents: Number.isFinite(cents) && cents > 0 ? cents : 0,
        capacity: Number.isFinite(cap) && cap > 0 ? cap : null,
      });
      haptics.success();
      router.replace(`/event/${r.event.id}`);
    } catch (e) {
      haptics.error();
      Alert.alert('Host an event', (e as Error).message);
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
          <Text variant="headline">Host an event</Text>
          <View style={styles.icon} />
        </View>
      </ChromeBar>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 60 }, chrome.pad]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Field label="What is it?" required>
            <HapticInput
              value={title} onChangeText={setTitle}
              placeholder="e.g. Late-night opening"
              placeholderTextColor={c.t3}
              style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
              accessibilityLabel="Event title"
            />
          </Field>

          <Field label="When" required>
            <View style={styles.row}>
              <HapticInput
                value={date} onChangeText={setDate}
                placeholder="2026-10-04"
                placeholderTextColor={c.t3}
                autoCapitalize="none" autoCorrect={false}
                style={[styles.input, { flex: 1.4, backgroundColor: c.s1, color: c.text }]}
                accessibilityLabel="Date"
              />
              <HapticInput
                value={time} onChangeText={setTime}
                placeholder="19:00"
                placeholderTextColor={c.t3}
                autoCapitalize="none" autoCorrect={false}
                style={[styles.input, { flex: 1, backgroundColor: c.s1, color: c.text }]}
                accessibilityLabel="Time"
              />
            </View>
          </Field>

          <Field label="Where">
            <Pressable
              onPress={() => { haptics.select(); setOnline((v) => !v); }}
              style={[styles.toggle, { backgroundColor: online ? c.accent : c.s1 }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: online }}
              accessibilityLabel="This one is online"
            >
              <Ionicons name="videocam-outline" size={16} color={online ? c.accentTint : c.t2} />
              <Text variant="callout" style={{ color: online ? c.accentTint : c.t2 }}>
                This one is online
              </Text>
            </Pressable>
            <HapticInput
              value={location} onChangeText={setLocation}
              placeholder={online ? 'The join link' : 'The address'}
              placeholderTextColor={c.t3}
              style={[styles.input, { marginTop: 10, backgroundColor: c.s1, color: c.text }]}
              accessibilityLabel={online ? 'Join link' : 'Address'}
            />
          </Field>

          <Field label="Tickets">
            <View style={styles.row}>
              <HapticInput
                value={price} onChangeText={setPrice}
                keyboardType="decimal-pad"
                placeholder="Free"
                placeholderTextColor={c.t3}
                style={[styles.input, { flex: 1, backgroundColor: c.s1, color: c.text }]}
                accessibilityLabel="Ticket price"
              />
              <HapticInput
                value={capacity} onChangeText={setCapacity}
                keyboardType="number-pad"
                placeholder="No limit"
                placeholderTextColor={c.t3}
                style={[styles.input, { flex: 1, backgroundColor: c.s1, color: c.text }]}
                accessibilityLabel="How many people"
              />
            </View>
            <Text variant="micro" tone="t4" style={{ marginTop: 8 }}>
              Leave the price blank for a free event, and the number blank for no
              limit on how many can come.
            </Text>
          </Field>

          <Field label="About it">
            <HapticInput
              value={description} onChangeText={setDescription}
              multiline
              placeholder="What happens, who it’s for, anything to bring."
              placeholderTextColor={c.t3}
              style={[styles.input, styles.textarea, { backgroundColor: c.s1, color: c.text }]}
              accessibilityLabel="About the event"
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
  row: { flexDirection: 'row', gap: 10 },
  toggle: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    paddingHorizontal: 14, height: 44, borderRadius: radius.pill,
  },
});
