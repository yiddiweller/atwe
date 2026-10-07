import { useState } from 'react';
import {
  View, ScrollView, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Alert, TextInput, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { Shelf } from '@/components/Shelf';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import {
  useTeam, useMemberships, inviteTeamMember, updateTeamMember, removeTeamMember,
  respondToTeamInvite, PERM_LABEL,
  type TeamMember, type TeamPerm, type TeamRole,
} from '@/api/bizops';
import { useAuth } from '@/auth/AuthProvider';
import { haptics } from '@/lib/haptics';
import { SheetGlass } from '@/components/Glass';

/**
 * People who help run the business, and the businesses you help run. Two sides
 * of the same table, so two shelves rather than two screens.
 *
 * The OWNER is never a row — they always have everything, and a row you cannot
 * change is a row that invites you to try.
 */
export default function Team() {
  const { c } = useTheme();
  const { user } = useAuth();
  const isBiz = user?.accountType === 'business';
  const [shelf, setShelf] = useState<'mine' | 'memberships'>(isBiz ? 'mine' : 'memberships');
  const [inviting, setInviting] = useState(false);

  const team = useTeam(isBiz);
  const mine = useMemberships();

  return (
    <Screen edges={[]}>
      <PageHeader
        title="Team"
        action={isBiz && shelf === 'mine'
          ? { icon: 'person-add-outline', label: 'Invite somebody', onPress: () => setInviting(true) }
          : undefined}
        below={isBiz ? (
          <Shelf
            value={shelf}
            onChange={setShelf}
            options={[
              { key: 'mine', label: 'Your team' },
              { key: 'memberships', label: 'You help run' },
            ]}
          />
        ) : null}
      />
      {shelf === 'mine' ? (
        team.isLoading ? (
          <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
        ) : (
          <ScrollView
            contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 120 }, isBiz ? chromePad.headerShelf : chromePad.header]}
            refreshControl={<RefreshControl refreshing={team.isRefetching} onRefresh={team.refetch} tintColor={c.accent} />}
          >
            {(team.data?.members ?? []).length === 0 ? (
              <View style={styles.center}>
                <Ionicons name="people-outline" size={44} color={c.t4} />
                <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                  Invite somebody to help answer customers, ship orders or hire.
                </Text>
              </View>
            ) : (team.data?.members ?? []).map((m) => (
              <MemberRow key={m.id} m={m} perms={team.data?.perms ?? []} onDone={team.refetch} />
            ))}
          </ScrollView>
        )
      ) : (
        mine.isLoading ? (
          <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
        ) : (
          <ScrollView
            contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 120 }, isBiz ? chromePad.headerShelf : chromePad.header]}
            refreshControl={<RefreshControl refreshing={mine.isRefetching} onRefresh={mine.refetch} tintColor={c.accent} />}
          >
            {(mine.data?.memberships ?? []).length === 0 ? (
              <View style={styles.center}>
                <Ionicons name="briefcase-outline" size={44} color={c.t4} />
                <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                  You are not on anybody's team.
                </Text>
              </View>
            ) : (mine.data?.memberships ?? []).map((ms) => (
              <MembershipRow key={ms.businessId} ms={ms} onDone={mine.refetch} />
            ))}
          </ScrollView>
        )
      )}

      <InviteSheet
        visible={inviting}
        perms={team.data?.perms ?? []}
        onClose={() => setInviting(false)}
        onDone={team.refetch}
      />
    </Screen>
  );
}

function MemberRow({ m, perms, onDone }: { m: TeamMember; perms: TeamPerm[]; onDone: () => void }) {
  const { c, radius } = useTheme();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const granted = perms.filter((p) => m.permissions[p]);

  const togglePerm = async (p: TeamPerm) => {
    setBusy(true);
    try {
      const next = { ...m.permissions };
      if (next[p]) delete next[p]; else next[p] = true;
      await updateTeamMember(m.id, { permissions: next });
      haptics.success();
      onDone();
    } catch (e) { haptics.error(); Alert.alert('Team', (e as Error).message); }
    finally { setBusy(false); }
  };

  const remove = () => {
    Alert.alert(`Remove ${m.name}?`, 'They will lose access to your business straight away.', [
      { text: 'Keep them', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          setBusy(true);
          try { await removeTeamMember(m.id); haptics.success(); onDone(); }
          catch (e) { haptics.error(); Alert.alert('Team', (e as Error).message); }
          finally { setBusy(false); }
        },
      },
    ]);
  };

  return (
    <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.card }]}>
      <Pressable style={styles.rowTop} onPress={() => { haptics.tap(); setOpen((v) => !v); }}
        accessibilityRole="button" accessibilityLabel={`${m.name}, ${m.role}`}>
        <Avatar name={m.name} avatar={m.avatar} biz={m.accountType === 'business'} size={40} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text variant="headline" numberOfLines={1}>{m.name}</Text>
          <Text variant="caption" tone="t3">
            {m.role}{m.status === 'invited' ? ' · invited' : ''}
            {/* An admin's access is the role, not a tick list — saying "2 things"
                under somebody who can do everything would be wrong. */}
            {m.role !== 'admin' && granted.length ? ` · ${granted.length} things` : ''}
          </Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.t3} />
      </Pressable>

      {open && (
        <View style={{ marginTop: 12 }}>
          {m.role === 'admin' ? (
            <Text variant="caption" tone="t3">
              An admin can do everything you can, except remove you.
            </Text>
          ) : perms.map((p) => (
            <Pressable
              key={p}
              onPress={() => togglePerm(p)}
              disabled={busy}
              style={[styles.perm, { borderBottomColor: c.bg }]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!m.permissions[p] }}
              accessibilityLabel={PERM_LABEL[p].label}
            >
              <Ionicons
                name={m.permissions[p] ? 'checkmark-circle' : 'ellipse-outline'}
                size={21}
                color={m.permissions[p] ? c.accent : c.t4}
              />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text variant="body">{PERM_LABEL[p].label}</Text>
                <Text variant="micro" tone="t3">{PERM_LABEL[p].sub}</Text>
              </View>
            </Pressable>
          ))}
          <Button title="Remove from the team" kind="danger" onPress={remove}
            style={{ marginTop: 12, minHeight: 40 }} />
        </View>
      )}
    </View>
  );
}

