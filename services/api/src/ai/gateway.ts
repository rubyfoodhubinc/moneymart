/**
 * AI gateway — one way to call every model the company uses.
 *
 * Ported from President Eteka (Every Media AI `council/llm.ts` + `llm-meter.ts`) with Ruby's daily budgets
 * (RubyNav `lib/ai/budget.ts`). Plain HTTPS, no SDKs, keys read server-side only (never put in prompts, logs or
 * responses):
 *
 *   - Claude (Anthropic Messages API, with tool use), OpenAI, xAI (Grok) and Kimi (Moonshot), the last three
 *     OpenAI-shaped.
 *   - A refused key (401/402/403, or 429 that says quota/credit) is tried once on the role's second key
 *     (`<KEY>2`), then the role's ONE preapproved backup model. A timeout is a failure, never a silent swap.
 *   - Every call is counted (tokens in/out per model per day) and priced from the price list, so the console's
 *     operating cost includes AI. A model with no price is recorded as "no price set", never as free.
 *   - Each role has a daily call budget. Over budget the call is refused (fails closed), so a loop can't run up a
 *     bill.
 */
import { aiSpend, settings } from '../store.js';

export type Provider = 'anthropic' | 'openai' | 'xai' | 'kimi' | 'zai';
export type Role = 'president' | 'staff' | 'ore' | 'board' | 'quick';

export interface Seat {
  provider: Provider;
  model: string;
  /** One preapproved backup model on the same provider ('' = none). */
  backup: string;
}

/** Default seats; the owner changes them in the console (setting `ai.seats`). */
export const DEFAULT_SEATS: Record<string, Seat> = {
  president: { provider: 'anthropic', model: 'claude-opus-5-5', backup: 'claude-sonnet-5-5' },
  quick: { provider: 'anthropic', model: 'claude-haiku-5-5', backup: '' },
  ore: { provider: 'anthropic', model: 'claude-sonnet-5-5', backup: 'claude-haiku-5-5' },
  finance: { provider: 'anthropic', model: 'claude-sonnet-5-5', backup: 'claude-haiku-5-5' },
  tech: { provider: 'anthropic', model: 'claude-sonnet-5-5', backup: 'claude-haiku-5-5' },
  marketing: { provider: 'openai', model: 'gpt-5.5', backup: '' },
  operations: { provider: 'openai', model: 'gpt-5.5', backup: '' },
  sales: { provider: 'xai', model: 'grok-4.7', backup: '' },
  research: { provider: 'kimi', model: 'kimi-k3.1-pro', backup: '' },
};

/** Default prices, USD per million tokens [input, output]; the owner edits them (setting `ai.prices`). */
export const DEFAULT_PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [15, 75],
  'claude-sonnet-5-5': [3, 15],
  'claude-haiku-5-5': [1, 5],
};

/** Daily call budgets per role (setting `ai.budgets`). */
export const DEFAULT_BUDGETS: Record<Role, number> = { president: 400, staff: 300, board: 300, ore: 20_000, quick: 2_000 };

/** Environment variable holding each provider's key. The President has her own Claude key when set. */
export function keyEnvFor(provider: Provider, role: Role): string[] {
  switch (provider) {
    case 'anthropic':
      return role === 'president' || role === 'board' || role === 'staff'
        ? ['ANTHROPIC_PRESIDENT_API_KEY', 'PRESIDENT_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY']
        : ['ANTHROPIC_API_KEY'];
    case 'openai':
      return ['OPENAI_API_KEY'];
    case 'xai':
      return ['XAI_API_KEY'];
    case 'kimi':
      return ['MOONSHOT_API_KEY', 'KIMI_API_KEY'];
    case 'zai':
      return ['Z_AI_API_KEY', 'ZAI_API_KEY'];
  }
}

const OPENAI_SHAPE: Record<Exclude<Provider, 'anthropic'>, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  xai: 'https://api.x.ai/v1/chat/completions',
  kimi: 'https://api.moonshot.ai/v1/chat/completions',
  zai: 'https://api.z.ai/api/paas/v4/chat/completions',
};

export function providerKey(provider: Provider, role: Role, second = false, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const names = keyEnvFor(provider, role);
  const first = names.map((n) => env[n]).find(Boolean);
  if (!second) return first;
  return names.map((n) => env[`${n}2`]).find((v) => v && v !== first);
}

export const providerConfigured = (provider: Provider, role: Role = 'quick') => Boolean(providerKey(provider, role));

/* ── messages and tools (Anthropic shape; converted for OpenAI-shaped providers) ── */

export type ToolUse = { id: string; name: string; input: Record<string, unknown> };
export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  /** A photo the member attached (base64). */
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  /** A PDF the member attached (base64). */
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string }; title?: string };
export type Message = { role: 'user' | 'assistant'; content: string | Block[] };
export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };

