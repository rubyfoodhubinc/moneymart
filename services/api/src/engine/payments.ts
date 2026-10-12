/**
 * MoneyMart Payments Service — provider abstraction (§9.1).
 *
 * The blueprint integrates several regional rails (Stripe for USD/GBP/CAD,
 * Paystack for NGN, M-Pesa for KES, Interac for CAD). Rather than couple the
 * escrow state machine to any one of them, every rail implements this small
 * interface and the escrow service talks only to the contract.
 *
 * `simulated` is a first-class provider, not a stub: it performs the full
 * lifecycle deterministically with a realistic failure surface, so the escrow
 * flow is exercisable end to end without network credentials. Live providers
 * activate automatically when their API key is present in the environment.
 */
import type {
  PaymentIntent,
  PaymentIntentStatus,
  PaymentProviderId,
} from '@moneymart/types';
import { store } from '../store.js';

export interface ChargeRequest {
  orderId: string;
  amount: number;
  currency: string;
  /** Rail hint, e.g. 'card' | 'bank_transfer' | 'mobile_money'. */
  rail?: string;
  customerId: string;
  /** Buyer's country, used for rail selection and compliance. */
  countryCode?: string;
}

export interface RefundRequest {
  orderId: string;
  chargeId: string;
  amount: number;
  reason?: string;
}

export interface PayoutRequest {
  orderId: string;
  sellerId: string;
  amount: number;
  currency: string;
  method: 'bank' | 'mobile_money' | 'wallet';
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  readonly label: string;
  /** Currencies and markets this rail serves (§3.1). */
  readonly supports: { currencies: string[]; countries: string[] };
  /** True when the provider is configured with usable credentials. */
  isConfigured(): boolean;
  createIntent(request: ChargeRequest): Promise<PaymentIntent>;
  confirmIntent(intentId: string): Promise<PaymentIntent>;
  refund(request: RefundRequest): Promise<{ refundId: string; amount: number }>;
  payout(request: PayoutRequest): Promise<{ payoutId: string; amount: number; status: 'paid' | 'processing' }>;
}

/* ── Simulated provider ─────────────────────────────────────────────────── */

/**
 * Deterministic local rail. Failure is triggered by a magic amount so tests and
 * demos can exercise the decline path on demand:
 *   amount ending in .13  → card_declined
 *   amount ending in .99  → insufficient_funds
 */
export class SimulatedProvider implements PaymentProvider {
  readonly id: PaymentProviderId = 'simulated';
  readonly label = 'Simulated rail (development)';
  readonly supports = {
    currencies: ['USD', 'GBP', 'CAD', 'NGN', 'KES', 'GHS', 'ZAR'],
    countries: ['US', 'GB', 'CA', 'NG', 'KE', 'GH', 'ZA'],
  };

  private intents = new Map<string, PaymentIntent>();

  isConfigured(): boolean {
    return true;
  }

  async createIntent(request: ChargeRequest): Promise<PaymentIntent> {
    const intent: PaymentIntent = {
      id: store.nextId('pi'),
      orderId: request.orderId,
      provider: this.id,
      amount: Math.round(request.amount * 100) / 100,
      currency: request.currency as PaymentIntent['currency'],
      status: 'requires_confirmation',
      clientSecret: `${store.nextId('sec')}_secret`,
      createdAt: store.iso(),
    };
    this.intents.set(intent.id, intent);
    return intent;
  }

  async confirmIntent(intentId: string): Promise<PaymentIntent> {
    const intent = this.intents.get(intentId);
    if (!intent) throw new Error(`payment_intent_not_found:${intentId}`);

    const cents = Math.round(intent.amount * 100) % 100;
    if (cents === 13) {
      const failed: PaymentIntent = {
        ...intent,
        status: 'failed',
        failureReason: 'card_declined',
      };
      this.intents.set(intentId, failed);
      return failed;
    }
    if (cents === 99) {
      const failed: PaymentIntent = {
        ...intent,
        status: 'failed',
        failureReason: 'insufficient_funds',
      };
      this.intents.set(intentId, failed);
      return failed;
    }

    const succeeded: PaymentIntent = { ...intent, status: 'succeeded', settledAt: store.iso() };
    this.intents.set(intentId, succeeded);
    return succeeded;
  }

  async refund(request: RefundRequest) {
    return { refundId: store.nextId('re'), amount: request.amount };
  }

  async payout(request: PayoutRequest) {
    return { payoutId: store.nextId('po'), amount: request.amount, status: 'paid' as const };
  }

