/**
 * Settings — blueprint §5.2 Settings screen and §3.2 global platform features.
 * Language, currency display, granular notification preferences, privacy,
 * linked payment methods and identity verification.
 */

import { useState } from 'react';
import { PageHeader, Section } from '@/components/site-shell';
import { Button, Card, Pill, Toast, ToastStack, VerifiedBadge } from '@/components/ui';
import { CheckIcon, GlobeIcon, SettingsIcon, ShieldIcon, TruckIcon, WalletIcon } from '@/components/icons';
import { currency as currencyMeta, type CurrencyCode } from '@moneymart/tokens';
import { useSession } from '@/store/session';

const LANGUAGES = ['English', 'Yoruba', 'Igbo', 'Hausa', 'Français', 'Kiswahili', 'العربية'];

const NOTIFICATION_TYPES = [
  { key: 'outbid', label: 'Outbid alerts', hint: 'Within 1 second of being outbid', on: true },
  { key: 'streamStart', label: 'Stream start', hint: 'When a followed creator goes live', on: true },
  { key: 'endingSoon', label: 'Ending soon', hint: 'Lots on your watchlist closing in 15 minutes', on: true },
  { key: 'orderUpdates', label: 'Order updates', hint: 'Payment, shipment and delivery', on: true },
  { key: 'priceDrops', label: 'Price drops', hint: 'Marketplace listings you watched', on: false },
  { key: 'marketing', label: 'Product news', hint: 'Occasional platform announcements', on: false },
];

