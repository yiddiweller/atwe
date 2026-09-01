import { useEffect, useRef, useState } from 'react';
import {
  View, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView,
  Linking, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { AuthButton } from '@/components/AuthButton';
import { AtweMark } from '@/components/AtweMark';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/api/client';
import { HapticInput } from '@/components/HapticInput';

/**
 * Signing in — the web's flow, screen for screen.
 *
 * It opens on the LANDING: the Atwe mark, and four ways in. One white pill for
 * the primary way (email), grey glass for the rest, the legal line underneath.
 * Choosing one moves to a STEP: a back arrow, one big question, one big
 * borderless field, and Continue pinned to the bottom of the screen — grey
 * until the field is worth submitting, white once it is. The button never moves
 * between steps, which is what makes the flow feel steady rather than jumpy.
 *
 * This replaced a plain two-box form that looked nothing like the product.
 */
type Step = 'landing' | 'email' | 'username' | 'password';

export default function Login() {
  const { c } = useTheme();
  const { login } = useAuth();

  const [step, setStep] = useState<Step>('landing');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needs2fa, setNeeds2fa] = useState(false);
  // The email step ASKS whether an account exists, and turns into an invitation
  // to create one when it does not — the web's flow. "No account with that
  // email" as an error would be both unhelpful and a way to probe who is signed
  // up; offering to create one is neither.
  const [createMode, setCreateMode] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<TextInput>(null);

  // The field on a step is the whole step — focus it as soon as it appears.
  useEffect(() => {
    if (step === 'landing') return;
    const t = setTimeout(() => field.current?.focus(), 220);
    return () => clearTimeout(t);
  }, [step]);

  const go = (s: Step) => { setError(null); setStep(s); };

  /* Google and Apple are on the landing because they are on the web's, and the
     design is the web's. Neither works on the phone yet: the server has the
     routes, but the NATIVE side of each (expo-auth-session, Sign in with Apple)
     is not built, and this server has no client id configured either. So they
     say the same thing the web says when it is unconfigured — plainly, rather
     than failing. */
  const soon = (which: string) =>
    setError(`${which} sign-in is coming soon. Use a username or email for now.`);

  /* Reset by email. The server always answers 200 whether or not the address is
     known — it will not confirm who has an account — so the message says what
     was DONE ("if there's an account, a link is on its way") rather than
     claiming it found one. */
  const forgot = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post('/api/auth/forgot', { email: identifier.trim() }, { noAuth: true });
      setError(`If there's an account for ${identifier.trim()}, a reset link is on its way.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await login({
        identifier: identifier.trim(), password, code: code.trim() || undefined,
      });
      if (res.twoFactorRequired) {
        setNeeds2fa(true);
        setError('Enter your two-factor code to finish signing in.');
      }
      // On success the root guard moves to the app on its own.
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /* ── The landing ─────────────────────────────────────────────────────────── */
  if (step === 'landing') {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.landing}>
          <View style={styles.mark}><AtweMark /></View>
          <View style={styles.actions}>
            <AuthButton
              label="Continue with Email" primary
              icon={<Ionicons name="mail-outline" size={21} color={c.onPrimary} />}
              onPress={() => go('email')}
            />
            <AuthButton
              label="Continue with Google"
              icon={<Ionicons name="logo-google" size={20} color={c.text} />}
              onPress={() => soon('Google')}
            />
            <AuthButton
              label="Continue with Apple"
              icon={<Ionicons name="logo-apple" size={21} color={c.text} />}
              onPress={() => soon('Apple')}
            />
            <AuthButton
              label="Login with username"
              icon={<Text style={{ fontSize: 19, fontWeight: '700', color: c.text }}>@</Text>}
              onPress={() => go('username')}
            />
            {!!error && <Text style={[styles.err, { color: c.danger }]}>{error}</Text>}
          </View>
          <Text style={[styles.terms, { color: c.t3 }]}>
            By continuing, you agree to our{' '}
            <Text style={{ color: c.t2 }} onPress={() => Linking.openURL('https://atwe.com/terms.html')}>Terms</Text>,{' '}
            <Text style={{ color: c.t2 }} onPress={() => Linking.openURL('https://atwe.com/privacy.html')}>Privacy Policy</Text>{' '}
            and Cookie Use.
          </Text>
        </View>
      </Screen>
    );
  }

  /* ── A step ──────────────────────────────────────────────────────────────── */
  const onPassword = step === 'password';
  const value = onPassword ? password : identifier;
  const ready = onPassword ? password.length > 0 : identifier.trim().length > 0;

  const next = async () => {
    if (!ready || busy) return;
    if (onPassword) return submit();
    if (step === 'username') { go('password'); return; }
    // Email: does this account exist?
    if (createMode) {
      router.push({ pathname: '/(auth)/signup', params: { email: identifier.trim() } });
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const r = await api.post<{ exists: boolean }>(
        '/api/auth/exists', { email: identifier.trim() }, { noAuth: true },
      );
      if (r.exists) go('password');
      else setCreateMode(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.step} keyboardShouldPersistTaps="handled">
          <View style={styles.stepbar}>
            <Pressable
              onPress={() => go(onPassword ? (identifier.includes('@') ? 'email' : 'username') : 'landing')}
              hitSlop={10} style={styles.backArrow}
              accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={30} color={c.text} />
            </Pressable>
            {onPassword && (
              <Pressable onPress={forgot} hitSlop={10} disabled={busy}
                accessibilityRole="button" accessibilityLabel="Forgot password">
                <Text style={[styles.alt, { color: c.t2 }]}>Forgot password</Text>
              </Pressable>
            )}
          </View>

          <Text style={styles.title}>
            {step === 'email' ? "What's your email?"
              : step === 'username' ? "What's your @username?"
              : 'Enter your password'}
          </Text>
          {step === 'email' && (
            <Text style={[styles.sub, { color: c.t3 }]}>
              We'll check if you already have an account.
            </Text>
          )}

          {onPassword ? (
            <>
              <Text style={styles.echo} numberOfLines={1}>
                {identifier.includes('@') ? identifier : `@${identifier}`}
              </Text>
              <View style={styles.bigField}>
                <HapticInput
                  ref={field}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPw}
                  placeholder="Password"
                  placeholderTextColor={c.t3}
                  autoComplete="current-password"
                  style={[styles.bigInput, { color: c.text }]}
                  onSubmitEditing={next}
                  accessibilityLabel="Password"
                />
                <Pressable onPress={() => setShowPw((v) => !v)} hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={showPw ? 'Hide password' : 'Show password'}>
                  <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={24} color={c.t2} />
                </Pressable>
              </View>
              {needs2fa && (
                <View style={styles.bigField}>
                  <HapticInput
                    value={code}
                    onChangeText={setCode}
                    placeholder="Authenticator or recovery code"
                    placeholderTextColor={c.t3}
                    autoComplete="one-time-code"
                    style={[styles.bigInput, { fontSize: 20, color: c.text }]}
                    onSubmitEditing={next}
                    accessibilityLabel="Two-factor code"
                  />
                </View>
              )}
            </>
          ) : (
            <View style={styles.bigField}>
              {step === 'username' && <Text style={styles.at}>@</Text>}
              <HapticInput
                ref={field}
                value={value}
                onChangeText={(t) => { setIdentifier(t); setCreateMode(false); }}
                placeholder={step === 'email' ? 'you@example.com' : 'username'}
                placeholderTextColor={c.t3}
                keyboardType={step === 'email' ? 'email-address' : 'default'}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete={step === 'email' ? 'email' : 'username'}
                style={[styles.bigInput, { color: c.text }]}
                onSubmitEditing={next}
                accessibilityLabel={step === 'email' ? 'Email address' : 'Username'}
              />
            </View>
          )}

          {!!error && <Text style={[styles.err, { color: c.danger }]}>{error}</Text>}

          {/* Pinned to the bottom on every step, so it never moves under the thumb. */}
          <View style={styles.grow} />
          {createMode && (
            <Text style={[styles.sub, { color: c.t3, marginTop: 0, marginBottom: 14 }]}>
              No account yet with that email. Want to make one?
            </Text>
          )}
          <AuthButton
            label={createMode ? 'Create an account' : 'Continue'}
            primary={ready}
            disabled={!ready || busy}
            onPress={next}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  /* The web's own panel: 28px of padding inside a 430px cap, centred. It was
     on the 14px feed gutter, which is the CONTENT gutter — right for a post
     card, wrong for a form, and it made every button run nearly edge to edge.
     On a 390 phone this is 334 wide against the 362 it was. */
  landing: {
    flex: 1, justifyContent: 'center',
    paddingHorizontal: 28, maxWidth: 430, width: '100%', alignSelf: 'center',
  },
  mark: { alignItems: 'center', marginBottom: 44 },
  // The web's landing sits its buttons a drop closer together than a step's.
  actions: { gap: 12.5 },
  terms: {
    position: 'absolute', left: spacing.gutter, right: spacing.gutter, bottom: 12,
    textAlign: 'center', fontSize: 10.5, lineHeight: 16,
  },
  step: {
    flexGrow: 1, paddingHorizontal: 28, paddingBottom: 26,
    maxWidth: 430, width: '100%', alignSelf: 'center',
  },
  stepbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    height: 50, marginBottom: 24,
  },
  // Pulled left so the CHEVRON's ink lands on the gutter, not its 48pt box.
  backArrow: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginLeft: -14 },
  alt: { fontSize: 15, fontWeight: '600' },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.9, lineHeight: 35, marginBottom: 30 },
  sub: { fontSize: 15, lineHeight: 22, marginTop: -18, marginBottom: 26 },
  echo: { fontSize: 26, fontWeight: '500', marginBottom: 12 },
  bigField: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    minHeight: 43, paddingVertical: 6, marginBottom: 18,
  },
  at: { fontSize: 26, fontWeight: '500' },
  bigInput: { flex: 1, minWidth: 0, fontSize: 26, fontWeight: '500', padding: 0 },
  err: { fontSize: 13.5, fontWeight: '600', lineHeight: 19, marginTop: 4 },
  grow: { flex: 1, minHeight: 24 },
});
