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
import { audit, boardMeetings, presChat, presPosts, store, users, type PresPost } from '../store.js';
import { closeMeeting, openMeeting, ownerSays, view } from './boardroom.js';
import { oreTurn } from './ore.js';
import { speak, voiceConfigured } from './voice.js';

const speakLog = new Map<string, number[]>();

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

  /* Boardroom (owner only): round table chaired by the President, or one head in a private room */
  app.get('/api/admin/boardroom', (req, res) => {
    if (!seat(req, res, actorId, 'president')) return;
    res.json({ meetings: boardMeetings.all().slice(0, 50).map((m) => ({ ...view(m), lines: undefined, lineCount: m.lines.length })) });
  });

  app.get('/api/admin/boardroom/:id', (req, res) => {
    if (!seat(req, res, actorId, 'president')) return;
    const m = boardMeetings.get(req.params.id!);
    if (!m) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ meeting: view(m) });
  });

  app.post('/api/admin/boardroom', (req, res) => {
    const s = seat(req, res, actorId, 'president');
    if (!s) return;
    const staffIds = Array.isArray(req.body?.staffIds) ? (req.body.staffIds as unknown[]).map(String).slice(0, 5) : undefined;
    const result = openMeeting({ topic: String(req.body?.topic ?? ''), staffIds, by: s.access.email || s.userId });
    if ('error' in result) {
      res.status(400).json(result);
      return;
    }
    writeAudit(s.access.email || s.userId, 'boardroom_open', result.id, { title: result.topic, kind: result.kind });
    res.status(201).json({ meeting: result });
  });

  app.post('/api/admin/boardroom/:id/say', (req, res) => {
    if (!seat(req, res, actorId, 'president')) return;
    const result = ownerSays(req.params.id!, String(req.body?.text ?? ''));
    if ('error' in result) {
      res.status(result.error === 'not_found' ? 404 : result.error === 'empty' ? 400 : 409).json(result);
      return;
    }
    res.json({ meeting: result });
  });

  app.post('/api/admin/boardroom/:id/close', async (req, res) => {
    const s = seat(req, res, actorId, 'president');
    if (!s) return;
    const result = await closeMeeting(req.params.id!, s.access.email || s.userId);
    if ('error' in result) {
      res.status(result.error === 'not_found' ? 404 : 409).json(result);
      return;
    }
    writeAudit(s.access.email || s.userId, 'boardroom_close', result.id, { title: result.topic, minutes: result.minutesPostId });
    res.json({ meeting: result });
  });

  /* Ore, the member's assistant */
  app.get('/api/ore/status', (req, res) => {
    const voice = voiceConfigured();
    res.json({ enabled: Boolean(valueOf('features.ore')), available: providerConfigured('anthropic', 'ore') || providerConfigured(seatOf('ore').provider, 'ore'), president: presidentName(), voice: voice.cartesia || voice.elevenlabs });
  });

  app.post('/api/ore/chat', async (req, res) => {
    const userId = actorId(req);
    const user = userId ? users.get(userId) : undefined;
    if (!user) {
      res.status(401).json({ error: 'sign_in' });
      return;
    }
    if (!valueOf('features.ore')) {
      res.status(503).json({ error: 'ore_off' });
      return;
    }
    const text = String(req.body?.text ?? '').trim().slice(0, 4000);
    const hasFiles = Array.isArray(req.body?.attachments) && req.body.attachments.length > 0;
    if (!text && !hasFiles) {
      res.status(400).json({ error: 'empty' });
      return;
    }
    const result = await oreTurn({
      user,
      text,
      history: Array.isArray(req.body?.history) ? (req.body.history as { role: string; text: string }[]) : [],
      attachments: req.body?.attachments,
      voice: req.body?.voice === true,
      device: String(req.header('x-mm-platform') ?? req.header('x-moneymart-client') ?? 'app'),
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, reply: result.reply, detail: result.reply });
      return;
    }
    res.json({ reply: result.reply, reported: result.reported.map((r) => ({ id: r.id, title: r.title })) });
  });

  /** Ore's voice for calls: MP3, or 204 when no voice provider answers (the app then uses the phone's voice). */
  app.post('/api/ore/speak', async (req, res) => {
    const userId = actorId(req);
    if (!userId || !users.get(userId)) {
      res.status(401).json({ error: 'sign_in' });
      return;
    }
    const now = Date.now();
    const recent = (speakLog.get(userId) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= 300) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    speakLog.set(userId, [...recent, now]);
    const spoken = await speak(String(req.body?.text ?? ''));
    if (!spoken) {
      res.status(204).end();
      return;
    }
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('x-ore-voice', spoken.provider);
    res.send(spoken.audio);
  });

}

/** Call after the store is restored: seeds the office once and starts the daily briefing clock. */
export function startAiCompany(): void {
  startPresident((post) => {
    void emailOwners(post.title, post.body);
  });
}
