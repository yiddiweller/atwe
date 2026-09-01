import { useEffect, useRef, useState } from 'react';
import {
  View, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { AuthButton } from '@/components/AuthButton';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { useAuth } from '@/auth/AuthProvider';
import { startSignup, checkSignupCode, resendSignupCode } from '@/api/signup';

/**
 * Making an account — the web's wizard, step for step, in the web's design: a
 * back arrow, one question, one big borderless field, and Continue pinned to
 * the bottom so it never moves under the thumb.
 *
 * The order is the server's, and it is the order for a reason: the EMAIL is
 * proved first, so nobody fills in a whole form and is only then told the
 * address was already taken or mistyped.
 *
 *   kind → email → code → date of birth → name → password → @username
 *
 * What kind of account comes first because it changes what the questions MEAN:
 * "your name" is a person or a business, and asking afterwards would mean
 * somebody answering the wrong question and being corrected.
 */
type Step = 'kind' | 'email' | 'code' | 'dob' | 'name' | 'password' | 'username';
const ORDER: Step[] = ['kind', 'email', 'code', 'dob', 'name', 'password', 'username'];

export default function Signup() {
  const { c } = useTheme();
  const { signup } = useAuth();
  const params = useLocalSearchParams<{ email?: string }>();

  const [step, setStep] = useState<Step>('kind');
  const [accountType, setAccountType] = useState<'personal' | 'business'>('personal');
  // Arriving from the login screen's "no account with that email" branch, the
  // address is already typed — do not make them type it twice.
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [dob, setDob] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<TextInput>(null);

  useEffect(() => {
    if (step === 'kind') return;
    const t = setTimeout(() => field.current?.focus(), 220);
    return () => clearTimeout(t);
  }, [step]);

  const go = (s: Step) => { setError(null); setStep(s); };
  const back = () => {
    const i = ORDER.indexOf(step);
    if (i <= 0) { router.back(); return; }
    go(ORDER[i - 1]);
  };

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const dobOk = /^\d{4}-\d{2}-\d{2}$/.test(dob.trim());
  const ready =
    step === 'kind' ? true
    : step === 'email' ? emailOk
    : step === 'code' ? /^\d{6}$/.test(code.trim())
    : step === 'dob' ? dobOk
    : step === 'name' ? name.trim().length > 0
    : step === 'password' ? password.length >= 8
    : true;   // a handle is optional, and can be chosen later

  const next = async () => {
    if (!ready || busy) return;
    setError(null);
    if (step === 'kind') return go('email');
    if (step === 'dob') return go('name');
    if (step === 'name') return go('password');
    if (step === 'password') return go('username');

    setBusy(true);
    try {
      if (step === 'email') { await startSignup(email.trim()); go('code'); }
      else if (step === 'code') { await checkSignupCode(email.trim(), code.trim()); go('dob'); }
      else if (step === 'username') {
        await signup({
          email: email.trim(), code: code.trim(), name: name.trim(), password,
          dob: dob.trim(), accountType,
          ...(username.trim() ? { username: username.trim().replace(/^@/, '') } : {}),
        });
        // The root guard moves to the app once there is a session.
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try { await resendSignupCode(email.trim()); setError('A new code is on its way.'); }
    catch (e) { setError((e as Error).message); }
  };

  const title =
    step === 'kind' ? 'What kind of account?'
    : step === 'email' ? "What's your email?"
    : step === 'code' ? 'Check your email'
    : step === 'dob' ? "When's your birthday?"
    : step === 'name' ? (accountType === 'business' ? "What's the business called?" : "What's your name?")
    : step === 'password' ? 'Pick a password'
    : 'Choose your @username';

  const sub =
    step === 'code' ? `We sent a six-digit code to ${email.trim()}.`
    : step === 'dob' ? 'This is never shown on your profile.'
    : step === 'password' ? 'At least 8 characters.'
    : step === 'username' ? 'People find you at atwe.com/yourname. You can change it later.'
    : null;

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.step} keyboardShouldPersistTaps="handled">
          <View style={styles.stepbar}>
            <Pressable onPress={back} hitSlop={10} style={styles.backArrow}
              accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={30} color={c.text} />
            </Pressable>
            {step === 'code' && (
              <Pressable onPress={resend} hitSlop={10}
                accessibilityRole="button" accessibilityLabel="Send a new code">
                <Text style={[styles.alt, { color: c.t2 }]}>Send again</Text>
              </Pressable>
            )}
          </View>

          <Text style={styles.title}>{title}</Text>
          {!!sub && <Text style={[styles.sub, { color: c.t3 }]}>{sub}</Text>}

          {step === 'kind' ? (
            <View style={{ gap: 12 }}>
              {(['personal', 'business'] as const).map((k) => (
                <Pressable
                  key={k}
                  onPress={() => setAccountType(k)}
                  style={[styles.kind, {
                    backgroundColor: c.s1,
                    borderColor: accountType === k ? c.accent : 'transparent',
                  }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: accountType === k }}
                >
                  <Ionicons
                    name={k === 'business' ? 'business-outline' : 'person-outline'}
                    size={22} color={accountType === k ? c.accent : c.t2}
                  />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text variant="headline">{k === 'business' ? 'A business' : 'Just me'}</Text>
                    <Text variant="caption" tone="t3">
                      {k === 'business'
                        ? 'Sell, take bookings, hire — a business IS its account on Atwe.'
                        : 'Post, message, buy and get paid.'}
                    </Text>
                  </View>
                  <Ionicons
                    name={accountType === k ? 'radio-button-on' : 'radio-button-off'}
                    size={20} color={accountType === k ? c.accent : c.t3}
                  />
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.bigField}>
              {step === 'username' && <Text style={styles.at}>@</Text>}
              <TextInput
                ref={field}
                value={
                  step === 'email' ? email : step === 'code' ? code : step === 'dob' ? dob
                  : step === 'name' ? name : step === 'password' ? password : username
                }
                onChangeText={
                  step === 'email' ? setEmail : step === 'code' ? setCode : step === 'dob' ? setDob
                  : step === 'name' ? setName : step === 'password' ? setPassword : setUsername
                }
                placeholder={
                  step === 'email' ? 'you@example.com'
                  : step === 'code' ? '123456'
                  : step === 'dob' ? 'YYYY-MM-DD'
                  : step === 'name' ? (accountType === 'business' ? 'Fern & Fold' : 'Your name')
                  : step === 'password' ? 'Password'
                  : 'username'
                }
                placeholderTextColor={c.t3}
                secureTextEntry={step === 'password' && !showPw}
                keyboardType={
                  step === 'email' ? 'email-address'
                  : step === 'code' ? 'number-pad'
                  : 'default'
                }
                maxLength={step === 'code' ? 6 : step === 'dob' ? 10 : undefined}
                autoCapitalize={step === 'name' ? 'words' : 'none'}
                autoCorrect={false}
                autoComplete={
                  step === 'email' ? 'email'
                  : step === 'code' ? 'one-time-code'
                  : step === 'name' ? 'name'
                  : step === 'password' ? 'new-password'
                  : step === 'username' ? 'username'
                  : 'off'
                }
                style={[styles.bigInput, { color: c.text }]}
                onSubmitEditing={next}
                accessibilityLabel={title}
              />
              {step === 'password' && (
                <Pressable onPress={() => setShowPw((v) => !v)} hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={showPw ? 'Hide password' : 'Show password'}>
                  <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={24} color={c.t2} />
                </Pressable>
              )}
            </View>
          )}

          {!!error && <Text style={[styles.err, { color: c.danger }]}>{error}</Text>}

          <View style={styles.grow} />
          <AuthButton
            label={step === 'username' ? (username.trim() ? 'Create account' : 'Skip for now') : 'Continue'}
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
  step: { flexGrow: 1, paddingHorizontal: spacing.gutter, paddingBottom: 26 },
  stepbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    height: 50, marginBottom: 24,
  },
  backArrow: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginLeft: -14 },
  alt: { fontSize: 15, fontWeight: '600' },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.9, lineHeight: 35, marginBottom: 30 },
  sub: { fontSize: 15, lineHeight: 22, marginTop: -18, marginBottom: 26 },
  bigField: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    minHeight: 43, paddingVertical: 6, marginBottom: 18,
  },
  at: { fontSize: 26, fontWeight: '500' },
  bigInput: { flex: 1, minWidth: 0, fontSize: 26, fontWeight: '500', padding: 0 },
  kind: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: radius.card, padding: 16, borderWidth: 1.5,
  },
  err: { fontSize: 13.5, fontWeight: '600', lineHeight: 19, marginTop: 4 },
  grow: { flex: 1, minHeight: 24 },
});
