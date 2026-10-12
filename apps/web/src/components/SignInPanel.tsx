/**
 * MoneyMart web — passwordless sign-in (§9.1).
 *
 * Two steps: request a code for an email address or phone number, then enter it.
 * The panel reports what actually happened rather than assuming success — when no
 * delivery provider is configured the API says so, and the panel surfaces that
 * instead of telling the user to check an inbox that will stay empty.
 */
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/store/session';
import { api } from '@/lib/api';
import { Button, Pill } from '@/components/ui';
import { CheckIcon, ShieldIcon } from '@/components/icons';

type Step = 'identifier' | 'code';

export function SignInPanel({ onDone }: { onDone?: () => void }) {
  const { pending, busy, error, requestCode, verifyCode, cancelChallenge } = useSession();
  const [step, setStep] = useState<Step>(pending ? 'code' : 'identifier');
  const [identifier, setIdentifier] = useState(pending?.identifier ?? '');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement | null>(null);
  /**
   * Which social providers this deployment can actually complete a sign-in with.
   *
   * Fetched rather than hardcoded: offering a Google button on a deployment with
   * no client ID gives the user a dead end, and the same component ships to every
   * environment.
   */
  const [providers, setProviders] = useState<{ id: string; label: string; configured: boolean }[]>([]);
  const [socialBusy, setSocialBusy] = useState<string | null>(null);

  /**
   * Resend cooldown, in seconds.
   *
   * A code that never arrives is the most common sign-in problem, so a resend must
   * exist. The API allows five per identifier per fifteen minutes, so the button is
   * held back for a minute at a time — long enough for a slow message to land, and
   * short enough to be useful. Offering a resend the API will refuse would be worse
   * than not offering one.
   */
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((seconds) => (seconds <= 1 ? 0 : seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    let cancelled = false;
    void api
      .oauthProviders()
      .then((result) => {
        if (!cancelled) setProviders((result.providers ?? []).filter((provider) => provider.configured));
      })
      .catch(() => {
        // A failure here must not block the passwordless path.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Start a social sign-in.
   *
   * A full-page redirect rather than a popup: the provider needs to post back to
   * our callback, popups are commonly blocked, and the mobile shell would open a
   * system browser anyway. The session token comes back in the URL fragment, which
   * the browser never sends to a server.
   */
  const startSocial = async (provider: string) => {
    setSocialBusy(provider);
    setNotice(null);
    try {
      const { url } = await api.startOAuth(provider, window.location.pathname || '/settings');
      window.location.assign(url);
    } catch (cause) {
      setSocialBusy(null);
      setNotice(
        `${provider} sign-in is unavailable right now.${cause instanceof Error && cause.message ? ` (${cause.message})` : ''}`,
      );
    }
  };

  // Move focus to the code field as soon as it appears, so the whole flow is
  // keyboard-completable without hunting for the input.
  useEffect(() => {
    if (step === 'code') codeInput.current?.focus();
  }, [step]);

  const sendCode = async () => {
    setNotice(null);
    const sent = await requestCode(identifier.trim());
    if (!sent) return;
    setStep('code');
    setCode('');
    setCooldown(60);
  };

  /** Send again to the address already in flight, without leaving the code step. */
  const resendCode = async () => {
    if (!pending || cooldown > 0) return;
    setNotice(null);
    const sent = await requestCode(pending.identifier);
    if (!sent) return;
    setCode('');
    setCooldown(60);
    setNotice(`A new code is on its way to ${pending.destination}. The previous one no longer works.`);
    codeInput.current?.focus();
  };

  const submitCode = async () => {
    const accepted = await verifyCode(code.replace(/\D/g, ''));
    if (accepted) {
      onDone?.();
      return;
    }
    setCode('');
  };

  // Once a challenge exists the store is the source of truth, so keep the step in
  // sync if it is cleared elsewhere (for example by signing out).
  useEffect(() => {
    if (!pending && step === 'code') setStep('identifier');
  }, [pending, step]);

  if (step === 'code' && pending) {
    return (
      <div className="w-full max-w-[380px]">
        <div className="mb-3 flex items-center gap-2">
          <ShieldIcon size={15} />
          <span className="text-[13px] font-semibold text-white">Enter your code</span>
        </div>

        {/*
          The headline must match reality. Saying "we sent a code" and only then
          admitting nothing was sent contradicts itself in consecutive sentences —
          which is what this did before.
        */}
        <p className="mb-3 text-[12.5px] leading-relaxed text-white/60">
          {pending.delivery.delivered ? (
            <>
              We sent a 6-digit code to <span className="text-white/90">{pending.destination}</span>. It expires in{' '}
              {Math.round(pending.expiresInSeconds / 60)} minutes.
            </>
          ) : (
            <>
              A 6-digit code was generated for <span className="text-white/90">{pending.destination}</span>. It expires
              in {Math.round(pending.expiresInSeconds / 60)} minutes.
            </>
          )}
        </p>

        {/* Say plainly when no message was actually sent, rather than implying one was. */}
        {!pending.delivery.delivered ? (
          <div
            className="mb-3 rounded-[11px] border px-3 py-2"
            style={{ borderColor: 'rgba(245,166,35,0.35)', background: 'rgba(245,166,35,0.08)' }}
          >
            <span className="text-[11.5px] leading-relaxed text-white/75">
              {pending.delivery.transport === 'log'
                ? 'No email or SMS provider is configured, so no message was sent.'
                : `Delivery failed (${pending.delivery.detail ?? pending.delivery.transport}).`}
              {pending.devCode ? ' Use the code shown below.' : ''}
            </span>
            {pending.devCode ? (
              <p className="data mt-1.5 text-[15px] font-bold" style={{ color: 'var(--mm-gold)' }}>
                {pending.devCode}
              </p>
            ) : null}
          </div>
        ) : null}

        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
          Code
        </label>
        <input
          ref={codeInput}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && code.length === 6) void submitCode();
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          className="data w-full rounded-[11px] border border-white/12 bg-white/[0.04] px-3 py-2.5 text-center text-[20px] tracking-[0.32em] text-white placeholder:text-white/25 focus:border-[var(--mm-gold-line)] focus:outline-none"
        />

        <div className="mt-3 flex items-center gap-2">
          <Button variant="gold" loading={busy} disabled={code.length !== 6} onClick={() => void submitCode()}>
            Verify
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              cancelChallenge();
              setStep('identifier');
              setNotice(null);
            }}
          >
            Use a different address
          </Button>
          {/* Only offered when a message actually went out: resending into a void
              would just burn the rate limit. */}
          {pending.delivery.delivered ? (
            <Button variant="ghost" loading={busy} disabled={cooldown > 0} onClick={() => void resendCode()}>
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </Button>
          ) : null}
        </div>

        {/* The usual reason a delivered code is not found, said before the user
            concludes the platform is broken. */}
        {pending.delivery.delivered && step === 'code' ? (
          <p className="mt-2 text-[11.5px] leading-relaxed text-white/40">
            Nothing yet? Check your spam folder — codes sometimes land there. The code stays valid for{' '}
            {Math.round(pending.expiresInSeconds / 60)} minutes.
          </p>
        ) : null}

        {notice ? <p className="mt-2 text-[12px] text-white/60">{notice}</p> : null}
        {error ? <p className="mt-2 text-[12px]" style={{ color: '#FF8080' }}>{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="w-full max-w-[380px]">
      <div className="mb-2 flex items-center gap-2">
        <ShieldIcon size={15} />
        <span className="text-[13px] font-semibold text-white">Sign in to MoneyMart</span>
      </div>
      <p className="mb-3 text-[12.5px] leading-relaxed text-white/55">
        No password. We send a one-time code to your email address or phone number, which is what proves the account is
        yours.
      </p>

      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
        Email or phone
      </label>
      <input
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && identifier.trim()) void sendCode();
        }}
        autoComplete="email"
        placeholder="you@example.com or +234 801 234 5678"
        className="w-full rounded-[11px] border border-white/12 bg-white/[0.04] px-3 py-2.5 text-[13.5px] text-white placeholder:text-white/25 focus:border-[var(--mm-gold-line)] focus:outline-none"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="gold" loading={busy} disabled={!identifier.trim()} onClick={() => void sendCode()}>
          Send code
        </Button>
        <Pill tone="neutral">
          <CheckIcon size={11} />
          No password stored
        </Pill>
      </div>

      {/*
        Social providers are offered only when the deployment can complete the
        exchange, so a button is never a dead end. When none are configured the
        block is omitted entirely rather than shown disabled — a disabled button
        with no explanation is worse than no button.
      */}
      {providers.length ? (
        <div className="mt-5 border-t border-white/8 pt-4">
          <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/35">Or continue with</div>
          <div className="flex flex-wrap gap-2">
            {providers.map((provider) => (
              <Button
                key={provider.id}
                variant="ghost"
                loading={socialBusy === provider.id}
                disabled={socialBusy !== null}
                onClick={() => void startSocial(provider.id)}
              >
                {provider.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {notice ? <p className="mt-2 text-[12px] text-white/60">{notice}</p> : null}
      {error ? <p className="mt-2 text-[12px]" style={{ color: '#FF8080' }}>{error}</p> : null}
    </div>
  );
}

export default SignInPanel;