export interface CallInput {
  seat: string;
  role: Role;
  system: string;
  messages: Message[];
  tools?: ToolDef[];
  maxTokens?: number;
  timeoutMs?: number;
  /** Ask for a JSON object (OpenAI-shaped providers). */
  json?: boolean;
}

export type CallOk = { ok: true; text: string; toolUses: ToolUse[]; content: Block[]; model: string; provider: Provider; replaced: boolean; usage: { in: number; out: number } };
export type CallFail = { ok: false; reason: string; model: string; provider: Provider };
export type CallResult = CallOk | CallFail;

/* ── settings-backed configuration ── */

export function seatOf(name: string): Seat {
  const custom = (settings.get<Record<string, Seat>>('ai.seats') ?? {})[name];
  return custom ?? DEFAULT_SEATS[name] ?? DEFAULT_SEATS.quick!;
}

export function priceList(): Record<string, [number, number]> {
  return { ...DEFAULT_PRICES, ...(settings.get<Record<string, [number, number]>>('ai.prices') ?? {}) };
}

/** Pure: USD for one call, or null when the model has no price (never zero). */
export function callUsd(model: string, usage: { in: number; out: number }, prices = priceList()): number | null {
  const p = prices[model] ?? prices[model.replace(/-\d{8}$/, '')] ?? prices[model.replace(/-latest$/, '')];
  if (!p) return null;
  return Math.round(((usage.in * p[0] + usage.out * p[1]) / 1_000_000) * 10_000) / 10_000;
}

/* ── budgets (fail closed) ── */

const callsToday = new Map<string, number>();
const dayKey = () => new Date().toISOString().slice(0, 10);

export function budgetLeft(role: Role): number {
  const cap = { ...DEFAULT_BUDGETS, ...(settings.get<Partial<Record<Role, number>>>('ai.budgets') ?? {}) }[role];
  return cap - (callsToday.get(`${dayKey()}|${role}`) ?? 0);
}

function spendBudget(role: Role): boolean {
  if (budgetLeft(role) <= 0) return false;
  const k = `${dayKey()}|${role}`;
  callsToday.set(k, (callsToday.get(k) ?? 0) + 1);
  return true;
}

/* ── metering: one row per day, provider, model and role ── */

export function meter(provider: Provider, model: string, role: Role, usage: { in: number; out: number }): void {
  try {
    const id = `${dayKey()}|${provider}|${model}|${role}`;
    const row = aiSpend.get(id) ?? { id, day: dayKey(), provider, model, role, calls: 0, tokensIn: 0, tokensOut: 0, usd: 0, priced: true };
    row.calls += 1;
    row.tokensIn += usage.in;
    row.tokensOut += usage.out;
    const usd = callUsd(model, { in: row.tokensIn, out: row.tokensOut });
    row.priced = usd !== null;
    row.usd = usd ?? 0;
    aiSpend.save(row);
  } catch {
    /* counting must never break a call */
  }
}

/* ── the calls ── */

/** Pure: did the supplier refuse the KEY (not the request)? */
export const keyRefused = (msg: string) =>
  /^(401|402|403)\b/.test(msg) || (/^429\b/.test(msg) && /quota|credit|balance|billing|insufficient/i.test(msg));

async function anthropicCall(model: string, input: CallInput, key: string): Promise<Omit<CallOk, 'ok' | 'replaced' | 'provider'>> {
  const response = await fetch(process.env.MM_ANTHROPIC_BASE ?? 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(input.timeoutMs ?? 120_000),
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: input.maxTokens ?? 2048,
      system: input.system,
      messages: input.messages,
      ...(input.tools?.length ? { tools: input.tools } : {}),
    }),
  });
  if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
  const json = (await response.json()) as { content?: Block[]; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }; model?: string };
  const content = json.content ?? [];
  const usage = {
    in: (json.usage?.input_tokens ?? 0) + (json.usage?.cache_read_input_tokens ?? 0) + (json.usage?.cache_creation_input_tokens ?? 0),
    out: json.usage?.output_tokens ?? 0,
  };
  return {
    text: content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''),
    toolUses: content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : [])),
    content,
    model,
    usage,
  };
}

