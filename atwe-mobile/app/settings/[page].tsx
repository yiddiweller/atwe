import { useState } from 'react';
import {
  View, ScrollView, Pressable, StyleSheet, Linking, ActivityIndicator, Alert, Share, Platform,
} from 'react-native';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { File, Paths } from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromeButton } from '@/components/Chrome';
import { MeFactRow, MeGroup, MeRow, MeSwitchRow } from '@/components/MeRow';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { useAuth } from '@/auth/AuthProvider';
import { haptics } from '@/lib/haptics';
import { setPage } from '@/settings/pages';
import { HapticInput } from '@/components/HapticInput';
import { Button } from '@/components/Button';
import {
  useAccountPrivacy, useSaveAccountPrivacy, useNotifPrefs, useSaveNotifPrefs, useSavePrivacy,
  useSessions, useRevokeSession, signOutEverywhere, deviceName,
  exportMyData, deactivateAccount,
} from '@/api/settings';
import { api } from '@/api/client';
import { timeAgo } from '@/lib/format';
import { APP_VERSION } from '@/lib/version';

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
          <ChromeButton onPress={() => { haptics.tap(); router.back(); }} label="Back">
            <Ionicons name="chevron-back" size={22} color={c.text} />
          </ChromeButton>
          <Text style={styles.title} numberOfLines={1}>{p.label}</Text>
        </View>

        {p.id === 'account' && <AccountPage />}
        {p.id === 'privacy' && <PrivacyPage />}
        {p.id === 'security' && <SecurityPage />}
        {p.id === 'notifications' && <NotificationsPage />}
        {p.id === 'display' && <DisplayPage />}
        {p.id === 'data' && <DataPage />}
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
  return (
    <>
      <MeGroup>
        <MeFactRow label="Version" value={APP_VERSION} />
        <MeFactRow label="iOS" value={String(Platform.Version)} />
        {/* Which material the nav bar is actually drawing.

            Liquid Glass needs iOS 26; below it the bar falls back to the same
            chrome material a native tab bar uses, which is a different look and
            always will be. Without this on screen there is no way to tell the
            two apart from a photograph, and a whole round of "the bar still
            isn't right" was spent not knowing which one was being looked at. */}
        <MeFactRow label="Nav bar"
          value={isLiquidGlassAvailable() ? 'Liquid Glass' : 'Chrome (needs iOS 26)'} />
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

/* ── Security & access ─────────────────────────────────────────────────────── */
function SecurityPage() {
  const { c } = useTheme();
  const { user, logout } = useAuth();
  const { data, isLoading } = useSessions();
  const revoke = useRevokeSession();
  const [sent, setSent] = useState(false);
  if (!user) return null;

  /* Changing a password goes through the emailed link, deliberately: a phone
     that is already unlocked and signed in should not be enough to change the
     credential that gets you back in if it is stolen. The server's own flow. */
  const emailReset = () => {
    haptics.tap();
    Alert.alert(
      'Change your password',
      `We'll email a secure link to ${user.email}. Open it to set a new one.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send the link',
          onPress: async () => {
            /* `noAuth` and always-200 by design — the endpoint never says
               whether an address exists, and it is the same route the login
               screen uses. */
            try { await api.post('/api/auth/forgot', { email: user.email }, { noAuth: true }); } catch {}
            setSent(true);
            haptics.success();
          },
        },
      ],
    );
  };

  const everywhere = () => {
    haptics.tap();
    Alert.alert(
      'Sign out everywhere?',
      'Every device, including this one. You will need to sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out everywhere',
          style: 'destructive',
          onPress: async () => {
            try { await signOutEverywhere(); } catch {}
            /* The server has already dropped this device's session, so the
               local one has to go too or the app sits holding a dead token. */
            void logout();
          },
        },
      ],
    );
  };

  const sessions = data?.sessions ?? [];
  return (
    <>
      <MeGroup>
        <MeRow icon="key-outline" label="Change password"
          sub={sent ? 'Link sent — check your email' : 'We email you a secure link'}
          onPress={emailReset} />
        <MeRow icon="shield-checkmark-outline" label="Two-factor authentication"
          sub={user.twoFactorEnabled ? 'On' : 'Set this up on atwe.com'} last
          onPress={() => { haptics.tap(); void Linking.openURL('https://atwe.com/settings'); }} />
      </MeGroup>

      <Cap>Devices signed in to your account. Removing one signs it out at once.</Cap>
      {isLoading ? <ActivityIndicator style={{ marginTop: 12 }} /> : (
        <MeGroup>
          {sessions.map((sn, i) => (
            <MeRow
              key={sn.id}
              icon={/iPhone|iPad|Android/i.test(sn.userAgent) ? 'phone-portrait-outline' : 'desktop-outline'}
              label={deviceName(sn.userAgent) + (sn.current ? ' · this device' : '')}
              sub={[sn.location || sn.ip, sn.last_seen ? timeAgo(sn.last_seen) : null]
                .filter(Boolean).join(' · ')}
              /* The device you are holding gets no chevron and no action: it
                 cannot sign itself out from here, and offering the row anyway
                 would be a control that does nothing. */
              noChevron={sn.current}
              last={i === sessions.length - 1}
              onPress={() => {
                if (sn.current) return;
                haptics.tap();
                Alert.alert('Remove this device?', `${deviceName(sn.userAgent)} will be signed out.`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => revoke.mutate(sn.id) },
                ]);
              }}
            />
          ))}
        </MeGroup>
      )}

      <MeGroup>
        <MeRow icon="log-out-outline" label="Sign out everywhere" danger last noChevron
          onPress={everywhere} />
      </MeGroup>
    </>
  );
}

/* ── Your data & storage ───────────────────────────────────────────────────── */
function DataPage() {
  const { user } = useAuth();
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState('');
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { c } = useTheme();
  if (!user) return null;

  /* Written to a real file and handed to the share sheet rather than pasted
     into a message: the bundle is every post, order and message you have, and
     a share sheet full of raw JSON is not something anybody can save. */
  const download = async () => {
    haptics.tap();
    setBusy(true);
    try {
      const bundle = await exportMyData();
      const f = new File(Paths.cache, `atwe-${user.username || user.id}-data.json`);
      if (f.exists) f.delete();
      f.create();
      f.write(JSON.stringify(bundle, null, 2));
      await Share.share({ url: f.uri, title: 'Your Atwe data' });
      haptics.success();
    } catch (e) {
      Alert.alert('Could not build your data', (e as Error).message);
    } finally { setBusy(false); }
  };

  const deactivate = async () => {
    setErr(null);
    setBusy(true);
    try {
      await deactivateAccount(pw);
      haptics.success();
      void logout();
    } catch (e) {
      setErr((e as Error).message);
      haptics.error();
    } finally { setBusy(false); }
  };

  return (
    <>
      <MeGroup>
        <MeRow icon="download-outline" label={busy ? 'Working…' : 'Download your data'}
          sub="Everything of yours, as one file" last
          onPress={() => { if (!busy) void download(); }} />
      </MeGroup>
      <Cap>Your posts, messages, orders and account details. No passwords and nothing about anyone else.</Cap>

      {!asking ? (
        <MeGroup>
          <MeRow icon="pause-circle-outline" label="Deactivate account" danger last noChevron
            onPress={() => { haptics.tap(); setAsking(true); }} />
        </MeGroup>
      ) : (
        <MeGroup>
          <View style={styles.deact}>
            <Text variant="headline">Deactivate your account</Text>
            {/* Said plainly, because "deactivate" and "delete" are not the same
                word and people reasonably fear the wrong one. */}
            <Text variant="body" tone="t3" style={{ marginTop: 6, lineHeight: 20 }}>
              Your profile stops showing anywhere and nobody can reach you.
              Nothing is deleted — signing back in brings it all back.
            </Text>
            <HapticInput
              value={pw} onChangeText={setPw} secureTextEntry
              placeholder="Your password" placeholderTextColor={c.t3}
              style={[styles.pwIn, { backgroundColor: c.s3, color: c.text }]}
              autoCapitalize="none" autoCorrect={false}
              accessibilityLabel="Your password"
            />
            {!!err && <Text variant="caption" style={{ color: c.danger, marginTop: 8 }}>{err}</Text>}
            <View style={{ height: 12 }} />
            <Button title={busy ? 'Deactivating…' : 'Deactivate'} kind="danger"
              disabled={busy || pw.length < 1} onPress={() => void deactivate()} />
            <View style={{ height: 8 }} />
            <Button title="Cancel" kind="secondary" onPress={() => { setAsking(false); setPw(''); setErr(null); }} />
          </View>
        </MeGroup>
      )}
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
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.48, flex: 1, minWidth: 0, lineHeight: 29},
  cap: { fontSize: 12.5, lineHeight: 17, marginTop: -2, marginBottom: 12, paddingHorizontal: 15 },
  pick: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    paddingVertical: 12, paddingHorizontal: 15, minHeight: 55,
  },
  swatch: { width: 30, height: 30, borderRadius: radius.sm, borderWidth: 1 },
  deact: { padding: 15 },
  pwIn: { marginTop: 14, borderRadius: radius.pill, paddingHorizontal: 16, height: 46, fontSize: 16 },
  pickLbl: { flex: 1, fontSize: 15.5, fontWeight: '600', letterSpacing: -0.155 },
});
