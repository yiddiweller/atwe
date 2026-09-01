import { useState } from 'react';
import {
  View, ScrollView, Pressable, ActivityIndicator, Alert, RefreshControl, StyleSheet,
} from 'react-native';
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
import {
  useApplicants, setApplicantStatus, APPLICANT_STATUSES, STATUS_LABEL,
  type Applicant, type ApplicantStatus,
} from '@/api/jobs';
import { timeAgo } from '@/lib/format';
import { haptics } from '@/lib/haptics';

/**
 * The hiring pipeline for one role — `GET /api/jobs/:id/applicants`, which the
 * server gates to the poster (or somebody on their team with the `jobs`
 * permission), so there is nothing to hide client-side.
 *
 * A person is a card, not a row: the note they wrote and their answers to the
 * screening questions are the whole reason to open this screen, and burying
 * them behind a tap would mean opening every single one.
 */
export default function Applicants() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const router = useRouter();
  const q = useApplicants(id, true);
  const [filter, setFilter] = useState<ApplicantStatus | 'all' | 'meets'>('all');

  const all = q.data?.applicants ?? [];
  const asksRequired = (q.data?.screening ?? []).some((s) => s.required);
  const list = all.filter((a) =>
    filter === 'all' ? true
    : filter === 'meets' ? a.meets === true
    : a.status === filter);

  /* Only offer a filter that would actually find somebody — a row of empty
     shelves makes a small pipeline look broken. */
  const shelves: { key: typeof filter; label: string }[] = [
    { key: 'all', label: `All (${all.length})` },
    ...(asksRequired && all.some((a) => a.meets) ? [{ key: 'meets' as const, label: 'Meets requirements' }] : []),
    ...APPLICANT_STATUSES
      .filter((s) => all.some((a) => a.status === s))
      .map((s) => ({ key: s as typeof filter, label: STATUS_LABEL[s] })),
  ];

  const move = async (a: Applicant, status: ApplicantStatus) => {
    try {
      await setApplicantStatus(Number(id), a.id, status);
      haptics.success();
      await q.refetch();
    } catch (e) {
      haptics.error();
      Alert.alert('Applicants', (e as Error).message);
    }
  };

  const chrome = useFloatingChrome();

  return (
    <Screen edges={[]}>
      <ChromeBar onLayout={chrome.onLayout}>
        <View style={styles.head}>
          <ChromeButton onPress={() => router.back()} label="Back">
            <Ionicons name="chevron-back" size={22} color={c.text} />
          </ChromeButton>
          <Text variant="headline" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
            {q.data?.title ?? 'Applicants'}
          </Text>
          <View style={styles.icon} />
        </View>
      </ChromeBar>

      {q.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : q.isError ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">Couldn't load the applicants.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => q.refetch()} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[all.length ? { paddingBottom: 60 } : styles.emptyWrap, chrome.pad]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={c.t3} />
          }
        >
          {all.length === 0 ? (
            <View style={styles.center}>
              <Text variant="title" tone="t2">Nobody yet</Text>
              <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
                Applications land here the moment somebody applies.
              </Text>
            </View>
          ) : (
            <>
              {shelves.length > 1 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {shelves.map((s) => {
                    const on = filter === s.key;
                    return (
                      <Pressable
                        key={String(s.key)}
                        onPress={() => { haptics.select(); setFilter(s.key); }}
                        style={[styles.chip, { backgroundColor: on ? c.primary : c.s2 }]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={s.label}
                      >
                        <Text variant="callout" style={{ color: on ? c.onPrimary : c.t2 }}>
                          {s.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
              {list.map((a) => (
                <ApplicantCard key={a.id} a={a} onMove={(s) => move(a, s)} />
              ))}
              {list.length === 0 && (
                <View style={{ padding: 40 }}>
                  <Text variant="body" tone="t3" style={{ textAlign: 'center' }}>
                    Nobody in this stage.
                  </Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

function ApplicantCard({ a, onMove }: { a: Applicant; onMove: (s: ApplicantStatus) => void }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const tone =
    a.status === 'hired' ? c.success
    : a.status === 'rejected' ? c.danger
    : a.status === 'shortlisted' ? c.accent
    : c.t2;

  const go = (s: ApplicantStatus) => async () => {
    setBusy(true);
    try { await onMove(s); } finally { setBusy(false); }
  };

  return (
    <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.card }]}>
      <Pressable
        style={styles.who}
        onPress={() => a.username && router.push(`/user/${a.username}`)}
        accessibilityRole="button"
        accessibilityLabel={`View ${a.name}`}
      >
        <Avatar name={a.name} avatar={a.avatar} biz={a.accountType === 'business'} size={44} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <View style={styles.nameLine}>
            <Text variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>{a.name}</Text>
            {a.verified && <VerifiedBadge size={14} />}
          </View>
          {!!a.headline && (
            <Text variant="caption" tone="t2" numberOfLines={1}>{a.headline}</Text>
          )}
          <Text variant="micro" tone="t4">Applied {timeAgo(a.applied_at)}</Text>
        </View>
        <View style={[styles.status, { backgroundColor: c.s2 }]}>
          <Text variant="micro" style={{ color: tone }}>{STATUS_LABEL[a.status]}</Text>
        </View>
      </Pressable>

      {/* Did they clear the knockouts — the one thing worth saying loudly. */}
      {a.meets != null && (
        <View style={styles.meets}>
          <Ionicons
            name={a.meets ? 'checkmark-circle' : 'close-circle'}
            size={16}
            color={a.meets ? c.success : c.danger}
          />
          <Text variant="caption" style={{ color: a.meets ? c.success : c.danger }}>
            {a.meets ? 'Meets the requirements' : 'Missing a requirement'}
          </Text>
        </View>
      )}

      {!!a.note && (
        <Text variant="callout" tone="t2" style={{ marginTop: 10, lineHeight: 20 }}>
          {a.note}
        </Text>
      )}

      {a.answers.length > 0 && (
        <View style={{ marginTop: 12, gap: 8 }}>
          {a.answers.map((ans) => (
            <View key={ans.id}>
              <Text variant="micro" tone="t3">{ans.text}</Text>
              <Text variant="callout">{ans.value ?? '—'}</Text>
            </View>
          ))}
        </View>
      )}

      {!!a.resumeTitle && (
        <View style={[styles.resume, { backgroundColor: c.s2 }]}>
          <Ionicons name="document-text-outline" size={15} color={c.t2} />
          <Text variant="caption" tone="t2" numberOfLines={1}>{a.resumeTitle}</Text>
        </View>
      )}

      {/* Move them along. The stage they are already in is not offered. */}
      <View style={styles.moves}>
        {(['shortlisted', 'hired', 'rejected'] as ApplicantStatus[])
          .filter((s) => s !== a.status)
          .map((s) => (
            <Pressable
              key={s}
              onPress={go(s)}
              disabled={busy}
              style={[styles.move, { backgroundColor: c.s2, opacity: busy ? 0.5 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={STATUS_LABEL[s]}
            >
              <Text variant="caption" style={{
                color: s === 'hired' ? c.success : s === 'rejected' ? c.danger : c.accent,
              }}>
                {STATUS_LABEL[s]}
              </Text>
            </Pressable>
          ))}
        <Pressable
          onPress={() => { haptics.tap(); router.push(`/chat/${a.id}`); }}
          style={[styles.move, { backgroundColor: c.s2 }]}
          accessibilityRole="button"
          accessibilityLabel={`Message ${a.name}`}
        >
          <Text variant="caption" tone="t2">Message</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8, gap: 4 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
  chipRow: { paddingHorizontal: spacing.gutter, gap: 8, paddingBottom: 12 },
  chip: { paddingHorizontal: spacing.gutter, paddingVertical: 8, borderRadius: 999 },
  card: { marginHorizontal: spacing.gutter, marginBottom: 14, padding: 14 },
  who: { flexDirection: 'row', alignItems: 'center' },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  status: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, marginLeft: 8 },
  meets: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  resume: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12,
    alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
  },
  moves: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  move: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
});