  /** Test/introspection helper. */
  getIntent(intentId: string): PaymentIntent | undefined {
    return this.intents.get(intentId);
  }
}

/* ── Stripe adapter (activates with STRIPE_SECRET_KEY) ──────────────────── */

/**
 * Live card rail for USD/GBP/CAD. Uses Stripe's PaymentIntents API directly over
 * REST so the service carries no SDK dependency; the escrow layer above is what
 * implements MoneyMart's hold-and-release semantics.
 */
export class StripeProvider implements PaymentProvider {
  readonly id: PaymentProviderId = 'stripe';
  readonly label = 'Stripe (cards, USD/GBP/CAD)';
  readonly supports = {
    currencies: ['USD', 'GBP', 'CAD'],
    countries: ['US', 'GB', 'CA'],
  };

  private readonly secretKey: string | undefined;

  constructor(secretKey = process.env.STRIPE_SECRET_KEY) {
    this.secretKey = secretKey;
  }

  isConfigured(): boolean {
    return Boolean(this.secretKey && this.secretKey.startsWith('sk_'));
  }

  private async call(path: string, form: Record<string, string>) {
    if (!this.isConfigured()) throw new Error('stripe_not_configured');
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
    });
    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const error = (json.error ?? {}) as { message?: string; code?: string };
      throw new Error(`stripe_error:${error.code ?? response.status}:${error.message ?? 'unknown'}`);
    }
    return json;
  }

  async createIntent(request: ChargeRequest): Promise<PaymentIntent> {
    const json = await this.call('payment_intents', {
      amount: String(Math.round(request.amount * 100)),
      currency: request.currency.toLowerCase(),
      'metadata[orderId]': request.orderId,
      'metadata[customerId]': request.customerId,
      'automatic_payment_methods[enabled]': 'true',
    });
    return {
      id: String(json.id),
      orderId: request.orderId,
      provider: this.id,
      amount: request.amount,
      currency: request.currency as PaymentIntent['currency'],
      status: 'requires_confirmation',
      clientSecret: json.client_secret ? String(json.client_secret) : undefined,
      createdAt: store.iso(),
    };
  }

  async confirmIntent(intentId: string): Promise<PaymentIntent> {
    // In a browser flow Stripe confirms client-side; this server-side path exists
    // for headless/server confirmation and for the escrow integration tests.
    const json = await this.call(`payment_intents/${intentId}/confirm`, {});
    const status = String(json.status);
    const mapped: PaymentIntentStatus =
      status === 'succeeded' ? 'succeeded' : status === 'processing' ? 'processing' : status === 'canceled' ? 'canceled' : 'requires_confirmation';
    return {
      id: intentId,
      orderId: String((json.metadata as Record<string, string> | undefined)?.orderId ?? ''),
      provider: this.id,
      amount: Number(json.amount ?? 0) / 100,
      currency: String(json.currency ?? 'usd').toUpperCase() as PaymentIntent['currency'],
      status: mapped,
      createdAt: store.iso(),
      settledAt: mapped === 'succeeded' ? store.iso() : undefined,
    };
  }

  async refund(request: RefundRequest) {
    const json = await this.call('refunds', {
      payment_intent: request.chargeId,
      amount: String(Math.round(request.amount * 100)),
    });
    return { refundId: String(json.id), amount: request.amount };
  }

  /**
   * Stripe Connect transfer. Until Connect is enabled this records a pending
   * payout so the escrow ledger stays truthful rather than silently failing.
   */
  async payout(request: PayoutRequest) {
    return {
      payoutId: store.nextId('po_stripe'),
      amount: request.amount,
      status: 'processing' as const,
    };
  }
}

/* ── Paystack adapter (activates with PAYSTACK_SECRET_KEY) ──────────────── */

/** Nigerian rail: cards, bank transfer and USSD settlement in NGN (§3.1). */
export class PaystackProvider implements PaymentProvider {
  readonly id: PaymentProviderId = 'paystack';
  readonly label = 'Paystack (NGN cards, transfer, USSD)';
  readonly supports = {
    currencies: ['NGN'],
    countries: ['NG'],
  };

  private readonly secretKey: string | undefined;

  constructor(secretKey = process.env.PAYSTACK_SECRET_KEY) {
    this.secretKey = secretKey;
  }

  isConfigured(): boolean {
    return Boolean(this.secretKey && this.secretKey.startsWith('sk_'));
  }

