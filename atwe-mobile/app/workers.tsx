import { useEffect, useState } from 'react';
import {
  View, FlatList, ScrollView, Pressable, ActivityIndicator, Alert,
  RefreshControl, KeyboardAvoidingView, Platform, Modal, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromeBar, useFloatingChrome } from '@/components/Chrome';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { HapticInput } from '@/components/HapticInput';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import {
  useWorkers, useMyWorkerListing, postWorkerListing, removeWorkerListing,
  useOpenToWork, setOpenToWork, rateLabel, OTW_LABEL,
  type WorkerListing, type SalaryPeriod, type OtwVisibility,
} from '@/api/jobs';
import { haptics } from '@/lib/haptics';
import { useAuth } from '@/auth/AuthProvider';

/**
 * The other side of the jobs marketplace — people who are open to work.
 *
 * An employer browses; anybody can put themselves on it. Your own listing sits
 * at the top as a card you edit rather than a row you scroll past, because the
 * whole point of coming here as a worker is to change it.
 */
export default function Workers() {
  const { c } = useTheme();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [remote, setRemote] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const mine = useMyWorkerListing();
  const otw = useOpenToWork();
  const { data, isLoading, isError, refetch, isRefetching } = useWorkers(dq, remote);
  /* Your own listing is the card at the top of this screen, so it must not also
     appear as a row in the list underneath it — the server has no reason to
     exclude you (an employer browsing wants everyone), so the screen does. */
  const { user } = useAuth();
  const workers = (data?.workers ?? []).filter((w) => w.userId !== user?.id);

  const chrome = useFloatingChrome();

  return (
    <Screen edges={[]}>
      <ChromeBar onLayout={chrome.onLayout}>
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.icon} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={26} color={c.text} />
          </Pressable>
          <Text variant="headline">Open to work</Text>
          <View style={styles.icon} />
        </View>

        <View style={{ paddingHorizontal: spacing.gutter }}>
          <View style={[styles.search, { backgroundColor: c.s2 }]}>
            <Ionicons name="search" size={18} color={c.t3} />
            <HapticInput
              value={q}
              onChangeText={setQ}
              placeholder="A trade, a skill, a role"
              placeholderTextColor={c.t3}
              style={[styles.searchInput, { color: c.text }]}
              returnKeyType="search"
              autoCorrect={false}
              accessibilityLabel="Search people open to work"
            />
            {q.length > 0 && (
              <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear">
                <Ionicons name="close-circle" size={18} color={c.t3} />
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={() => { haptics.select(); setRemote((r) => !r); }}
            style={[styles.toggle, { backgroundColor: remote ? c.accent : c.s2 }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: remote }}
            accessibilityLabel="Remote only"
          >
            <Ionicons name="globe-outline" size={15} color={remote ? c.accentTint : c.t2} />
            <Text variant="callout" style={{ color: remote ? c.accentTint : c.t2 }}>Remote only</Text>
          </Pressable>
        </View>
      </ChromeBar>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">Couldn't load this.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <FlatList
          data={workers}
          keyExtractor={(w) => String(w.userId)}
          renderItem={({ item }) => <WorkerCard w={item} />}
          contentContainerStyle={[{ paddingTop: 12, paddingBottom: 120 }, chrome.pad]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.t3} />}
          ListHeaderComponent={
            <MyListing
              listing={mine.data?.listing ?? null}
              visibility={otw.data?.visibility ?? 'off'}
              onEdit={() => setEditing(true)}
              onVisibility={async (v) => { await setOpenToWork(v); await otw.refetch(); await refetch(); }}
              onRemoved={() => { mine.refetch(); otw.refetch(); refetch(); }}
            />
          }
          ListEmptyComponent={
            <View style={{ padding: 40 }}>
              <Text variant="body" tone="t3" style={{ textAlign: 'center' }}>
                {dq ? `Nobody matches “${dq}”.` : 'Nobody has listed themselves yet.'}
              </Text>
            </View>
          }
        />
      )}

      <ListingEditor
        visible={editing}
        current={mine.data?.listing ?? null}
        onClose={() => setEditing(false)}
        onSaved={async () => {
          setEditing(false);
          await mine.refetch(); await otw.refetch(); await refetch();
        }}
      />
    </Screen>
  );
}

/** Your own listing: the thing you came here to change, so it leads. */
const VIS: { key: OtwVisibility; label: string }[] = [
  { key: 'everyone', label: 'Everyone' },
  { key: 'recruiters', label: 'Businesses only' },
  { key: 'off', label: 'Hidden' },
];

