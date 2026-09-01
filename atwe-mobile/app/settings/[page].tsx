import { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Linking, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { MeFactRow, MeGroup, MeRow, MeSwitchRow } from '@/components/MeRow';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { useAuth } from '@/auth/AuthProvider';
import { haptics } from '@/lib/haptics';
import { setPage } from '@/settings/pages';
import {
  useAccountPrivacy, useSaveAccountPrivacy, useNotifPrefs, useSaveNotifPrefs, useSavePrivacy,
} from '@/api/settings';

/**
 * One Settings page. Same header and same cards as the hub, so the tree is one
 * visual system rather than a hub in one style and its leaves in another.
 */
export default function SettingsPage() {
  const { c } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const { page } = useLocalSearchParams<{ page: string }>();
  const p = setPage(String(page));
  if (!user || !p) return null;

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          <Pressable onPress={() => { haptics.tap(); router.back(); }} hitSlop={8}
            accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
            <Ionicons name="chevron-back" size={26} color={c.text} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{p.label}</Text>
        </View>

        {p.id === 'account' && <AccountPage />}
        {p.id === 'privacy' && <PrivacyPage />}
        {p.id === 'notifications' && <NotificationsPage />}
        {p.id === 'display' && <DisplayPage />}
        {p.id === 'about' && <AboutPage />}
      </ScrollView>
    </Screen>
  );
}

/* ── Your account ──────────────────────────────────────────────────────────── */
function AccountPage() {
  const { user } = useAuth();
  const router = useRouter();
  if (!user) return null;
  return (
    <>
      <MeGroup>
        <MeRow icon="person-outline" label="Edit profile" sub="Photo, name, bio and links" last
          onPress={() => { haptics.tap(); router.push('/edit-profile'); }} />
      </MeGroup>
      <Cap>Your account information is private. Only you can see your email.</Cap>
      <MeGroup>
        <MeFactRow label="Name" value={user.name} />
        {!!user.username && <MeFactRow label="Username" value={`@${user.username}`} />}
        <MeFactRow label="Email" value={user.email} />
        <MeFactRow label="Account type" value={user.accountType === 'business' ? 'Business' : 'Personal'} />
        <MeFactRow label="Plan" value={user.plan === 'pro' ? 'Atwe Pro' : 'Free'} />
        <MeFactRow label="Email verified" value={user.email_verified ? 'Yes' : 'Not verified'} />
        <MeFactRow label="Two-factor" value={user.twoFactorEnabled ? 'On' : 'Off'} last />
      </MeGroup>
      {/* Said plainly rather than left to be discovered: changing an email or
          turning on two-factor is a security action, and the web deliberately
          routes both through an emailed link. */}
      <Cap>Change your email, password or two-factor on atwe.com — those go through a link we email you, so they cannot be done from a signed-in phone alone.</Cap>
    </>
  );
}

/* ── Privacy & safety ──────────────────────────────────────────────────────── */
function PrivacyPage() {
  const { user, setUser } = useAuth();
  const { data, isLoading } = useAccountPrivacy();
  const saveAcc = useSaveAccountPrivacy();
  const savePriv = useSavePrivacy();
  const [rr, setRr] = useState(user?.readReceipts !== false);
  const [ppv, setPpv] = useState(user?.privateProfileViews === true);
  if (!user) return null;

  /* `readReceipts`/`privateProfileViews` live on the signed-in user rather than
     in a query of their own, so the local state IS the source here and the user
     object is updated alongside it. */
  const flipRr = (v: boolean) => { setRr(v); setUser({ ...user, readReceipts: v }); savePriv.mutate({ readReceipts: v }); };
  const flipPpv = (v: boolean) => { setPpv(v); setUser({ ...user, privateProfileViews: v }); savePriv.mutate({ privateProfileViews: v }); };

  return (
    <>
      <MeGroup>
        <MeSwitchRow icon="checkmark-done-outline" label="Read receipts"
          sub="Both sides see when a message was read" value={rr} onChange={flipRr} />
        <MeSwitchRow icon="eye-off-outline" label="Private browsing"
          sub="Your visits are not recorded — and you cannot see who visited you"
          value={ppv} onChange={flipPpv} last />
      </MeGroup>

      {isLoading || !data ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <>
          <MeGroup>
            <MeSwitchRow icon="radio-outline" label="Last seen & online"
              sub="Turning this off hides everyone else's from you too"
              value={data.presenceVisibility !== 'nobody'}
              onChange={(v) => saveAcc.mutate({ presenceVisibility: v ? 'everyone' : 'nobody' })} />
            <MeSwitchRow icon="people-outline" label="Show your connections"
              value={data.connectionsVisible}
              onChange={(v) => saveAcc.mutate({ connectionsVisible: v })} />
            <MeSwitchRow icon="call-outline" label="Silence unknown callers"
              sub="A call from someone you don't know is logged, not rung"
              value={data.silenceUnknownCallers}
              onChange={(v) => saveAcc.mutate({ silenceUnknownCallers: v })} last />
          </MeGroup>
          <MeGroup>
            <MeSwitchRow icon="sparkles-outline" label="Personalised feed"
              sub="Use what you read to decide what comes next"
              value={data.personalized}
              onChange={(v) => saveAcc.mutate({ personalized: v })} />
            <MeSwitchRow icon="megaphone-outline" label="Share profile updates"
              sub="Tell your connections when your headline changes"
              value={data.shareProfileUpdates}
              onChange={(v) => saveAcc.mutate({ shareProfileUpdates: v })} last />
          </MeGroup>
        </>
      )}
    </>
  );
}