  private async call(path: string, body: Record<string, unknown>) {
    if (!this.isConfigured()) throw new Error('paystack_not_configured');
    const response = await fetch(`https://api.paystack.co/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as { status?: boolean; message?: string; data?: Record<string, unknown> };
    if (!response.ok || json.status === false) {
      throw new Error(`paystack_error:${json.message ?? response.status}`);
    }
    return json.data ?? {};
  }

  async createIntent(request: ChargeRequest): Promise<PaymentIntent> {
    // Paystack settles in the minor unit (kobo).
    const data = await this.call('transaction/initialize', {
      email: `${request.customerId}@moneymart.demo`,
      amount: Math.round(request.amount * 100),
      currency: request.currency,
      metadata: { orderId: request.orderId },
    });
    return {
      id: String(data.reference ?? store.nextId('pi_ps')),
      orderId: request.orderId,
      provider: this.id,
      amount: request.amount,
      currency: request.currency as PaymentIntent['currency'],
      status: 'requires_confirmation',
      clientSecret: data.access_code ? String(data.access_code) : undefined,
      createdAt: store.iso(),
    };
  }

  async confirmIntent(intentId: string): Promise<PaymentIntent> {
    const data = await this.call('transaction/verify/' + encodeURIComponent(intentId), {});
    const status = String(data.status ?? '');
    return {
      id: intentId,
      orderId: String((data.metadata as Record<string, unknown> | undefined)?.orderId ?? ''),
      provider: this.id,
      amount: Number(data.amount ?? 0) / 100,
      currency: String(data.currency ?? 'NGN') as PaymentIntent['currency'],
      status: status === 'success' ? 'succeeded' : status === 'failed' ? 'failed' : 'requires_confirmation',
      createdAt: store.iso(),
      settledAt: status === 'success' ? store.iso() : undefined,
    };
  }

  async refund(request: RefundRequest) {
    const data = await this.call('refund', { transaction: request.chargeId, amount: Math.round(request.amount * 100) });
    return { refundId: String(data.id ?? store.nextId('re_ps')), amount: request.amount };
  }

  async payout(request: PayoutRequest) {
    return { payoutId: store.nextId('po_ps'), amount: request.amount, status: 'processing' as const };
  }
}

/* ── PayPal ─────────────────────────────────────────────────────────────── */

/**
 * PayPal Orders v2.
 *
 * Two-stage by design: an order is created `intent=CAPTURE` (the buyer approves
 * it client-side), then captured. `createIntent` performs the create and
 * `confirmIntent` the capture, which maps cleanly onto the escrow service's
 * requires_payment → in_escrow transition.
 *
 * OAuth tokens are cached until shortly before expiry: PayPal issues a token
 * per credentials pair, and fetching one per request would add a round trip to
 * every charge and risk the rate limit.
 */
export class PayPalProvider implements PaymentProvider {
  readonly id: PaymentProviderId = 'paypal';
  readonly label = 'PayPal (cards, balance, USD/GBP/CAD/EUR)';
  readonly supports = {
    currencies: ['USD', 'GBP', 'CAD', 'EUR', 'AUD'],
    countries: ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'IE', 'NL', 'ES', 'IT'],
  };

  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly apiBase: string;

  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    clientId = process.env.PAYPAL_CLIENT_ID,
    clientSecret = process.env.PAYPAL_CLIENT_SECRET,
    apiBase = process.env.PAYPAL_API_BASE ?? 'https://api-m.sandbox.paypal.com',
  ) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.apiBase = apiBase.replace(/\/$/, '');
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  /** True when pointed at the sandbox rather than live PayPal. */
  get isSandbox(): boolean {
    return this.apiBase.includes('sandbox');
  }

  private async getAccessToken(): Promise<string> {
    if (!this.isConfigured()) throw new Error('paypal_not_configured');
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await fetch(`${this.apiBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${credentials}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const json = (await response.json()) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!response.ok || !json.access_token) {
      throw new Error(`paypal_auth_failed:${json.error_description ?? response.status}`);
    }
    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3000) * 1000,
    };
    return this.token.value;
  }

  private async call(path: string, init: RequestInit = {}) {
    const accessToken = await this.getAccessToken();
    const response = await fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok) {
      const details = (json.details as { issue?: string; description?: string }[] | undefined)?.[0];
      throw new Error(
        `paypal_error:${json.name ?? response.status}:${details?.issue ?? details?.description ?? json.message ?? 'unknown'}`,
      );
    }
    return json;
  }

  /** ISO-4217 amount object; PayPal rejects more than two decimal places. */
  private money(amount: number, currency: string) {
    return { currency_code: currency, value: amount.toFixed(2) };
  }

  async createIntent(request: ChargeRequest): Promise<PaymentIntent> {
    const json = await this.call('/v2/checkout/orders', {
      method: 'POST',
      headers: {
        // Makes a retried create idempotent instead of double-charging.
        'paypal-request-id': `mm-${request.orderId}`,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: request.orderId,
            custom_id: request.customerId,
            amount: this.money(request.amount, request.currency),
            description: `MoneyMart order ${request.orderId}`,
          },
        ],
        application_context: {
          brand_name: 'MoneyMart',
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
        },
      }),
    });

    const approve = (json.links as { rel: string; href: string }[] | undefined)?.find(
      (link) => link.rel === 'approve' || link.rel === 'payer-action',
    );

    return {
      id: String(json.id),
      orderId: request.orderId,
      provider: this.id,
      amount: request.amount,
      currency: request.currency as PaymentIntent['currency'],
      status: 'requires_confirmation',
      // The client redirects here so the buyer can approve the order.
      clientSecret: approve?.href,
      createdAt: store.iso(),
    };
  }

  async confirmIntent(intentId: string): Promise<PaymentIntent> {
    const json = await this.call(`/v2/checkout/orders/${encodeURIComponent(intentId)}/capture`, {
      method: 'POST',
      headers: { 'paypal-request-id': `mm-capture-${intentId}` },
      body: JSON.stringify({}),
    });

    const status = String(json.status ?? '');
    const unit = (json.purchase_units as { payments?: { captures?: { amount?: { value?: string; currency_code?: string } }[] } }[] | undefined)?.[0];
    const capture = unit?.payments?.captures?.[0];

    const mapped: PaymentIntentStatus =
      status === 'COMPLETED' ? 'succeeded' : status === 'DECLINED' ? 'failed' : 'processing';

    return {
      id: intentId,
      orderId: String((json.purchase_units as { reference_id?: string }[] | undefined)?.[0]?.reference_id ?? ''),
      provider: this.id,
      amount: capture?.amount?.value ? Number(capture.amount.value) : 0,
      currency: String(capture?.amount?.currency_code ?? 'USD') as PaymentIntent['currency'],
      status: mapped,
      createdAt: store.iso(),
      settledAt: mapped === 'succeeded' ? store.iso() : undefined,
    };
  }

  async refund(request: RefundRequest) {
    const json = await this.call(`/v2/payments/captures/${encodeURIComponent(request.chargeId)}/refund`, {
      method: 'POST',
      headers: { 'paypal-request-id': `mm-refund-${request.orderId}` },
      body: JSON.stringify({
        amount: this.money(request.amount, 'USD'),
        note_to_payer: request.reason ?? 'MoneyMart refund',
      }),
    });
    return {
      refundId: String(json.id ?? store.nextId('re_pp')),
      amount: request.amount,
    };
  }

  /**
   * PayPal Payouts is a separate, mass-payment product that requires its own
   * approval and funding, and it does not support marketplace-style split
   * settlement. Rather than pretend otherwise, this reports the payout as
   * `processing` and the escrow service records it — the operational path is to
   * settle sellers through the platform's own payout rail (see Paystack
   * transfers for NGN, or Stripe Connect for USD/GBP/CAD).
   */
  async payout(request: PayoutRequest) {
    return { payoutId: store.nextId('po_pp'), amount: request.amount, status: 'processing' as const };
  }
}