function MyListing({ listing, visibility, onEdit, onVisibility, onRemoved }: {
  listing: WorkerListing | null;
  visibility: OtwVisibility;
  onEdit: () => void;
  onVisibility: (v: OtwVisibility) => Promise<void>;
  onRemoved: () => void;
}) {
  const { c, radius } = useTheme();
  const rate = listing ? rateLabel(listing) : null;

  const takeDown = () => {
    Alert.alert('Go off the market', 'Your listing is removed. You can put it back any time.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          haptics.warning();
          try { await removeWorkerListing(); onRemoved(); }
          catch (e) { haptics.error(); Alert.alert('Open to work', (e as Error).message); }
        },
      },
    ]);
  };

  if (!listing) {
    return (
      <View style={[styles.mine, { backgroundColor: c.s1, borderRadius: radius.card }]}>
        <Text variant="headline">Looking for work?</Text>
        <Text variant="callout" tone="t2" style={{ marginTop: 4, lineHeight: 20 }}>
          Put up what you do and employers can find you — no applications needed.
        </Text>
        <View style={{ height: 14 }} />
        <Button title="List yourself" kind="primary" onPress={onEdit} />
      </View>
    );
  }

  return (
    <View style={[styles.mine, { backgroundColor: c.s1, borderRadius: radius.card }]}>
      <View style={styles.mineTop}>
        <View style={[styles.live, {
          backgroundColor: visibility === 'off' ? c.warning : c.success,
        }]} />
        <Text variant="micro" tone="t3">
          {visibility === 'off' ? 'Listed, but nobody can see it' : `Visible to ${OTW_LABEL[visibility].toLowerCase()}`}
        </Text>
      </View>
      <Text variant="headline" style={{ marginTop: 6 }}>{listing.role}</Text>
      {!!rate && <Text variant="callout" tone="t2" style={{ marginTop: 2 }}>{rate}</Text>}
      {!!listing.location && (
        <Text variant="caption" tone="t3" style={{ marginTop: 2 }}>
          {listing.location}{listing.remote ? ' · Remote' : ''}
        </Text>
      )}
      <Text variant="micro" tone="t3" style={{ marginTop: 16, marginBottom: 8 }}>
        Who can find you
      </Text>
      <View style={styles.chips}>
        {VIS.map((v) => {
          const on = visibility === v.key;
          return (
            <Pressable
              key={v.key}
              onPress={() => { haptics.select(); void onVisibility(v.key); }}
              style={[styles.chip, { backgroundColor: on ? c.accent : c.s2 }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={v.label}
            >
              <Text variant="callout" style={{ color: on ? c.accentTint : c.t2 }}>{v.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
        <Button title="Edit" kind="secondary" onPress={onEdit} style={{ flex: 1 }} />
        <Button title="Remove" kind="danger" onPress={takeDown} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function WorkerCard({ w }: { w: WorkerListing }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const rate = rateLabel(w);
  return (
    <Pressable
      onPress={() => w.user.username && router.push(`/user/${w.user.username}`)}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: c.s1, borderRadius: radius.card },
        pressed && { opacity: 0.9 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${w.user.name}, ${w.role ?? 'open to work'}`}
    >
      <View style={styles.who}>
        <Avatar name={w.user.name} avatar={w.user.avatar} biz={w.user.accountType === 'business'} size={44} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <View style={styles.nameLine}>
            <Text variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>{w.user.name}</Text>
            {w.user.verified && <VerifiedBadge size={14} />}
          </View>
          {!!w.role && <Text variant="callout" tone="t2" numberOfLines={1}>{w.role}</Text>}
        </View>
        {!!rate && <Text variant="callout" weight="700">{rate}</Text>}
      </View>

      {(!!w.location || w.remote || !!w.schedule) && (
        <View style={styles.factRow}>
          {!!w.location && <Fact icon="location-outline" text={w.location} />}
          {w.remote && <Fact icon="globe-outline" text="Remote" />}
          {!!w.schedule && <Fact icon="time-outline" text={w.schedule} />}
        </View>
      )}
      {!!w.about && (
        <Text variant="callout" tone="t2" numberOfLines={3} style={{ marginTop: 8, lineHeight: 20 }}>
          {w.about}
        </Text>
      )}
      {w.skills.length > 0 && (
        <View style={styles.skills}>
          {w.skills.slice(0, 6).map((s) => (
            <View key={s} style={[styles.skill, { backgroundColor: c.s2 }]}>
              <Text variant="micro" tone="t2">{s}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

function Fact({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={13} color={c.t3} />
      <Text variant="caption" tone="t3" numberOfLines={1}>{text}</Text>
    </View>
  );
}

const PERIODS: { key: SalaryPeriod; label: string }[] = [
  { key: 'hour', label: 'per hour' },
  { key: 'day', label: 'per day' },
  { key: 'week', label: 'per week' },
  { key: 'year', label: 'per year' },
];

/** Putting yourself on the market: only the role is required, same as the
 *  server, so this is a thirty-second job rather than a form to dread. */
function ListingEditor({ visible, current, onClose, onSaved }: {
  visible: boolean;
  current: WorkerListing | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { c } = useTheme();
  const [role, setRole] = useState('');
  const [location, setLocation] = useState('');
  const [about, setAbout] = useState('');
  const [rate, setRate] = useState('');
  const [period, setPeriod] = useState<SalaryPeriod>('hour');
  const [remote, setRemote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState(false);

  /* Fill from the existing listing the first time it opens, and never again —
     re-seeding on every render would wipe out what is being typed. */
  useEffect(() => {
    if (!visible) { setSeeded(false); return; }
    if (seeded) return;
    setRole(current?.role ?? '');
    setLocation(current?.location ?? '');
    setAbout(current?.about ?? '');
    setRate(current?.rateMin != null ? String(current.rateMin) : '');
    setPeriod(current?.ratePeriod ?? 'hour');
    setRemote(!!current?.remote);
    setSeeded(true);
  }, [visible, seeded, current]);

  const save = async () => {
    if (!role.trim()) {
      haptics.warning();
      Alert.alert('Open to work', 'What kind of work? A role or a trade.');
      return;
    }
    setBusy(true);
    try {
      const n = parseInt(rate.replace(/[^0-9]/g, ''), 10);
      await postWorkerListing({
        role: role.trim(),
        location: location.trim() || undefined,
        about: about.trim() || undefined,
        rateMin: Number.isFinite(n) ? n : null,
        ratePeriod: Number.isFinite(n) ? period : null,
        remote,
      });
      /* Visibility defaults to OFF server-side, so a first listing has to switch
         it on or "Go live" puts somebody on a board nobody can see. Editing an
         existing one leaves whatever they chose alone. */
      if (!current) await setOpenToWork('everyone');
      haptics.success();
      onSaved();
    } catch (e) {
      haptics.error();
      Alert.alert('Open to work', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close">
          <Pressable style={[styles.sheet, { backgroundColor: c.bg }]} onPress={() => {}}>
            <View style={styles.sheetHead}>
              <Text variant="title" style={{ flex: 1 }}>
                {current ? 'Edit your listing' : 'List yourself'}
              </Text>
              <Pressable onPress={onClose} hitSlop={10}
                accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={24} color={c.t2} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 430 }} keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <Text variant="callout" tone="t2" style={styles.lbl}>What do you do? *</Text>
              <HapticInput
                value={role} onChangeText={setRole}
                placeholder="e.g. Carpenter, Bookkeeper, Barista"
                placeholderTextColor={c.t3}
                style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
                accessibilityLabel="What do you do"
              />

              <Text variant="callout" tone="t2" style={styles.lbl}>Where</Text>
              <HapticInput
                value={location} onChangeText={setLocation}
                placeholder="City, or leave blank"
                placeholderTextColor={c.t3}
                style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
                accessibilityLabel="Where"
              />
              <Pressable
                onPress={() => { haptics.select(); setRemote((r) => !r); }}
                style={[styles.toggle, { backgroundColor: remote ? c.accent : c.s1, marginTop: 10, alignSelf: 'flex-start' }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: remote }}
                accessibilityLabel="Open to remote work"
              >
                <Ionicons name="globe-outline" size={15} color={remote ? c.accentTint : c.t2} />
                <Text variant="callout" style={{ color: remote ? c.accentTint : c.t2 }}>
                  Open to remote work
                </Text>
              </Pressable>

              <Text variant="callout" tone="t2" style={styles.lbl}>Your rate</Text>
              <HapticInput
                value={rate} onChangeText={setRate}
                keyboardType="number-pad"
                placeholder="A whole number, or leave blank"
                placeholderTextColor={c.t3}
                style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
                accessibilityLabel="Your rate"
              />
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

              <Text variant="callout" tone="t2" style={styles.lbl}>A little about you</Text>
              <HapticInput
                value={about} onChangeText={setAbout}
                multiline
                placeholder="What you are good at and what you are after."
                placeholderTextColor={c.t3}
                style={[styles.input, styles.textarea, { backgroundColor: c.s1, color: c.text }]}
                accessibilityLabel="About you"
              />
            </ScrollView>

            <View style={{ marginTop: 18 }}>
              <Button title={current ? 'Save' : 'Go live'} kind="primary" loading={busy} onPress={save} />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 8,
  },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: radius.pill, paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  toggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
    alignSelf: 'flex-start', paddingHorizontal: 14, height: 36, borderRadius: radius.pill,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  mine: { marginHorizontal: spacing.gutter, marginBottom: 18, padding: 16 },
  mineTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  live: { width: 7, height: 7, borderRadius: 4 },
  card: { marginHorizontal: spacing.gutter, marginBottom: 14, padding: 14 },
  who: { flexDirection: 'row', alignItems: 'center' },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  factRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  skills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  skill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.gutter, paddingBottom: 34,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center' },
  lbl: { marginTop: 16, marginBottom: 8 },
  input: { borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16 },
  textarea: { minHeight: 100, textAlignVertical: 'top', borderRadius: radius.bubble },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, height: 38, borderRadius: radius.pill, justifyContent: 'center' },
});
