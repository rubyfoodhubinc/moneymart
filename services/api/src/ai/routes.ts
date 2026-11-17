/**
 * HTTP routes for the Owner console's AI company and for Ore in the app.
 *
 * - /api/admin/*      Owner console (access from `access.ts`; 404 for anyone without a seat, so the console is not confirmed)
 * - /api/ore/*        Ore, the member's own assistant; reports needs up to President Ore, follows her signed directives
 */
import type { Express, Request, Response } from 'express';
import { accessFor, writeAudit, type Access, type Tab } from './access.js';
import { SETTINGS, applyChanges, checkChanges, valueOf } from './registry.js';
import { call, providerConfigured, priceList, seatOf, aiCostSince, type Block, type Message, type ToolDef } from './gateway.js';
import {
  businessReport,
  dailyBriefing,
  decide,
  directivesBlock,
  ensureStaff,
  fileRequest,
  presidentConfigured,
  presidentName,
  presidentTurn,
  startPresident,
} from './president.js';
import { audit, presChat, presPosts, store, users, type PresPost } from '../store.js';

type ActorFn = (req: Request) => string;

function seat(req: Request, res: Response, actorId: ActorFn, tab?: Tab): { userId: string; access: Access } | null {
  const userId = actorId(req);
  const access = userId ? accessFor(users.get(userId)) : null;
  if (!access || (tab && !access.tabs.includes(tab))) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return { userId, access };
}

