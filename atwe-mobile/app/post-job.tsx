import { useState } from 'react';
import {
  View, ScrollView, Pressable, Alert, KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromeBar, useFloatingChrome } from '@/components/Chrome';
import { Button } from '@/components/Button';
import { HapticInput } from '@/components/HapticInput';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { postJob, JOB_TYPES, type SalaryPeriod } from '@/api/jobs';
import { haptics } from '@/lib/haptics';
import { useAuth } from '@/auth/AuthProvider';

const PERIODS: { key: SalaryPeriod; label: string }[] = [
  { key: 'hour', label: 'per hour' },
  { key: 'day', label: 'per day' },
  { key: 'week', label: 'per week' },
  { key: 'month', label: 'per month' },
  { key: 'year', label: 'per year' },
];

/**
 * Posting a role.
 *
 * Only the title is required, which matches the server — a small business
 * posting "Saturday help wanted" should not be made to fill in eight fields
 * first. Pay is optional too, but stated pay is the single biggest thing that
 * gets a role applied to, so it is asked for plainly rather than hidden.
 *
 * A free business account can keep three live postings; the server answers 402
 * past that, and the message it sends is the one shown, so the cap can change
 * on the server without this screen going stale.
 */
export default function PostJob() {
  const { c } = useTheme();
  const router = useRouter();
  const { user } = useAuth();

  const [title, setTitle] = useState('');
  const [company, setCompany] = useState(
    user?.accountType === 'business' ? (user?.name ?? '') : '',
  );
  const [location, setLocation] = useState('');
  const [type, setType] = useState<string | null>(null);
  const [remote, setRemote] = useState(false);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [period, setPeriod] = useState<SalaryPeriod>('year');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const num = (s: string): number | null => {
    const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };

  const submit = async () => {
    if (!title.trim()) {
      haptics.warning();
      Alert.alert('Post a job', 'A job title is required.');
      return;
    }
    setBusy(true);
    try {
      const r = await postJob({
        title: title.trim(),
        company: company.trim() || undefined,
        location: location.trim() || undefined,
        type: type ?? undefined,
        remote,
        description: description.trim() || undefined,
        salaryMin: num(min),
        salaryMax: num(max),
        salaryPeriod: (num(min) != null || num(max) != null) ? period : null,
      });
      haptics.success();
      router.replace(`/job/${r.id}`);
    } catch (e) {
      haptics.error();
      Alert.alert('Post a job', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chrome = useFloatingChrome();

  return (
    <Screen edges={[]}>
      <ChromeBar onLayout={chrome.onLayout}>
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.icon} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={26} color={c.text} />
          </Pressable>
          <Text variant="headline">Post a job</Text>
          <View style={styles.icon} />
        </View>
      </ChromeBar>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <ScrollView
          contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 60 }, chrome.pad]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Field label="Job title" required>
            <HapticInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Shop assistant — weekends"
              placeholderTextColor={c.t3}
              style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
              accessibilityLabel="Job title"
            />
          </Field>

          <Field label="Company">
            <HapticInput
              value={company}
              onChangeText={setCompany}
              placeholder="Who is hiring"
              placeholderTextColor={c.t3}
              style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
              accessibilityLabel="Company"
            />
          </Field>

          <Field label="Where">
            <HapticInput
              value={location}
              onChangeText={setLocation}
              placeholder="City, or leave blank"
              placeholderTextColor={c.t3}
              style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
              accessibilityLabel="Location"
            />
            <Pressable
              onPress={() => { haptics.select(); setRemote((r) => !r); }}
              style={[styles.toggle, { backgroundColor: remote ? c.accent : c.s1 }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: remote }}
              accessibilityLabel="Remote"
            >
              <Ionicons name="globe-outline" size={16} color={remote ? c.accentTint : c.t2} />
              <Text variant="callout" style={{ color: remote ? c.accentTint : c.t2 }}>
                This role is remote
              </Text>
            </Pressable>
          </Field>

          <Field label="Type">
            <View style={styles.chips}>
              {JOB_TYPES.map((t) => {
                const on = type === t;
                return (
                  <Pressable
                    key={t}
                    onPress={() => { haptics.select(); setType(on ? null : t); }}
                    style={[styles.chip, { backgroundColor: on ? c.accent : c.s1 }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={t}
                  >
                    <Text variant="callout" weight="600"
                      style={{ color: on ? c.accentTint : c.text }}>{t}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>

          <Field label="Pay">
            <View style={styles.payRow}>
              <HapticInput
                value={min}
                onChangeText={setMin}
                keyboardType="number-pad"
                placeholder="From"
                placeholderTextColor={c.t3}
                style={[styles.input, styles.payBox, { backgroundColor: c.s1, color: c.text }]}
                accessibilityLabel="Pay from"
              />
              <HapticInput
                value={max}
                onChangeText={setMax}
                keyboardType="number-pad"
                placeholder="To"
                placeholderTextColor={c.t3}
                style={[styles.input, styles.payBox, { backgroundColor: c.s1, color: c.text }]}
                accessibilityLabel="Pay to"
              />
            </View>
            <View style={[styles.chips, { marginTop: 8 }]}>
              {PERIODS.map((p) => {
                const on = period === p.key;
                return (
                  <Pressable
                    key={p.key}
                    onPress={() => { haptics.select(); setPeriod(p.key); }}
                    style={[styles.chip, { backgroundColor: on ? c.accent : c.s1 }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={p.label}
                  >
                    <Text variant="callout" style={{ color: on ? c.accentTint : c.t2 }}>
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text variant="micro" tone="t4" style={{ marginTop: 8 }}>
              Whole amounts, no symbols. Roles that state the pay get far more
              applicants — but you can leave it blank.
            </Text>
          </Field>

          <Field label="About the role">
            <HapticInput
              value={description}
              onChangeText={setDescription}
              multiline
              placeholder="What the work is, what a day looks like, and what you are looking for."
              placeholderTextColor={c.t3}
              style={[styles.input, styles.textarea, { backgroundColor: c.s1, color: c.text }]}
              accessibilityLabel="About the role"
            />
          </Field>

          <View style={{ height: 10 }} />
          <Button title="Post the job" kind="primary" loading={busy} onPress={submit} />
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
  input: { borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  textarea: { minHeight: 140, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, height: 38, borderRadius: radius.pill, justifyContent: 'center' },
  toggle: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
    paddingHorizontal: 14, height: 44, borderRadius: radius.pill,
  },
  payRow: { flexDirection: 'row', gap: 10 },
  payBox: { flex: 1 },
});