function MembershipRow({ ms, onDone }: {
  ms: { businessId: number; role: TeamRole; status: string; business: { name: string; avatar: string | null; accountType?: string } };
  onDone: () => void;
}) {
  const { c, radius } = useTheme();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const respond = async (accept: boolean) => {
    setBusy(true);
    try {
      await respondToTeamInvite(ms.businessId, accept);
      haptics.success();
      qc.invalidateQueries({ queryKey: ['memberships'] });
      onDone();
    } catch (e) { haptics.error(); Alert.alert('Team', (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.card }]}>
      <View style={styles.rowTop}>
        <Avatar name={ms.business.name} avatar={ms.business.avatar}
          biz={ms.business.accountType === 'business'} size={40} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text variant="headline" numberOfLines={1}>{ms.business.name}</Text>
          <Text variant="caption" tone="t3">
            {ms.status === 'invited' ? `invited you as ${ms.role}` : `you are ${ms.role}`}
          </Text>
        </View>
      </View>
      {ms.status === 'invited' && (
        <View style={styles.acts}>
          <Button title="Join" onPress={() => respond(true)} loading={busy}
            style={{ flex: 1, minHeight: 40 }} />
          <Button title="No thanks" kind="secondary" onPress={() => respond(false)}
            style={{ flex: 1, minHeight: 40 }} />
        </View>
      )}
    </View>
  );
}

const ROLES: { key: TeamRole; label: string; sub: string }[] = [
  { key: 'staff', label: 'Staff', sub: 'Customer-facing: questions and reviews' },
  { key: 'manager', label: 'Manager', sub: 'Everything except managing the team' },
  { key: 'admin', label: 'Admin', sub: 'Everything you can do' },
];

function InviteSheet({ visible, perms, onClose, onDone }: {
  visible: boolean; perms: TeamPerm[]; onClose: () => void; onDone: () => void;
}) {
  const { c, radius, spacing } = useTheme();
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<TeamRole>('staff');
  const [picked, setPicked] = useState<Partial<Record<TeamPerm, boolean>>>({ qa: true, reviews: true, inbox: true });
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      /* An admin gets everything by definition, so sending a tick list for one
         would be describing access it does not obey. */
      await inviteTeamMember(
        username.trim().replace(/^@/, ''),
        role,
        role === 'admin' ? Object.fromEntries(perms.map((p) => [p, true])) : picked,
      );
      haptics.success();
      setUsername('');
      onDone(); onClose();
    } catch (e) { haptics.error(); Alert.alert('Team', (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}><SheetGlass>
      <Screen edges={[]}>
        <PageHeader title="Invite somebody" />
        <ScrollView contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 60 }, chromePad.header]} keyboardShouldPersistTaps="handled">
          <Text variant="caption" tone="t3" style={styles.lbl}>WHO</Text>
          <TextInput
            value={username} onChangeText={setUsername}
            placeholder="@username" placeholderTextColor={c.t4}
            autoCapitalize="none" autoCorrect={false}
            accessibilityLabel="Their username"
            style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.pill }]}
          />

          <Text variant="caption" tone="t3" style={styles.lbl}>WHAT THEY ARE</Text>
          {ROLES.map((r) => (
            <Pressable
              key={r.key}
              onPress={() => { haptics.select(); setRole(r.key); }}
              style={[styles.perm, { borderBottomColor: c.border }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: role === r.key }}
              accessibilityLabel={r.label}
            >
              <Ionicons
                name={role === r.key ? 'radio-button-on' : 'radio-button-off'}
                size={21}
                color={role === r.key ? c.accent : c.t4}
              />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text variant="body">{r.label}</Text>
                <Text variant="micro" tone="t3">{r.sub}</Text>
              </View>
            </Pressable>
          ))}

          {role !== 'admin' && (
            <>
              <Text variant="caption" tone="t3" style={styles.lbl}>WHAT THEY CAN DO</Text>
              {perms.map((p) => (
                <Pressable
                  key={p}
                  onPress={() => { haptics.select(); setPicked((s) => ({ ...s, [p]: !s[p] })); }}
                  style={[styles.perm, { borderBottomColor: c.border }]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: !!picked[p] }}
                  accessibilityLabel={PERM_LABEL[p].label}
                >
                  <Ionicons
                    name={picked[p] ? 'checkmark-circle' : 'ellipse-outline'}
                    size={21}
                    color={picked[p] ? c.accent : c.t4}
                  />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text variant="body">{PERM_LABEL[p].label}</Text>
                    <Text variant="micro" tone="t3">{PERM_LABEL[p].sub}</Text>
                  </View>
                </Pressable>
              ))}
            </>
          )}

          <View style={{ height: 20 }} />
          <Button title="Send the invite" onPress={go} loading={busy}
            disabled={username.trim().replace(/^@/, '').length < 2} />
        </ScrollView>
      </Screen>
    </SheetGlass></Modal>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  card: { padding: 14, marginBottom: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  perm: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  acts: { flexDirection: 'row', gap: 10, marginTop: 12 },
  lbl: { marginTop: 18, marginBottom: 8, letterSpacing: 0.6 },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
});