/** Email the owners (Resend). Quietly skipped when email is not configured. */
async function emailOwners(subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const to = (process.env.MM_OWNER_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!key || !to.length) return false;
  try {
    const response = await fetch(`${process.env.MM_RESEND_API_BASE ?? 'https://api.resend.com'}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.RESEND_FROM ?? 'MoneyMart <onboarding@resend.dev>', to, subject, text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const AI_PROVIDERS: { id: string; label: string; env: string[]; also?: string[] }[] = [
  { id: 'anthropic', label: 'Claude (Anthropic)', env: ['ANTHROPIC_PRESIDENT_API_KEY', 'PRESIDENT_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'] },
  { id: 'openai', label: 'OpenAI', env: ['OPENAI_API_KEY'] },
  { id: 'xai', label: 'xAI (Grok)', env: ['XAI_API_KEY'] },
  { id: 'kimi', label: 'Kimi (Moonshot)', env: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'] },
  { id: 'zai', label: 'Z.ai (GLM)', env: ['Z_AI_API_KEY', 'ZAI_API_KEY'] },
  { id: 'cartesia', label: 'Cartesia (voice)', env: ['CARTESIA_API_KEY'] },
  { id: 'elevenlabs', label: 'ElevenLabs (voice)', env: ['ELEVENLABS_API_KEY', 'ELEVENLAB_API_KEY'] },
  { id: 'didit_kyc', label: 'Didit — person checks (KYC)', env: ['DIDIT_API_KEY'], also: ['DIDIT_KYC_WORKFLOWID_KEY'] },
  { id: 'didit_kyb', label: 'Didit — business checks (KYB)', env: ['DIDIT_API_KEY'], also: ['DIDIT_KYB_WORKFLOWID_KEY'] },
  { id: 'resend', label: 'Resend (email)', env: ['RESEND_API_KEY'] },
];

const ORE_TOOLS: ToolDef[] = [
  {
    name: 'report_to_president',
    description: "Pass the member's request up to President Ore: a feature they want, a problem or bug, or feedback. Anonymous; similar requests are merged.",
    input_schema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['feature', 'problem', 'feedback'] }, title: { type: 'string' }, detail: { type: 'string' } },
      required: ['kind', 'title'],
    },
  },
];

const ORE_SYSTEM = () => `You are Ore, the member's own assistant inside MoneyMart — a live shopping marketplace where anyone can buy and sell in live auction shows and listings, in every category. You are warm, brief and practical.
You help buyers find items and shows and understand bidding, Buy It Now, fees, shipping and orders; you help sellers list items, schedule shows, run items live and price well.
You cannot take actions for the member in this chat; tell them where to tap in the app. Never invent prices, policies or features. Never ask for passwords, card numbers or codes.
When the member wants something MoneyMart doesn't do, has a problem, or gives feedback, use report_to_president and tell them it has gone to President ${presidentName()}.${directivesBlock()}`;

export function mountAiRoutes(app: Express, actorId: ActorFn): void {
  app.get('/api/admin/me', (req, res) => {
    const s = seat(req, res, actorId);
    if (!s) return;
    res.json({ ...s.access, president: presidentName() });
  });

  app.get('/api/admin/overview', (req, res) => {
    if (!seat(req, res, actorId, 'overview')) return;
    res.json({
      today: businessReport(1),
      week: businessReport(7),
      month: businessReport(30),
      approvalsWaiting: presPosts.all().filter((p) => p.status === 'pending').length,
    });
  });

  app.get('/api/admin/providers', (req, res) => {
    if (!seat(req, res, actorId, 'providers')) return;
    res.json({
      ai: AI_PROVIDERS.map((p) => ({ id: p.id, label: p.label, configured: p.env.some((k) => Boolean(process.env[k])) && (p.also ?? []).every((k) => Boolean(process.env[k])) })),
      seats: ['president', 'finance', 'operations', 'marketing', 'sales', 'tech', 'ore', 'research', 'quick'].map((name) => ({ name, ...seatOf(name) })),
      prices: priceList(),
      cost30d: aiCostSince(30),
    });
  });

  /* settings */
  app.get('/api/admin/settings', (req, res) => {
    if (!seat(req, res, actorId, 'settings')) return;
    res.json({ settings: SETTINGS.map((d) => ({ key: d.key, label: d.label, group: d.group, value: valueOf(d.key), defaultValue: d.defaultValue })) });
  });

  app.put('/api/admin/settings', (req, res) => {
    const s = seat(req, res, actorId, 'settings');
    if (!s) return;
    const raw = Array.isArray(req.body?.changes) ? (req.body.changes as { key?: unknown; value?: unknown }[]) : [];
    const checked = checkChanges(raw.map((c) => ({ key: String(c.key ?? ''), value: c.value })), false);
    if ('error' in checked) {
      res.status(400).json({ error: 'invalid', detail: checked.error });
      return;
    }
    // The AI section (models, prices, budgets) is the owner's own hand.
    if (s.access.role !== 'owner' && checked.some((c) => c.key.startsWith('ai.'))) {
      res.status(403).json({ error: 'owner_only' });
      return;
    }
    applyChanges(checked);
    writeAudit(s.access.email || s.userId, 'settings_change', checked.map((c) => c.key).join(','), { changes: checked });
    res.json({ ok: true, changed: checked });
  });

  app.get('/api/admin/audit', (req, res) => {
    if (!seat(req, res, actorId, 'audit')) return;
    res.json({ entries: audit.recent(Math.min(500, Number(req.query.limit) || 100)) });
  });

  /* President Ore's office (owner only) */
  app.get('/api/admin/president', (req, res) => {
    if (!seat(req, res, actorId, 'president')) return;
    const posts = presPosts.all();
    res.json({
      name: presidentName(),
      configured: presidentConfigured(),
      staff: ensureStaff(),
      approvals: posts.filter((p) => p.status === 'pending'),
      reports: posts.filter((p) => p.kind === 'report').slice(0, 50),
      requests: posts.filter((p) => p.kind === 'request').slice(0, 100),
      recent: posts.slice(0, 50),
      threads: presChat.threads(),
    });
  });

  app.get('/api/admin/president/chat', (req, res) => {
    if (!seat(req, res, actorId, 'president')) return;
    res.json({ lines: presChat.thread(String(req.query.thread ?? 'main'), 100) });
  });

  app.post('/api/admin/president/chat', async (req, res) => {
    const s = seat(req, res, actorId, 'president');
    if (!s) return;
    const text = String(req.body?.text ?? '').trim().slice(0, 4000);
    const thread = String(req.body?.thread ?? 'main').slice(0, 40) || 'main';
    if (!text) {
      res.status(400).json({ error: 'empty' });
      return;
    }
    const reply = await presidentTurn(text, thread);
    presChat.add({ id: store.nextId('pc'), thread, role: 'owner', text, at: store.iso() });
    const line = presChat.add({ id: store.nextId('pc'), thread, role: 'president', text: reply, at: store.iso() });
    res.json({ reply: line, approvalsWaiting: presPosts.all().filter((p) => p.status === 'pending').length });
  });

  app.post('/api/admin/president/decide/:id', (req, res) => {
    const s = seat(req, res, actorId, 'president');
    if (!s) return;
    const decision = req.body?.decision === 'deny' ? 'deny' : req.body?.decision === 'approve' ? 'approve' : null;
    if (!decision) {
      res.status(400).json({ error: 'decision must be approve or deny' });
      return;
    }
    const result = decide(req.params.id!, decision, s.access.email || s.userId);
    if (!result.ok) {
      res.status(result.error === 'not_found' ? 404 : 409).json(result);
      return;
    }
    res.json(result);
  });

  app.post('/api/admin/president/briefing', async (req, res) => {
    const s = seat(req, res, actorId, 'president');
    if (!s) return;
    const post = await dailyBriefing();
    const emailed = await emailOwners(post.title, post.body);
    writeAudit(s.access.email || s.userId, 'president_briefing', post.id, { emailed });
    res.json({ post, emailed });
  });

  /* Ore, the member's assistant */
  app.get('/api/ore/status', (req, res) => {
    res.json({ enabled: Boolean(valueOf('features.ore')), available: providerConfigured('anthropic', 'ore') || providerConfigured(seatOf('ore').provider, 'ore'), president: presidentName() });
  });

  app.post('/api/ore/chat', async (req, res) => {
    const userId = actorId(req);
    if (!userId || !users.get(userId)) {
      res.status(401).json({ error: 'sign_in' });
      return;
    }
    if (!valueOf('features.ore')) {
      res.status(503).json({ error: 'ore_off' });
      return;
    }
    const text = String(req.body?.text ?? '').trim().slice(0, 2000);
    if (!text) {
      res.status(400).json({ error: 'empty' });
      return;
    }
    const history = (Array.isArray(req.body?.history) ? (req.body.history as { role?: string; text?: string }[]) : [])
      .slice(-10)
      .map((m): Message => ({ role: m.role === 'ore' ? 'assistant' : 'user', content: String(m.text ?? '').slice(0, 2000) }))
      .filter((m) => (m.content as string).length > 0);
    while (history.length && history[0]!.role !== 'user') history.shift();
    const messages: Message[] = [...history, { role: 'user', content: text }];
    // Merge consecutive same-role turns (the API wants alternation).
    const merged: Message[] = [];
    for (const m of messages) {
      const last = merged[merged.length - 1];
      if (last && last.role === m.role && typeof last.content === 'string') last.content = `${last.content}\n\n${m.content as string}`;
      else merged.push({ ...m });
    }

    const reported: PresPost[] = [];
    for (let step = 0; step < 3; step++) {
      const result = await call({ seat: 'ore', role: 'ore', system: ORE_SYSTEM(), tools: ORE_TOOLS, messages: merged, maxTokens: 800 });
      if (!result.ok) {
        res.status(503).json({ error: 'ore_unavailable', reply: "I can't answer right now — please try again in a moment." });
        return;
      }
      merged.push({ role: 'assistant', content: result.content });
      if (!result.toolUses.length) {
        res.json({ reply: result.text.trim(), reported: reported.map((r) => ({ id: r.id, title: r.title })) });
        return;
      }
      const results: Block[] = [];
      for (const use of result.toolUses.slice(0, 3)) {
        if (use.name === 'report_to_president' && reported.length < 3) {
          const post = fileRequest({
            kind: String(use.input.kind ?? 'feedback'),
            title: String(use.input.title ?? '').slice(0, 160) || 'Member request',
            body: String(use.input.detail ?? ''),
            memberId: userId,
            device: String(req.header('x-mm-platform') ?? 'app'),
          });
          reported.push(post);
          results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Sent to President Ore.' });
        } else {
          results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'Not available.' });
        }
      }
      merged.push({ role: 'user', content: results });
    }
    res.json({ reply: 'I’ve passed that on to President Ore.', reported: reported.map((r) => ({ id: r.id, title: r.title })) });
  });

}

/** Call after the store is restored: seeds the office once and starts the daily briefing clock. */
export function startAiCompany(): void {
  startPresident((post) => {
    void emailOwners(post.title, post.body);
  });
}
