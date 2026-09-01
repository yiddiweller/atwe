import { useState } from 'react';
import {
  View, ScrollView, TextInput, Pressable, Alert, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromeBar, useFloatingChrome } from '@/components/Chrome';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { useAuth } from '@/auth/AuthProvider';
import { saveProfile } from '@/api/profile';
import { pickPhoto, pickPhotoMessage } from '@/lib/pickPhoto';
import { HoursEditor, DEFAULT_HOURS, type BusinessHours } from '@/components/HoursEditor';
import { mediaUri } from '@/lib/media';
import { HapticInput } from '@/components/HapticInput';
import { haptics } from '@/lib/haptics';

/**
 * Change how you look to everyone else.
 *
 * There was no way to do this on the phone at all: the Profile hub's "Edit
 * profile" row opened your public page, which is where you go to LOOK at
 * yourself, not to change anything.
 *
 * Photos are only sent when they actually changed. The server's rule is absent
 * = leave alone, empty = remove, data URL = set — and the stored value comes
 * back as a signed URL rather than the original bytes, so echoing it would try
 * to save a URL as a picture.
 */
export default function EditProfile() {
  const { c } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { user, setUser } = useAuth();
  const biz = user?.accountType === 'business';

  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [headline, setHeadline] = useState(user?.headline ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  // Prefilled, not blank: an unread field is saved back as empty and wipes what
  // was there.
  const [location, setLocation] = useState(user?.location ?? '');
  const [website, setWebsite] = useState(user?.website ?? '');
  const [avatar, setAvatar] = useState<string | null>(user?.avatar ?? null);
  const [banner, setBanner] = useState<string | null>(user?.banner ?? null);
  // Business hours: seven days from Monday. Editing them here is what makes the
  // Book sheet's "they haven't put up their hours" a solvable problem rather
  // than a dead end.
  const [hours, setHours] = useState<BusinessHours>(
    (Array.isArray(user?.businessHours) ? (user!.businessHours as BusinessHours) : null) ?? DEFAULT_HOURS,
  );
  const [hoursChanged, setHoursChanged] = useState(false);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [bannerChanged, setBannerChanged] = useState(false);
  const [saving, setSaving] = useState(false);

  const choose = async (which: 'avatar' | 'banner') => {
    const r = await pickPhoto();
    if (r.ok) {
      if (which === 'avatar') { setAvatar(r.dataUrl); setAvatarChanged(true); }
      else { setBanner(r.dataUrl); setBannerChanged(true); }
      return;
    }
    const m = pickPhotoMessage(r.reason);
    if (m) Alert.alert('Photo', m);
  };

  const clear = (which: 'avatar' | 'banner') => {
    if (which === 'avatar') { setAvatar(null); setAvatarChanged(true); }
    else { setBanner(null); setBannerChanged(true); }
  };

  const save = async () => {
    if (saving || !name.trim()) return;
    setSaving(true);
    try {
      const next = await saveProfile({
        // Always both, even unchanged: the route refuses a body with no name and
        // reads a missing username as "clear it".
        name: name.trim(),
        username: username.trim(),
        headline: headline.trim(),
        bio: bio.trim(),
        location: location.trim(),
        website: website.trim(),
        ...(avatarChanged ? { avatar: avatar ?? '' } : {}),
        ...(bannerChanged ? { banner: banner ?? '' } : {}),
        // Only when touched: sending them unchanged would write a default over
        // hours set anywhere else.
        ...(biz && hoursChanged ? { businessHours: hours } : {}),
      });
      haptics.success();
      setUser(next);
      // Your name and face are on posts, chats and search results all over the
      // app; every cached copy of them is now out of date.
      qc.invalidateQueries();
      router.back();
    } catch (e) {
      haptics.error(); Alert.alert('Profile', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const chrome = useFloatingChrome();

  return (
    <Screen edges={[]}>
      <ChromeBar onLayout={chrome.onLayout}>
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}
            accessibilityRole="button" accessibilityLabel="Cancel">
            <Ionicons name="close" size={24} color={c.text} />
          </Pressable>
          <Text variant="headline">Edit profile</Text>
          <View style={styles.back} />
        </View>
      </ChromeBar>

      <ScrollView contentContainerStyle={[styles.body, chrome.pad]} keyboardShouldPersistTaps="handled">
        {/* Banner + avatar, the way they appear on the real profile */}
        <Pressable onPress={() => choose('banner')} style={[styles.banner, { backgroundColor: c.s2 }]}
          accessibilityRole="button" accessibilityLabel="Change cover photo">
          {banner ? (
            <Image source={{ uri: mediaUri(banner) }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : null}
          <View style={styles.camera}>
            <Ionicons name="camera-outline" size={20} color="#fff" />
          </View>
        </Pressable>
        <View style={styles.avatarRow}>
          <Pressable onPress={() => choose('avatar')}
            accessibilityRole="button" accessibilityLabel="Change profile photo">
            <Avatar name={name} avatar={avatar} biz={biz} size={82} />
            <View style={[styles.camera, styles.cameraSmall]}>
              <Ionicons name="camera-outline" size={16} color="#fff" />
            </View>
          </Pressable>
          <View style={{ flex: 1 }} />
          {!!avatar && (
            <Pressable onPress={() => clear('avatar')} hitSlop={8}
              accessibilityRole="button" accessibilityLabel="Remove profile photo">
              <Text variant="callout" style={{ color: c.danger }}>Remove photo</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.fields}>
        <Field label={biz ? 'Business name' : 'Name'} value={name} set={setName} c={c} maxLength={80} />
        <Field label="Username" value={username} set={setUsername} c={c}
          autoCapitalize="none" autoCorrect={false} maxLength={40} />
        <Text variant="caption" tone="t3" style={styles.hint}>
          Letters, numbers, dots, dashes and underscores. People find you at
          atwe.com/{username || 'yourname'}
        </Text>
        <Field label={biz ? 'What you do' : 'Headline'} value={headline} set={setHeadline}
          c={c} maxLength={120} placeholder={biz ? 'Bakery in Camden' : 'Product designer'} />
        <Field label="Bio" value={bio} set={setBio} c={c} multiline maxLength={280}
          placeholder="A couple of lines about you" />
        <Field label="Where you are" value={location} set={setLocation} c={c} maxLength={60}
          placeholder="London" />
        <Field label="Website" value={website} set={setWebsite} c={c}
          autoCapitalize="none" autoCorrect={false} keyboardType="url"
          maxLength={120} placeholder="yoursite.com" />

        {biz && (
          <View style={{ marginTop: 10 }}>
            <Text variant="headline" style={{ marginBottom: 10 }}>Opening hours</Text>
            <HoursEditor
              value={hours}
              onChange={(h) => { setHours(h); setHoursChanged(true); }}
            />
          </View>
        )}
        </View>
      </ScrollView>

      <View style={[styles.foot, { borderTopColor: c.border }]}>
        <Button title="Save" kind="primary" loading={saving} disabled={!name.trim()} onPress={save} />
      </View>
    </Screen>
  );
}

function Field({ label, value, set, c, ...rest }: {
  label: string;
  value: string;
  set: (t: string) => void;
  c: { s1: string; text: string; t3: string };
} & Omit<React.ComponentProps<typeof TextInput>, 'value' | 'onChangeText'>) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text variant="caption" tone="t3" style={{ marginBottom: 5 }}>{label}</Text>
      <HapticInput
        value={value}
        onChangeText={set}
        placeholderTextColor={c.t3}
        style={[
          styles.input,
          { backgroundColor: c.s1, color: c.text },
          rest.multiline ? { minHeight: 92, textAlignVertical: 'top' } : null,
        ]}
        accessibilityLabel={label}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 8,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { paddingBottom: 28 },
  banner: { height: 120, justifyContent: 'center', alignItems: 'center' },
  camera: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  cameraSmall: {
    position: 'absolute', right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15,
  },
  avatarRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.gutter, marginTop: -34, marginBottom: 14,
  },
  fields: { paddingHorizontal: spacing.gutter },
  hint: { marginTop: -6, marginBottom: 14 },
  input: { borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  foot: {
    padding: spacing.gutter, paddingBottom: 26,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
