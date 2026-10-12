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

        <p className="mb-3 text-[12.5px] leading-relaxed text-white/60">
          We sent a 6-digit code to <span className="text-white/90">{pending.destination}</span>. It expires in{' '}
          {Math.round(pending.expiresInSeconds / 60)} minutes.
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
        </div>

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

      {notice ? <p className="mt-2 text-[12px] text-white/60">{notice}</p> : null}
      {error ? <p className="mt-2 text-[12px]" style={{ color: '#FF8080' }}>{error}</p> : null}
    </div>
  );
}

export default SignInPanel;