/* Nine identical bells is a list you cannot scan. The server names each
   category; these are the glyphs that go with those names. */
const NOTIF_IC: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  likes: 'heart-outline',
  replies: 'chatbubble-outline',
  follows: 'person-add-outline',
  posts: 'newspaper-outline',
  connections: 'people-outline',
  endorsements: 'ribbon-outline',
  events: 'ticket-outline',
  newsletters: 'mail-open-outline',
  updates: 'refresh-outline',
};

/* ── Notifications ─────────────────────────────────────────────────────────── */
function NotificationsPage() {
  const { data, isLoading } = useNotifPrefs();
  const save = useSaveNotifPrefs();
  if (isLoading || !data) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <>
      <Cap>Money, messages and job alerts always come through — those are never muted.</Cap>
      <MeGroup>
        {data.categories.map((cat, i) => (
          <MeSwitchRow key={cat.key} icon={NOTIF_IC[cat.key] ?? 'notifications-outline'} label={cat.label}
            value={cat.on} onChange={(v) => save.mutate({ [cat.key]: v })}
            last={i === data.categories.length - 1} />
        ))}
      </MeGroup>
    </>
  );
}

/* ── Display & accessibility ───────────────────────────────────────────────── */
function DisplayPage() {
  const { c, pref, setPref, name } = useTheme();
  const [hapticsOn, setHapticsOn] = useState(haptics.isEnabled);
  return (
    <>
      <MeGroup>
        {(['black', 'light', 'system'] as const).map((opt, i) => (
          <Pressable key={opt}
            onPress={() => { haptics.select(); setPref(opt); }}
            accessibilityRole="radio" accessibilityState={{ selected: pref === opt }}
            style={[styles.pick, { borderBottomColor: c.bg, borderBottomWidth: i === 2 ? 0 : 1 }]}
          >
            <View style={[styles.swatch, {
              backgroundColor: opt === 'light' ? '#FFFFFF' : opt === 'black' ? '#000000' : c.s3,
              borderColor: c.border,
            }]} />
            <Text style={styles.pickLbl}>
              {opt === 'black' ? 'Black' : opt === 'light' ? 'Light' : 'System'}
            </Text>
            {pref === opt && <Ionicons name="checkmark" size={20} color={c.accent} />}
          </Pressable>
        ))}
      </MeGroup>
      <Cap>Currently showing the {name} theme.</Cap>
      <MeGroup>
        {/* Some people find any vibration unpleasant and iOS's own switch is
            three screens deep in Accessibility, so an app that leans on touch
            this hard owes them a one-tap way out. Turning it OFF is the last
            thing that ticks; turning it back ON ticks at once. */}
        <MeSwitchRow icon="pulse-outline" label="Haptics"
          sub="The small taps you feel when you press, pick and confirm"
          value={hapticsOn} last
          onChange={(v) => {
            if (v) { haptics.setEnabled(true); haptics.select(); }
            else { haptics.setEnabled(false); }
            setHapticsOn(v);
          }} />
      </MeGroup>
    </>
  );
}

/* ── About ─────────────────────────────────────────────────────────────────── */
function AboutPage() {
  const v = Constants.expoConfig?.version ?? '—';
  const build = (Constants.expoConfig as { ios?: { buildNumber?: string } } | null)?.ios?.buildNumber;
  return (
    <>
      <MeGroup>
        <MeFactRow label="Version" value={build ? `${v} (${build})` : v} />
        <MeFactRow label="Made by" value="Atwe Inc" last />
      </MeGroup>
      <MeGroup>
        <MeRow icon="document-text-outline" label="Terms of Service"
          onPress={() => { haptics.tap(); void Linking.openURL('https://atwe.com/terms.html'); }} />
        <MeRow icon="lock-closed-outline" label="Privacy Policy" last
          onPress={() => { haptics.tap(); void Linking.openURL('https://atwe.com/privacy.html'); }} />
      </MeGroup>
    </>
  );
}

/** `.iset-cap` — a line of plain language under a card, not a heading over it. */
function Cap({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return <Text style={[styles.cap, { color: c.t3 }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.gutter, paddingTop: 2, paddingBottom: 80 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 14 },
  back: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginLeft: -9 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.48, flex: 1, minWidth: 0 },
  cap: { fontSize: 12.5, lineHeight: 17, marginTop: -2, marginBottom: 12, paddingHorizontal: 15 },
  pick: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    paddingVertical: 12, paddingHorizontal: 15, minHeight: 55,
  },
  swatch: { width: 30, height: 30, borderRadius: radius.sm, borderWidth: 1 },
  pickLbl: { flex: 1, fontSize: 15.5, fontWeight: '600', letterSpacing: -0.155 },
});