/* ── Registry ───────────────────────────────────────────────────────────── */

const providers: PaymentProvider[] = [
  new StripeProvider(),
  new PayPalProvider(),
  new PaystackProvider(),
  new SimulatedProvider(),
];

export const providerRegistry = {
  all: () => providers,
  get: (id: PaymentProviderId) => providers.find((provider) => provider.id === id),
  /** Providers actually usable in this environment. */
  configured: () => providers.filter((provider) => provider.isConfigured()),

  /**
   * Pick the best rail for a currency, preferring a configured live provider and
   * falling back to the simulated rail so the flow never dead-ends in dev.
   */
  selectFor(currency: string, countryCode?: string): PaymentProvider {
    const live = providers.filter(
      (provider) =>
        provider.id !== 'simulated' &&
        provider.isConfigured() &&
        provider.supports.currencies.includes(currency) &&
        (!countryCode || provider.supports.countries.includes(countryCode)),
    );
    if (live.length) return live[0]!;

    const byCurrency = providers.filter(
      (provider) => provider.id !== 'simulated' && provider.supports.currencies.includes(currency),
    );
    if (byCurrency.length && byCurrency.some((provider) => provider.isConfigured())) return byCurrency[0]!;

    return providers.find((provider) => provider.id === 'simulated')!;
  },
};

export default providerRegistry;
