/**
 * Sign Up / Sign In — blueprint §5.2.
 * Email + password with real-time validation, social SSO row, and a phone-number
 * OTP toggle (6-digit code, 60-second expiry).
 */
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Button, Card, Data, Display, Pill } from '@/components/ui';
import { CheckIcon, GlobeIcon, ShieldIcon } from '@/components/icons';
import { colors, fonts, radii } from '@/theme';
import { useSession } from '@/store/session';

type Mode = 'signin' | 'signup' | 'otp';

export default function AuthScreen({ navigation }: { navigation: any }) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* Real-time validation (§5.2) */
  const emailValid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), [email]);
  const passwordValid = password.length >= 8;
  /**
   * What the submit button requires.
   *
   * SIGN-IN is passwordless: `submit()` sends a code for a valid address and never reads
   * the password, yet this required one — so with a valid email the button was
   * permanently DISABLED. A disabled control ignores taps, which is why the app looked
   * like it was refusing to send a code. Sign-in was unreachable in the shipped app.
   *
   * Sign-up still requires a password, because that flow sets one.
   */
  const canSubmit =
    mode === 'otp' ? otp.length === 6 : mode === 'signup' ? emailValid && passwordValid : emailValid;

  const requestCode = useSession((state) => state.requestCode);
  const verifyCode = useSession((state) => state.verifyCode);
  const pending = useSession((state) => state.pending);

  /**
   * Send a code.
   *
   * The previous version switched to the OTP screen locally and accepted any six
   * digits — the code was never requested from or checked by the server, so the
   * "verification" was theatre. It now asks the API and only advances once the
   * request succeeded.
   */
  const startOtp = async () => {
    setError(null);
    setBusy(true);
    const identifier = mode === 'otp' ? (pending?.identifier ?? email.trim()) : email.trim();
    const sent = await requestCode(identifier);
    setBusy(false);
    if (!sent) return;
    setMode('otp');
    setSecondsLeft(60);
    const timer = setInterval(() => {
      setSecondsLeft((value) => {
        if (value <= 1) {
          clearInterval(timer);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
  };

  const submit = async () => {
    setError(null);

    if (mode === 'otp') {
      if (otp.length !== 6) {
        setError('Enter the 6-digit code we sent you.');
        return;
      }
      setBusy(true);
      const accepted = await verifyCode(otp);
      setBusy(false);
      if (!accepted) {
        setOtp('');
        setError(useSession.getState().error ?? 'That code was not accepted.');
        return;
      }
      // The token is stored by the store; onboarding continues from here.
      navigation.navigate('ProfileSetup');
      return;
    }

    if (!emailValid) {
      setError('Enter a valid email address.');
      return;
    }

    /**
     * Passwordless: a valid address is enough to start. The password field is
     * retained for continuity but no longer gates entry, because no password is
     * ever set on the account.
     */
    await startOtp();
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Display size={30}>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</Display>
        <Body size={13.5} color={colors.ink2} style={styles.subtitle}>
          {mode === 'otp'
            ? `Enter the 6-digit code sent to your phone. ${secondsLeft > 0 ? `Expires in ${secondsLeft}s.` : 'Code expired — resend.'}`
            : 'Sign in with email, Google, Apple or Facebook. Phone OTP is available if you prefer.'}
        </Body>

        <View style={styles.toggleRow}>
          {(['signin', 'signup'] as const).map((entry) => (
            <Pressable
              key={entry}
              onPress={() => {
                setMode(entry);
                setError(null);
              }}
              style={[styles.toggle, mode === entry ? styles.toggleActive : null]}
            >
              <Body size={13} weight="semibold" color={mode === entry ? colors.gold : colors.ink2}>
                {entry === 'signin' ? 'Sign in' : 'Sign up'}
              </Body>
            </Pressable>
          ))}
        </View>

        {mode === 'otp' ? (
          <>
            <Body size={10.5} weight="semibold" color={colors.ink3} style={styles.label}>
              VERIFICATION CODE
            </Body>
            <TextInput
              value={otp}
              onChangeText={(text) => setOtp(text.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              placeholder="000000"
              placeholderTextColor={colors.ink3}
              style={[styles.input, styles.otpInput]}
              maxLength={6}
            />
            <Pressable onPress={startOtp} disabled={secondsLeft > 0}>
              <Body size={12.5} weight="semibold" color={secondsLeft > 0 ? colors.ink3 : colors.gold} style={styles.resend}>
                {secondsLeft > 0 ? `Resend available in ${secondsLeft}s` : 'Resend code'}
              </Body>
            </Pressable>
          </>
        ) : (
          <>
            <Body size={10.5} weight="semibold" color={colors.ink3} style={styles.label}>
              EMAIL
            </Body>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor={colors.ink3}
              style={[styles.input, email.length > 0 && !emailValid ? styles.inputError : null]}
            />
            {email.length > 0 && !emailValid ? (
              <Body size={11} color="#FF8080" style={styles.helper}>
                That does not look like a valid email address.
              </Body>
            ) : null}

            <Body size={10.5} weight="semibold" color={colors.ink3} style={styles.label}>
              PASSWORD
            </Body>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="At least 8 characters"
              placeholderTextColor={colors.ink3}
              style={[styles.input, password.length > 0 && !passwordValid ? styles.inputError : null]}
            />
            <View style={styles.strengthRow}>
              {[1, 2, 3, 4].map((step) => (
                <View
                  key={step}
                  style={[
                    styles.strengthBar,
                    password.length >= step * 2
                      ? { backgroundColor: password.length >= 8 ? colors.green : colors.gold }
                      : null,
                  ]}
                />
              ))}
              <Body size={11} color={colors.ink3} style={styles.strengthLabel}>
                {password.length >= 12 ? 'Strong' : password.length >= 8 ? 'Good' : 'Too short'}
              </Body>
            </View>

            <Pressable onPress={startOtp} style={styles.phoneToggle}>
              <GlobeIcon size={14} color={colors.gold} />
              <Body size={12.5} weight="semibold" color={colors.gold}>
                Use phone number instead
              </Body>
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Body size={11} color={colors.ink3}>
                or continue with
              </Body>
              <View style={styles.dividerLine} />
            </View>

            {/*
              Social sign-in is not connected. It previously signed the user in as
              a hard-coded demo account, which is a fabricated identity assertion
              rather than authentication. Disabled and labelled honestly until a
              provider is wired.
            */}
            <View style={styles.ssoRow}>
              {['Google', 'Apple', 'Facebook'].map((provider) => (
                <Pressable
                  key={provider}
                  disabled
                  accessibilityState={{ disabled: true }}
                  onPress={() => setError(`${provider} sign-in is not connected yet. Use an email or phone code.`)}
                  style={[styles.ssoButton, { opacity: 0.4 }]}
                >
                  <Body size={12.5} weight="semibold" color={colors.ink}>
                    {provider}
                  </Body>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {error ? (
          <Card style={styles.errorCard}>
            <Body size={12.5} color="#FF8080">
              {error}
            </Body>
          </Card>
        ) : null}

        {mode !== 'otp' ? (
          <Body size={11.5} color={colors.ink3} style={styles.terms}>
            By continuing you agree to the MoneyMart Terms of Service and Privacy Policy. You must be 18 or over to
            bid.
          </Body>
        ) : null}

        <View style={styles.actions}>
          <Button
            label={mode === 'signup' ? 'Create account' : mode === 'otp' ? 'Verify code' : 'Sign in'}
            variant="gold"
            size="lg"
            full
            loading={busy}
            disabled={!canSubmit}
            onPress={() => void submit()}
          />
          {mode === 'otp' ? (
            <Button label="Back to email" variant="ghost" onPress={() => setMode('signin')} />
          ) : null}
        </View>

        <View style={styles.assurance}>
          <Pill tone="green">
            <ShieldIcon size={11} color={colors.green} />
            <Body size={10.5} weight="semibold" color={colors.green}>
              Escrow protected
            </Body>
          </Pill>
          <Pill tone="gold">
            <CheckIcon size={11} color={colors.gold} />
            <Body size={10.5} weight="semibold" color={colors.gold}>
              Demo identity switching
            </Body>
          </Pill>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: 22 },
  subtitle: { marginTop: 10, marginBottom: 22, lineHeight: 21 },
  toggleRow: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: radii.md ,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginBottom: 22,
  },
  toggle: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radii.sm },
  toggleActive: { backgroundColor: colors.goldSoft },
  label: { letterSpacing: 1.4, marginBottom: 8, marginTop: 4 },
  input: {
    height: 52,
    borderRadius: radii.md ,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 15,
    color: colors.ink,
    fontSize: 15,
  },
  inputError: { borderColor: 'rgba(229,62,62,0.5)' },
  otpInput: { fontFamily: fonts.data, fontSize: 26, letterSpacing: 12, textAlign: 'center' },
  helper: { marginTop: 6 },
  resend: { marginTop: 12, textAlign: 'center' },
  strengthRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  strengthBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)' },
  strengthLabel: { marginLeft: 8, minWidth: 62 },
  phoneToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.divider },
  ssoRow: { flexDirection: 'row', gap: 10 },
  ssoButton: {
    flex: 1,
    height: 46,
    borderRadius: radii.md ,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorCard: { marginTop: 18, borderColor: 'rgba(229,62,62,0.4)', backgroundColor: 'rgba(229,62,62,0.1)' },
  terms: { marginTop: 16, lineHeight: 17 },
  actions: { marginTop: 22, gap: 10 },
  assurance: { flexDirection: 'row', gap: 8, marginTop: 20, justifyContent: 'center' },
});
