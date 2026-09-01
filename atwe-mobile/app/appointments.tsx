import { useState } from 'react';
import {
  View, FlatList, Pressable, ActivityIndicator, RefreshControl, Alert, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromeBar, useFloatingChrome } from '@/components/Chrome';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { ServicesManager } from '@/components/ServicesManager';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { money } from '@/api/wallet';
import {
  useAppointments, setApptStatus, whenLabel, apptStatusLabel,
  type Appointment,
} from '@/api/appointments';
import { useAuth } from '@/auth/AuthProvider';
import { haptics } from '@/lib/haptics';

type Tab = 'mine' | 'incoming';

/**
 * What is booked.
 *
 * Two lists: the ones you booked with someone else, and — if you are a business
 * — the ones people booked with you. A business sees Incoming first, because
 * that is the one with work in it: requests waiting on an answer.
 */
export default function Appointments() {
  const { c } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const biz = user?.accountType === 'business';
  const [tab, setTab] = useState<Tab>(biz ? 'incoming' : 'mine');
  const [managing, setManaging] = useState(false);
  const q = useAppointments(tab);
  const appts = q.data?.appointments ?? [];
  const [busy, setBusy] = useState<number | null>(null);

  const act = async (a: Appointment, status: Parameters<typeof setApptStatus>[1], confirmText?: string) => {
    const run = async () => {
      setBusy(a.id);
      try {
        await setApptStatus(a.id, status);
        qc.invalidateQueries({ queryKey: ['appointments'] });
        qc.invalidateQueries({ queryKey: ['wallet'] });
      } catch (e) {
        haptics.error(); Alert.alert('Appointment', (e as Error).message);
      } finally {
        setBusy(null);
      }
    };
    if (!confirmText) return run();
    Alert.alert(confirmText, '', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Yes', style: status === 'declined' || status === 'cancelled' ? 'destructive' : 'default', onPress: run },
    ]);
  };

  if (managing) {
    return (
      <Screen edges={['top']}>
        <ServicesManager onDone={() => setManaging(false)} />
      </Screen>
    );
  }

  const chrome = useFloatingChrome();

  return (
    <Screen edges={[]}>
      <ChromeBar onLayout={chrome.onLayout}>
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}
            accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={26} color={c.text} />
          </Pressable>
          <Text variant="headline">Appointments</Text>
          {biz ? (
            <Pressable onPress={() => setManaging(true)} hitSlop={10} style={styles.back}
              accessibilityRole="button" accessibilityLabel="What you offer">
              <Ionicons name="options-outline" size={22} color={c.text} />
            </Pressable>
          ) : <View style={styles.back} />}
        </View>
      </ChromeBar>

      {biz && (
        <View style={styles.tabs}>
          {(['incoming', 'mine'] as Tab[]).map((t) => (
            <Pressable key={t} onPress={() => { haptics.select(); setTab(t); }} hitSlop={8}
              accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
              <Text variant="headline" style={{ color: tab === t ? c.text : c.t3 }}>
                {t === 'incoming' ? 'With you' : 'You booked'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {q.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={appts}
          keyExtractor={(a) => String(a.id)}
          contentContainerStyle={[appts.length ? styles.body : styles.emptyWrap, chrome.pad]}
          refreshControl={
            <RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={c.t3} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="calendar-outline" size={44} color={c.t4} />
              <Text variant="title" tone="t2" style={{ marginTop: 12 }}>
                {tab === 'incoming' ? 'Nothing booked with you yet' : 'Nothing booked'}
              </Text>
              <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
                {tab === 'incoming'
                  ? 'Set out what you offer and your opening hours, and people can book you.'
                  : 'Find a business and tap Book on their profile.'}
              </Text>
              {tab === 'incoming' && (
                <View style={{ marginTop: 20, alignSelf: 'stretch' }}>
                  <Button title="What you offer" kind="primary" onPress={() => setManaging(true)} />
                </View>
              )}
            </View>
          }
          renderItem={({ item: a }) => {
            const them = tab === 'incoming' ? a.customer : a.business;
            const iAmBusiness = tab === 'incoming';
            const past = new Date(a.whenAt).getTime() < Date.now();
            return (
              <View style={[styles.card, { backgroundColor: c.s1 }]}>
                <Pressable style={styles.who}
                  onPress={() => them.username && router.push(`/user/${them.username}`)}>
                  <Avatar name={them.name} avatar={them.avatar}
                    biz={!iAmBusiness} size={34} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text variant="headline" numberOfLines={1}>{them.name}</Text>
                    <Text variant="caption" tone="t3">{a.service}</Text>
                  </View>
                </Pressable>

                <Text variant="title" style={{ marginTop: 10 }}>{whenLabel(a.whenAt)}</Text>
                <Text variant="caption"
                  tone={a.status === 'declined' || a.status === 'cancelled' ? 'danger'
                    : a.status === 'confirmed' ? 'success' : 't3'}
                  style={{ marginTop: 2 }}>
                  {apptStatusLabel(a, iAmBusiness)}
                  {a.depositCents > 0 && a.depositStatus === 'held'
                    ? ` · ${money(a.depositCents)} deposit held` : ''}
                </Text>
                {!!a.note && (
                  <Text variant="body" tone="t2" style={{ marginTop: 6 }}>“{a.note}”</Text>
                )}

                <View style={styles.actions}>
                  {iAmBusiness && a.status === 'requested' && (
                    <>
                      <Button title="Confirm" kind="primary" loading={busy === a.id}
                        onPress={() => act(a, 'confirmed')} style={styles.act} />
                      <Button title="Decline" kind="secondary"
                        onPress={() => act(a, 'declined', 'Decline this booking?')} style={styles.act} />
                    </>
                  )}
                  {iAmBusiness && a.status === 'confirmed' && (
                    <Button
                      title={a.depositCents > 0 ? 'Done · release deposit' : 'Mark as done'}
                      kind={past ? 'primary' : 'secondary'} loading={busy === a.id}
                      onPress={() => act(a, 'completed')} style={styles.act} />
                  )}
                  {['requested', 'confirmed'].includes(a.status) && (
                    <Button title="Cancel" kind="secondary"
                      onPress={() => act(a, 'cancelled', 'Cancel this appointment?')} style={styles.act} />
                  )}
                  <Button title="Message" kind="secondary"
                    onPress={() => router.push(`/chat/${them.id}`)} style={styles.act} />
                </View>
              </View>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 8,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', gap: 22, paddingHorizontal: spacing.gutter, paddingBottom: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
  body: { padding: spacing.gutter, paddingBottom: 40, gap: 12 },
  card: { borderRadius: radius.card, padding: 14 },
  who: { flexDirection: 'row', alignItems: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  act: { flexGrow: 1, flexBasis: '45%' },
});