export default function SettingsPage() {
  const user = useSession((state) => state.user);
  const profile = useSession((state) => state.profile);
  const switchUser = useSession((state) => state.switchUser);
  const users = useSession((state) => state.users);

  const [language, setLanguage] = useState('English');
  const [currency, setCurrency] = useState<CurrencyCode>((user?.currencyCode as CurrencyCode) ?? 'USD');
  const [toggles, setToggles] = useState<Record<string, boolean>>(
    Object.fromEntries(NOTIFICATION_TYPES.map((entry) => [entry.key, entry.on])),
  );
  const [publicProfile, setPublicProfile] = useState(true);
  const [bidHistoryVisible, setBidHistoryVisible] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Section>
      <PageHeader
        eyebrow="Settings"
        title="Account, locale and preferences"
        subtitle="Currency defaults from your geography but can always be overridden here. Notification preferences are granular — nothing is all-or-nothing."
        action={profile?.isVerified ? <VerifiedBadge /> : <Pill tone="gold">KYC level {user?.kycLevel ?? 0}</Pill>}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Locale */}
        <Card className="p-5">
          <h3 className="mb-1.5 flex items-center gap-2 text-[16px] text-white">
            <GlobeIcon size={16} /> Language & currency
          </h3>
          <p className="mb-4 text-[12.5px] text-white/55">
            MoneyMart runs localised storefronts with RTL layout support for Arabic.
          </p>

          <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Language</label>
          <select
            value={language}
            onChange={(event) => {
              setLanguage(event.target.value);
              setMessage(`Interface language set to ${event.target.value}. Translation catalogue loads on next navigation.`);
            }}
            className="mt-2 w-full rounded-[12px] border border-white/10 bg-[#0F1E2E] px-3.5 py-3 text-[14px] outline-none"
          >
            {LANGUAGES.map((entry) => (
              <option key={entry}>{entry}</option>
            ))}
          </select>

          <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
            Display currency
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {Object.values(currencyMeta).map((entry) => (
              <button
                key={entry.code}
                type="button"
                onClick={() => {
                  setCurrency(entry.code as CurrencyCode);
                  setMessage(`Prices now display in ${entry.code}. FX rates refresh on each quote.`);
                }}
                className="flex items-center gap-2 rounded-[11px] border px-3 py-2.5 text-left transition-all"
                style={{
                  borderColor: currency === entry.code ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.09)',
                  background: currency === entry.code ? 'rgba(245,166,35,0.1)' : 'rgba(255,255,255,0.02)',
                }}
              >
                <span aria-hidden>{entry.flag}</span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-white/90">{entry.code}</span>
                  <span className="block text-[10.5px] text-white/45">{entry.label}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>

        {/* Notifications */}
        <Card className="p-5">
          <h3 className="mb-4 text-[16px] text-white">Notification preferences</h3>
          <ul className="space-y-2">
            {NOTIFICATION_TYPES.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  onClick={() => setToggles((current) => ({ ...current, [entry.key]: !current[entry.key] }))}
                  className="flex w-full items-center justify-between gap-4 rounded-[11px] border border-white/8 px-3.5 py-3 text-left transition-colors"
                  style={{ background: 'rgba(255,255,255,0.02)' }}
                >
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-white/90">{entry.label}</span>
                    <span className="block text-[11.5px] text-white/45">{entry.hint}</span>
                  </span>
                  <span
                    className="relative h-[22px] w-[40px] shrink-0 rounded-full transition-colors"
                    style={{ background: toggles[entry.key] ? 'var(--mm-green)' : 'rgba(255,255,255,0.14)' }}
                  >
                    <span
                      className="absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all"
                      style={{ left: toggles[entry.key] ? 21 : 3 }}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="navy"
            className="mt-4"
            onClick={() => setMessage('Notification preferences saved. Delivery channels: push (FCM), email (SendGrid), SMS fallback (Twilio).')}
            icon={<CheckIcon size={14} />}
          >
            Save preferences
          </Button>
        </Card>

        {/* Privacy */}
        <Card className="p-5">
          <h3 className="mb-1.5 flex items-center gap-2 text-[16px] text-white">
            <ShieldIcon size={16} /> Privacy
          </h3>
          <p className="mb-4 text-[12.5px] text-white/55">
            NDPR, CCPA, UK GDPR and PIPEDA apply depending on your registered country. Export or delete your data at
            any time.
          </p>
          <PrivacyRow label="Public profile" hint="Anyone can view your shop and listings" on={publicProfile} onToggle={() => setPublicProfile((value) => !value)} />
          <PrivacyRow label="Show my bids publicly" hint="Bid history stays anonymised either way" on={bidHistoryVisible} onToggle={() => setBidHistoryVisible((value) => !value)} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="navy" onClick={() => setMessage('Data export requested — you will receive a JSON archive by email within 30 days.')}>
              Export my data
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMessage('Account deletion requires email confirmation. No data is removed until you confirm.')}>
              Delete account
            </Button>
          </div>
        </Card>

        {/* Payments + KYC */}
        <Card className="p-5">
          <h3 className="mb-4 flex items-center gap-2 text-[16px] text-white">
            <WalletIcon size={16} /> Payment methods & identity
          </h3>

          <ul className="space-y-2.5">
            <MethodRow title="Stripe — Visa •••• 4242" detail="USD, GBP, CAD · default for checkout" active />
            <MethodRow title="Paystack — NGN settlement" detail="Bank transfer and USSD rails" />
            <MethodRow title="Mobile money" detail="M-Pesa, MTN MoMo, Airtel Money" />
          </ul>

          <div className="mt-5 rounded-[12px] border p-3.5" style={{ borderColor: 'var(--mm-border)', background: 'rgba(245,166,35,0.07)' }}>
            <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-white/75">
              <ShieldIcon size={15} />
              Identity verification: level {user?.kycLevel ?? 0} ({user?.verificationStatus ?? 'unverified'}). High-value
              lots and payouts above threshold require level 2+.
            </p>
            <Button size="sm" variant="gold" className="mt-3" onClick={() => setMessage('Identity upload flow opens here — document capture, then a selfie liveness check.')}>
              Complete verification
            </Button>
          </div>

          <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--mm-divider)' }}>
            <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
              <SettingsIcon size={13} /> Demo identity
            </p>
            <p className="mb-3 text-[12px] text-white/50">
              Switch the acting user to explore buyer, seller and creator flows against live data.
            </p>
            <div className="flex flex-wrap gap-2">
              {users.slice(0, 6).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => void switchUser(entry.id)}
                  className="rounded-full border px-3 py-1.5 text-[12px] transition-colors"
                  style={{
                    borderColor: entry.id === user?.id ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.1)',
                    background: entry.id === user?.id ? 'rgba(245,166,35,0.12)' : 'transparent',
                    color: entry.id === user?.id ? 'var(--mm-gold)' : 'rgba(255,255,255,0.7)',
                  }}
                >
                  {entry.displayName.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* Shipping */}
        <Card className="p-5 lg:col-span-2">
          <h3 className="mb-1.5 flex items-center gap-2 text-[16px] text-white">
            <TruckIcon size={16} /> Shipping & duties
          </h3>
          <p className="mb-4 text-[12.5px] text-white/55">
            Cross-border shipping integrates DHL, FedEx and local couriers (GIG Logistics in Nigeria, Sendle in
            Canada). Duties and VAT are calculated at checkout above declared thresholds.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <ShippingCard country="Nigeria" couriers="GIG Logistics · DHL" note="VAT 7.5% · BVN required for payouts" />
            <ShippingCard country="USA" couriers="FedEx · UPS · USPS" note="State sales tax via Avalara · 1099-K reporting" />
            <ShippingCard country="UK / Canada" couriers="DHL · Royal Mail · Canada Post" note="VAT 20% UK · GST/HST by province" />
          </div>
        </Card>
      </div>

      <p className="mt-6 text-[11.5px] leading-relaxed text-white/35">
        Compliance architecture: NDPR (Nigeria) · CCPA (California) · UK GDPR & Data Protection Act 2018 · PIPEDA and
        Quebec Law 25. Auction-specific rules: FCCPC consumer protection, FTC auction guides, Consumer Rights Act
        2015, and provincial auction acts. This platform is a technology product, not legal advice — retain
        qualified counsel in each operating jurisdiction before launch.
      </p>

      <ToastStack>
        {message ? <Toast tone="green" title="Settings" body={message} onDismiss={() => setMessage(null)} /> : null}
      </ToastStack>
    </Section>
  );
}