/** Anthropic-shaped messages and tools as an OpenAI chat-completions body. Pure. */
export function openaiBody(model: string, input: CallInput, provider: Provider) {
  const messages: Record<string, unknown>[] = [{ role: 'system', content: input.system }];
  for (const m of input.messages) {
    if (typeof m.content === 'string') {
      messages.push({ role: m.role, content: m.content });
      continue;
    }
    const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    const calls = m.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    const results = m.content.filter((b): b is Extract<Block, { type: 'tool_result' }> => b.type === 'tool_result');
    if (m.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}),
      });
    } else {
      for (const r of results) messages.push({ role: 'tool', tool_call_id: r.tool_use_id, content: r.content });
      const images = m.content.filter((b): b is Extract<Block, { type: 'image' }> => b.type === 'image');
      const docs = m.content.filter((b) => b.type === 'document').length;
      const note = docs ? `\n[${docs} PDF attachment(s) cannot be read by this model.]` : '';
      if (images.length) {
        messages.push({
          role: 'user',
          content: [
            ...(text || note ? [{ type: 'text', text: `${text}${note}` }] : []),
            ...images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.source.media_type};base64,${i.source.data}` } })),
          ],
        });
      } else if (text || note) messages.push({ role: 'user', content: `${text}${note}` });
    }
  }
  return {
    model,
    messages,
    ...(provider === 'openai' ? { max_completion_tokens: input.maxTokens ?? 2048 } : { max_tokens: input.maxTokens ?? 2048 }),
    ...(input.tools?.length
      ? { tools: input.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) }
      : {}),
    ...(input.json && !input.tools?.length ? { response_format: { type: 'json_object' } } : {}),
  };
}

async function openaiShapeCall(provider: Exclude<Provider, 'anthropic'>, model: string, input: CallInput, key: string): Promise<Omit<CallOk, 'ok' | 'replaced' | 'provider'>> {
  const base = process.env[`MM_${provider.toUpperCase()}_BASE`] ?? OPENAI_SHAPE[provider];
  const response = await fetch(base, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(input.timeoutMs ?? 120_000),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(openaiBody(model, input, provider)),
  });
  if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
  const json = (await response.json()) as {
    choices?: { message?: { content?: unknown; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = json.choices?.[0]?.message;
  const raw = message?.content;
  const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.filter((p) => (p as { type?: string }).type === 'text').map((p) => String((p as { text?: unknown }).text ?? '')).join('') : '';
  const toolUses: ToolUse[] = (message?.tool_calls ?? []).map((c) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(c.function.arguments || '{}');
    } catch {
      args = {};
    }
    return { id: c.id, name: c.function.name, input: args };
  });
  const content: Block[] = [...(text ? [{ type: 'text' as const, text }] : []), ...toolUses.map((u) => ({ type: 'tool_use' as const, ...u }))];
  return { text, toolUses, content, model, usage: { in: json.usage?.prompt_tokens ?? 0, out: json.usage?.completion_tokens ?? 0 } };
}

async function once(provider: Provider, model: string, input: CallInput, second: boolean) {
  const key = providerKey(provider, input.role, second);
  if (!key) throw new Error(`no key: set ${keyEnvFor(provider, input.role)[0]}${second ? '2' : ''} on the server`);
  return provider === 'anthropic' ? anthropicCall(model, input, key) : openaiShapeCall(provider, model, input, key);
}

/** One call to a seat: its model, then a second key if the key was refused, then its one backup model. */
export async function call(input: CallInput): Promise<CallResult> {
  const seat = seatOf(input.seat);
  if (!spendBudget(input.role)) {
    return { ok: false, reason: `Daily AI budget for "${input.role}" is used up; it resets at midnight UTC.`, model: seat.model, provider: seat.provider };
  }
  const finish = (r: Omit<CallOk, 'ok' | 'replaced' | 'provider'>, replaced: boolean): CallOk => {
    meter(seat.provider, r.model, input.role, r.usage);
    return { ok: true, ...r, provider: seat.provider, replaced };
  };
  try {
    return finish(await once(seat.provider, seat.model, input, false), false);
  } catch (error) {
    const first = (error as Error).message.slice(0, 200);
    const timedOut = /TimeoutError|aborted|timed? ?out/i.test(`${(error as Error).name} ${first}`);
    if (!timedOut && keyRefused(first) && providerKey(seat.provider, input.role, true)) {
      try {
        return finish(await once(seat.provider, seat.model, input, true), false);
      } catch {
        /* fall through to the backup model */
      }
    }
    if (!seat.backup || seat.backup === seat.model || timedOut) {
      return { ok: false, reason: timedOut ? 'The model did not answer in time.' : first, model: seat.model, provider: seat.provider };
    }
    try {
      return finish(await once(seat.provider, seat.backup, input, false), true);
    } catch (error2) {
      return { ok: false, reason: `${first} · backup ${seat.backup}: ${(error2 as Error).message.slice(0, 120)}`, model: seat.model, provider: seat.provider };
    }
  }
}

/** Operating cost of AI for the console: totals by day/provider/model/role for the last N days. */
export function aiCostSince(days: number) {
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = aiSpend.all().filter((r) => r.day >= from);
  return {
    usd: Math.round(rows.reduce((s, r) => s + r.usd, 0) * 100) / 100,
    calls: rows.reduce((s, r) => s + r.calls, 0),
    unpriced: [...new Set(rows.filter((r) => !r.priced).map((r) => r.model))],
    rows,
  };
}
