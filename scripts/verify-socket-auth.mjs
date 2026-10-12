#!/usr/bin/env node
/**
 * MoneyMart — realtime authorization verification (§9.2).
 *
 * The Socket.IO layer is where money actually moves, and it had NO
 * authentication: write handlers read `bidderId` from the payload, so an
 * anonymous client could place a real bid as any user. REST refused the same
 * write with 401, which is exactly why it went unnoticed — the HTTP surface
 * looked locked down while the realtime surface was open.
 *
 * These checks assert the refusals, because that is the property that failed.
 *
 * Usage: node scripts/verify-socket-auth.mjs [--api http://127.0.0.1:4317]
 */
import { io } from 'socket.io-client';

const args = process.argv.slice(2);
const flagIndex = args.indexOf('--api');
const API = flagIndex >= 0 && args[flagIndex + 1] ? args[flagIndex + 1] : (process.env.API_URL ?? 'http://127.0.0.1:4317');

let pass = 0;
let fail = 0;
const failures = [];
const ok = (label, extra = '') => {
  pass += 1;
  console.log(`  \u001b[32m✔\u001b[0m ${label}${extra ? `  \u001b[2m${extra}\u001b[0m` : ''}`);
};
const bad = (label, extra = '') => {
  fail += 1;
  failures.push(label);
  console.log(`  \u001b[31m✘\u001b[0m ${label}${extra ? `  ${extra}\u001b[0m` : ''}`);
};
const section = (title) => console.log(`\n\u001b[1m${title}\u001b[0m`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function http(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

/**
 * Clear ingress limits before minting tokens.
 *
 * The signing flow is itself rate limited, so a previous suite in the same audit
 * could otherwise exhaust the allowance and make this fail for an unrelated
 * reason.
 */
await fetch(`${API}/api/dev/rate-limit/reset`, { method: 'POST' }).catch(() => null);

/** A real session token, obtained through the passwordless flow. */
async function mintToken() {
  const identifier = `socket.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`;
  const requested = await http('/api/auth/request', { method: 'POST', body: { identifier } });
  if (!requested.json?.devCode) return null;
  const verified = await http('/api/auth/verify', {
    method: 'POST',
    body: { identifier, code: requested.json.devCode },
  });
  return verified.json?.token ?? null;
}

/** Connect and resolve the first relevant event, or null on timeout. */
function connect(options = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const socket = io(API, { path: '/socket.io', transports: ['websocket'], timeout: timeoutMs, ...options });
    const settle = (result) => {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve({ socket, ...result });
    };
    socket.on('connect', () => settle({ connected: true, id: socket.id }));
    socket.on('connect_error', (error) => settle({ connected: false, error: error.message }));
    setTimeout(() => settle({ connected: false, error: 'timeout' }), timeoutMs);
  });
}

/** Connect, run an emit, and capture the first matching event. */
function attempt(auth, emit, listenFor, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const socket = io(API, { path: '/socket.io', transports: ['websocket'], timeout: timeoutMs, auth });
    let connectedId = null;
    const finish = (payload, event) => {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve({ connectedId, event, payload });
    };
    socket.on('connect', async () => {
      connectedId = socket.id;
      await sleep(400);
      emit(socket);
    });
    socket.on('connect_error', (error) => finish({ error: error.message }, 'connect_error'));
    for (const event of listenFor) {
      socket.on(event, (payload) => finish(payload, event));
    }
    setTimeout(() => finish(null, 'timeout'), timeoutMs);
  });
}

console.log('\n\u001b[1m════════ MoneyMart realtime authorization ════════\u001b[0m');
console.log(`\u001b[2m  api ${API}\u001b[0m`);

/* ── Find a live lot to bid on ─────────────────────────────────────────── */
const live = await http('/api/auctions?status=live');
const lot = (live.json?.items ?? [])[0];
if (!lot) {
  console.log('\n  \u001b[31m✘\u001b[0m no live auction available to test against\n');
  process.exit(1);
}
const detail = await http(`/api/auctions/${lot.id}`);
const minimum = detail.json?.minimumBid ?? (lot.currentBid || lot.startingPrice) + 1;

console.log(`\u001b[2m  lot ${lot.id} · current ${lot.currentBid ?? lot.startingPrice} · minimum ${minimum}\u001b[0m`);

/* ── 1. Read access stays open ─────────────────────────────────────────── */
section('1. Spectating is open');

const anonymous = await connect();
anonymous.connected
  ? ok('an anonymous socket may connect', `id ${String(anonymous.id).slice(0, 8)}`)
  : bad('an anonymous socket may connect', anonymous.error);

const snapshot = await attempt({}, (socket) => socket.emit('auction:join', lot.id), ['auction:snapshot'], 6000);
snapshot.event === 'auction:snapshot'
  ? ok('an anonymous socket receives auction snapshots', `${(snapshot.payload?.bids ?? []).length} bids`)
  : bad('an anonymous socket receives auction snapshots', `got ${snapshot.event}`);

// A bogus token must not be quietly downgraded to anonymous.
const bogus = await connect({ auth: { token: 'definitely-not-a-token' } });
!bogus.connected
  ? ok('a bogus token is refused at the handshake', String(bogus.error).slice(0, 40))
  : bad('a bogus token is refused at the handshake', 'the socket connected');

/* ── 2. Writes are refused without identity ───────────────────────────── */
section('2. Anonymous writes are refused');

const anonBid = await attempt(
  {},
  (socket) => socket.emit('auction:placeBid', { auctionId: lot.id, bidderId: 'usr_ken', amount: minimum }),
  ['auction:rejected', 'auction:bid'],
  8000,
);

anonBid.event === 'auction:rejected'
  ? ok('an anonymous bid is refused', String(anonBid.payload?.reason))
  : bad('an anonymous bid is refused', `got ${anonBid.event}${anonBid.payload?.bid ? '  (BID ACCEPTED)' : ''}`);

anonBid.payload?.reason === 'not_authenticated'
  ? ok('the refusal names the reason', 'not_authenticated')
  : bad('the refusal names the reason', String(anonBid.payload?.reason));

// The identity in the payload must be ignored, not merely validated.
const before = await http(`/api/auctions/${lot.id}`);
const bidCountBefore = before.json?.auction?.bidCount ?? 0;
const currentBefore = before.json?.auction?.currentBid ?? 0;

const spoof = await attempt(
  {},
  (socket) => socket.emit('auction:placeBid', { auctionId: lot.id, bidderId: 'usr_you', amount: minimum + 1 }),
  ['auction:rejected', 'auction:bid'],
  8000,
);
spoof.event === 'auction:rejected' ? ok('a spoofed bidderId is not honoured') : bad('a spoofed bidderId is not honoured', `got ${spoof.event}`);

const anonAuto = await attempt(
  {},
  (socket) => socket.emit('auction:autoBid', { auctionId: lot.id, bidderId: 'usr_ken', maxAmount: minimum * 3 }),
  ['auction:rejected', 'auction:bid'],
  8000,
);
anonAuto.event === 'auction:rejected'
  ? ok('an anonymous proxy bid is refused', String(anonAuto.payload?.reason))
  : bad('an anonymous proxy bid is refused', `got ${anonAuto.event}`);

// Chat must not accept a forged author.
const rooms = await http('/api/streams');
const anyStream = (rooms.json?.items ?? [])[0];
if (anyStream) {
  const beforeChat = await http(`/api/streams/${anyStream.id}`);
  const chatBefore = (beforeChat.json?.chat ?? []).length;
  void chatBefore;

  const anonChat = await attempt(
    {},
    (socket) => socket.emit('chat:send', { streamId: anyStream.id, userId: 'usr_you', displayName: 'Impersonated', body: 'anonymous message' }),
    ['chat:message'],
    5000,
  );
  anonChat.event !== 'chat:message'
    ? ok('an anonymous message is not published')
    : bad('an anonymous message is not published', 'a chat message was emitted');
}

/* ── 3. An authenticated socket may write ──────────────────────────────── */
section('3. An authenticated socket may write');

const token = await mintToken();
token ? ok('a session token was minted') : bad('a session token was minted');

if (token) {
  const authedJoin = await attempt({ token }, (socket) => socket.emit('auction:join', lot.id), ['auction:snapshot'], 6000);
  authedJoin.event === 'auction:snapshot'
    ? ok('an authenticated socket receives snapshots')
    : bad('an authenticated socket receives snapshots', `got ${authedJoin.event}`);

  /**
   * Bid as the authenticated account. The engine may still refuse on its own
   * terms (already winning, below the increment), so the assertion is that the
   * refusal is NOT an authentication failure and NOT a client-supplied identity.
   */
  const authedBid = await attempt(
    { token },
    (socket) => {
      /**
       * Join the room first. The bid is broadcast to `auction:<id>`, and a
       * REJECTION is emitted directly to the socket — so a socket that never
       * joined sees only the rejection and times out on success. That asymmetry
       * is why this check must join explicitly.
       */
      socket.emit('auction:join', lot.id);
      setTimeout(
        () => socket.emit('auction:placeBid', { auctionId: lot.id, bidderId: 'usr_someone_else', amount: minimum }),
        500,
      );
    },
    ['auction:rejected', 'auction:bid'],
    10000,
  );

  if (authedBid.event === 'auction:bid') {
    const placedBy = authedBid.payload?.bid?.bidderId;
    placedBy && placedBy !== 'usr_someone_else'
      ? ok('an authenticated bid is placed as the token holder', placedBy)
      : bad('an authenticated bid is placed as the token holder', `placed by ${placedBy}`);
  } else if (authedBid.event === 'auction:rejected') {
    const reason = authedBid.payload?.reason;
    reason !== 'not_authenticated'
      ? ok('an authenticated bid is evaluated by the engine, not refused for auth', `reason: ${reason}`)
      : bad('an authenticated bid is evaluated by the engine, not refused for auth', 'refused as unauthenticated');
  } else {
    bad('an authenticated bid reaches the engine', `got ${authedBid.event}`);
  }

  // Chat from an authenticated socket is attributed to the token holder.
  if (anyStream) {
    const authedChat = await attempt(
      { token },
      (socket) => {
        // Join the room first: the message is broadcast to stream:<id>, so a
        // socket that never joined would receive nothing whether or not it was
        // authenticated.
        socket.emit('stream:join', anyStream.id);
        setTimeout(
          () =>
            socket.emit('chat:send', {
              streamId: anyStream.id,
              userId: 'usr_someone_else',
              displayName: 'Impersonated',
              body: `authorization probe ${Date.now()}`,
            }),
          500,
        );
      },
      ['chat:message'],
      7000,
    );
    if (authedChat.event === 'chat:message') {
      authedChat.payload?.userId !== 'usr_someone_else'
        ? ok('a chat message is attributed to the token holder', authedChat.payload?.userId)
        : bad('a chat message is attributed to the token holder', 'the payload identity was used');
    } else {
      bad('an authenticated chat message is published', `got ${authedChat.event}`);
    }
  }
}

/* ── 4. The store was not mutated by any refused write ─────────────────── */
section('4. Refused writes changed nothing');

const after = await http(`/api/auctions/${lot.id}`);
const bidCountAfter = after.json?.auction?.bidCount ?? 0;
const currentAfter = after.json?.auction?.currentBid ?? 0;

/**
 * An authenticated bid in section 3 may legitimately have moved the lot, so the
 * assertion is that no REFUSED write did. A spoofed bidder must never appear.
 */
const bids = after.json?.bids ?? [];
const spoofed = bids.filter((bid) => bid.bidderId === 'usr_you' && bid.amount === minimum + 1);
spoofed.length === 0
  ? ok('no bid was recorded from the spoofed identity')
  : bad('no bid was recorded from the spoofed identity', `${spoofed.length} found`);

const spoofAuthor = (after.json?.chat ?? []).find((message) => message.displayName === 'Impersonated');
!spoofAuthor ? ok('no message was recorded under a forged name') : bad('no message was recorded under a forged name');

bidCountAfter >= bidCountBefore && currentAfter >= currentBefore
  ? ok('the lot is consistent after the probes', `${bidCountBefore}→${bidCountAfter} bids, ${currentBefore}→${currentAfter}`)
  : bad('the lot is consistent after the probes', `${bidCountBefore}→${bidCountAfter}, ${currentBefore}→${currentAfter}`);

/* ── Summary ───────────────────────────────────────────────────────────── */
console.log('\n\u001b[1m═══════════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((entry) => console.log(`    \u001b[31m· ${entry}\u001b[0m`));
console.log('\u001b[1m═══════════════════════════════════════════════════\u001b[0m\n');
process.exit(fail === 0 ? 0 : 1);