function PrivacyRow({ label, hint, on, onToggle }: { label: string; hint: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mb-2 flex w-full items-center justify-between gap-4 rounded-[11px] border border-white/8 px-3.5 py-3 text-left"
      style={{ background: 'rgba(255,255,255,0.02)' }}
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-white/90">{label}</span>
        <span className="block text-[11.5px] text-white/45">{hint}</span>
      </span>
      <span
        className="relative h-[22px] w-[40px] shrink-0 rounded-full transition-colors"
        style={{ background: on ? 'var(--mm-green)' : 'rgba(255,255,255,0.14)' }}
      >
        <span className="absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all" style={{ left: on ? 21 : 3 }} />
      </span>
    </button>
  );
}

function MethodRow({ title, detail, active = false }: { title: string; detail: string; active?: boolean }) {
  return (
    <li
      className="flex items-center justify-between gap-3 rounded-[11px] border p-3"
      style={{
        borderColor: active ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.08)',
        background: active ? 'rgba(245,166,35,0.08)' : 'rgba(255,255,255,0.02)',
      }}
    >
      <span className="min-w-0">
        <span className="clamp-1 block text-[12.5px] font-semibold text-white/90">{title}</span>
        <span className="block text-[11.5px] text-white/45">{detail}</span>
      </span>
      {active ? <Pill tone="gold">Default</Pill> : <Button size="sm" variant="ghost">Use</Button>}
    </li>
  );
}

function ShippingCard({ country, couriers, note }: { country: string; couriers: string; note: string }) {
  return (
    <div className="rounded-[12px] border border-white/8 p-4" style={{ background: 'rgba(255,255,255,0.025)' }}>
      <p className="text-[13.5px] font-semibold text-white">{country}</p>
      <p className="mt-1 text-[12px] text-white/60">{couriers}</p>
      <p className="mt-2 text-[11.5px] text-white/45">{note}</p>
    </div>
  );
}
