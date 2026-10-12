#!/usr/bin/env node
/**
 * MoneyMart — realtime (Socket.IO) verification suite.
 *
 * The product's central claim is sub-second, broadcast real-time bidding. The
 * REST suite cannot prove that, so this suite opens real WebSocket connections
 * and asserts the §9.2 broadcast contract end to end:
 *
 *   1. connection + join handshake
 *   2. room snapshot on join
 *   3. bid broadcast fan-out to multiple independent clients
 *   4. winning/outbid status propagation
 *   5. outbid notification delivered to the displaced bidder's personal room
 *   6. anti-snipe extension broadcast
 *   7. viewer-count broadcast on stream join/leave
 *   8. chat fan-out and pin broadcast
 *   9. concurrent bidders keep the ladder consistent
 *  10. measured broadcast latency against the blueprint's sub-second budget
 *
 * Usage: node scripts/verify-realtime.mjs [--api http://127.0.0.1:4317]
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
  console.log(`  \u001b[31m✘\u001b[0m ${label}${extra ? `  ${extra}` : ''}`);
};
const section = (title) => console.log(`\n\u001b[1m${title}\u001b[0m`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, init) {
  try {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    return { status: response.status, json: await response.json().catch(() => null) };
  } catch (error) {
    return { status: 0, json: null, error: String(error?.message ?? error) };
  }
}

/**
 * Session tokens for the demo accounts.
 *
 * The realtime layer requires a verified identity, so a socket that writes must
 * carry a real token. Weakening the guard for tests would defeat the point of
 * having it, so the suite mints genuine sessions through the dev-only endpoint
 * (which production refuses) and authenticates the handshake properly.
 */
const tokenCache = new Map();
async function tokenFor(userId) {
  if (tokenCache.has(userId)) return tokenCache.get(userId);
  const response = await api('/api/dev/token', { method: 'POST', body: { userId } });
  const token = response.json?.token ?? null;
  if (token) tokenCache.set(userId, token);
  return token;
}

/** Open a socket and resolve once connected (or reject on timeout). */
async function connect(userId, { joinUser = true } = {}) {
  const token = await tokenFor(userId);
  return new Promise((resolve, reject) => {
    const socket = io(API, {
      path: '/socket.io',
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 8000,
      // The handshake carries the verified identity; payload ids are ignored.
      auth: { token },
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('socket connect timeout'));
    }, 9000);
    socket.on('connect', () => {
      clearTimeout(timer);
      if (joinUser && userId) socket.emit('user:join', userId);
      resolve(socket);
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(new Error(`connect_error: ${error.message}`));
    });
  });
}

/** Wait for one event, or resolve null after the timeout. */
function waitFor(socket, event, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, timeoutMs);
    const handler = (payload) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

const sockets = [];

console.log('\n\u001b[1m════════ MoneyMart — realtime (Socket.IO) verification ════════\u001b[0m');
console.log(`\u001b[2m  api ${API}\u001b[0m`);

try {
  /* ── 0. Known-good state ─────────────────────────────────────────────── */
  section('0. Reset to a known-good auction house');
  const reset = await api('/api/dev/reset', { method: 'POST' });
  reset.json?.ok === true
    ? ok('seeded world rebuilt', `${reset.json.auctions} lots · ${reset.json.streams} streams`)
    : bad('seeded world rebuilt', `status ${reset.status}`);

  /* ── 1. Handshake ────────────────────────────────────────────────────── */
  section('1. Connection handshake');
  const buyer = await connect('usr_you');
  sockets.push(buyer);
  ok('client connects over websocket', `id ${buyer.id?.slice(0, 8)}`);

  /* ── 2. Room snapshot ────────────────────────────────────────────────── */
  section('2. Room join snapshot (§9.2)');
  const detail = await api('/api/auctions/auc_rolex');
  const auctionId = 'auc_rolex';
  const snapshotPromise = waitFor(buyer, 'auction:snapshot');
  buyer.emit('auction:join', auctionId);
  const snapshot = await snapshotPromise;
  snapshot?.auction?.id === auctionId
    ? ok('snapshot delivered on join', `${snapshot.bids.length} bids · current ${snapshot.auction.currentBid}`)
    : bad('snapshot delivered on join', 'no payload');

  /* ── 3. Broadcast fan-out ────────────────────────────────────────────── */
  section('3. Bid broadcast fan-out to independent clients');
  const watcherA = await connect('usr_sofia');
  const watcherB = await connect('usr_ken');
  sockets.push(watcherA, watcherB);

  for (const socket of [watcherA, watcherB]) {
    socket.emit('auction:join', auctionId);
  }
  await sleep(300);

  const before = (await api(`/api/auctions/${auctionId}`)).json;
  const bidAmount = before.minimumBid;
  // The engine rejects a bid from the current leader ('already_winning'), so pick
  // a challenger who is not holding the top of the ladder.
  const challenger = before.auction.currentBidderId === 'usr_sofia' ? 'usr_ken' : 'usr_sofia';

  const seenA = waitFor(watcherA, 'auction:bid');
  const seenB = waitFor(watcherB, 'auction:bid');
  const seenBuyer = waitFor(buyer, 'auction:bid');

  /**
   * Bid from the seat OWNING the challenger identity.
   *
   * Each socket is authenticated as one demo user and the server ignores any
   * `bidderId` in the payload, so emitting as usr_ken from usr_sofia's socket is
   * refused — which is the whole point of the realtime auth work. The seat must
   * match the identity it acts as.
   */
  const bidderSeat = challenger === 'usr_sofia' ? watcherA : watcherB;
  bidderSeat.emit('auction:placeBid', { auctionId, amount: bidAmount });

  const [payloadA, payloadB, payloadBuyer] = await Promise.all([seenA, seenB, seenBuyer]);
  const allThree = Boolean(payloadA && payloadB && payloadBuyer);
  allThree
    ? ok('every joined client received the bid', `price ${payloadA.auction.currentBid}`)
    : bad('every joined client received the bid', `A:${!!payloadA} B:${!!payloadB} buyer:${!!payloadBuyer}`);

  payloadA?.bid?.bidderId === challenger && payloadA?.auction?.currentBid === bidAmount
    ? ok('broadcast carries the accepted bid and new price', `${challenger} at ${bidAmount}`)
    : bad('broadcast carries the accepted bid and new price', JSON.stringify(payloadA?.bid ?? null).slice(0, 80));

  payloadA?.bid?.status === 'winning'
    ? ok('accepted bid is marked winning on the ladder')
    : bad('accepted bid is marked winning on the ladder', `status ${payloadA?.bid?.status}`);

  /* ── 4. Outbid propagation ───────────────────────────────────────────── */
  section('4. Outbid propagation (§4.1 Step 5)');
  await sleep(200);
  const current = (await api(`/api/auctions/${auctionId}`)).json;
  const displacedBidder = current.auction.currentBidderId;
  // Bidding from any OTHER connection proves the personal outbid room routing.
  const outbidSeat = displacedBidder === 'usr_sofia' ? watcherA : watcherB;
  const raiserSeat = displacedBidder === 'usr_sofia' ? watcherB : watcherA;
  const raiser = displacedBidder === 'usr_sofia' ? 'usr_ken' : 'usr_sofia';

  const displaced = waitFor(outbidSeat, 'notification', 4000);
  // The seat owning the raiser identity must be the one that bids.
  const raiserSeatOwning = raiser === 'usr_sofia' ? watcherA : watcherB;
  void raiserSeat;
  raiserSeatOwning.emit('auction:placeBid', { auctionId, amount: current.minimumBid });
  const outbidNotice = await displaced;

  outbidNotice?.category === 'bids' && /outbid/i.test(outbidNotice.title ?? '')
    ? ok('displaced bidder receives an outbid notification', `"${outbidNotice.title}"`)
    : bad('displaced bidder receives an outbid notification', JSON.stringify(outbidNotice)?.slice(0, 90));

  const after = (await api(`/api/auctions/${auctionId}`)).json;
  after.bids?.[0]?.status === 'winning'
    ? ok('new leader holds the winning status')
    : bad('new leader holds the winning status', `top status ${after.bids?.[0]?.status}`);

  /* ── 5. Anti-snipe broadcast ─────────────────────────────────────────── */
  section('5. Anti-snipe extension broadcast (§9.2 step 4)');
  await api('/api/dev/clock', { method: 'POST', body: { auctionId: 'auc_kente', secondsFromNow: 4, status: 'live' } });
  watcherA.emit('auction:join', 'auc_kente');
  await sleep(250);

  const kente = (await api('/api/auctions/auc_kente')).json;
  const extensionSeen = waitFor(watcherA, 'auction:extended', 4000);
  watcherB.emit('auction:placeBid', {
    auctionId: 'auc_kente',
    amount: kente.minimumBid,
    bidderId: 'usr_sofia',
    bidderHandle: 'sofiam',
  });
  const extension = await extensionSeen;

  extension?.extensionMs === 30_000
    ? ok('clients are told the clock was extended', `+${extension.extensionMs / 1000}s to ${new Date(extension.endTime).toLocaleTimeString()}`)
    : bad('clients are told the clock was extended', JSON.stringify(extension)?.slice(0, 80));

  /* ── 6. Stream viewer count ──────────────────────────────────────────── */
  section('6. Stream viewer count broadcast');
  const streamId = 'str_bellvault';
  const streamBefore = (await api(`/api/streams/${streamId}`)).json.stream.viewerCount;

  const viewersSeen = waitFor(watcherA, 'stream:viewers', 4000);
  watcherA.emit('stream:join', streamId);
  const viewersPayload = await viewersSeen;

  viewersPayload?.viewerCount > streamBefore
    ? ok('join increments and broadcasts the viewer count', `${streamBefore} → ${viewersPayload.viewerCount}`)
    : bad('join increments and broadcasts the viewer count', JSON.stringify(viewersPayload)?.slice(0, 70));

  const joined = waitFor(watcherA, 'stream:viewers', 4000);
  watcherB.emit('stream:join', streamId);
  const joinedPayload = await joined;
  const afterLeave = waitFor(watcherA, 'stream:viewers', 4000);
  watcherB.emit('stream:leave', streamId);
  const leavePayload = await afterLeave;
  leavePayload && joinedPayload && leavePayload.viewerCount < joinedPayload.viewerCount
    ? ok('leave decrements and broadcasts again', `${joinedPayload.viewerCount} → ${leavePayload.viewerCount}`)
    : bad('leave decrements and broadcasts again', `${joinedPayload?.viewerCount} → ${leavePayload?.viewerCount}`);

  /* ── 7. Chat fan-out + pin ───────────────────────────────────────────── */
  section('7. Chat fan-out and pinning');
  watcherA.emit('stream:join', streamId);
  watcherB.emit('stream:join', streamId);
  await sleep(350);
  const messageSeen = waitFor(watcherB, 'chat:message', 4000);
  watcherA.emit('chat:send', {
    streamId,
    userId: 'usr_sofia',
    displayName: 'Sofia Marchetti',
    body: 'Realtime check from the verification suite',
  });
  const message = await messageSeen;

  message?.body === 'Realtime check from the verification suite'
    ? ok('chat message fanned out to the room', `id ${message.id}`)
    : bad('chat message fanned out to the room', JSON.stringify(message)?.slice(0, 80));

  if (message?.id) {
    /**
     * Pinning is a creator privilege, and the acting socket must BE that creator.
     *
     * Two things were wrong before realtime auth landed: the payload named a
     * creator at all (now ignored), and it named one who does not own the room.
     * The seat must log in as the stream's actual creator.
     */
    const streamOwner = (await api(`/api/streams/${streamId}`)).json?.stream?.creatorId;
    const ownerSeat = streamOwner ? await connect(streamOwner) : watcherA;
    sockets.push(ownerSeat);
    ownerSeat.emit('stream:join', streamId);
    await sleep(300);

    const pinSeen = waitFor(watcherB, 'chat:pin', 4000);
    ownerSeat.emit('chat:pin', { streamId, messageId: message.id });
    const pin = await pinSeen;
    pin?.message?.isPinned
      ? ok('pin broadcast marks the message pinned', `by ${streamOwner}`)
      : bad('pin broadcast marks the message pinned', JSON.stringify(pin)?.slice(0, 80));
  }

  /* ── 8. Concurrent bidders keep the ladder consistent ────────────────── */
  section('8. Concurrent bidders (ladder consistency)');
  await api('/api/dev/clock', { method: 'POST', body: { auctionId: 'auc_airmax', secondsFromNow: 900, status: 'live' } });
  const arena = (await api('/api/auctions/auc_airmax')).json;
  const ids = ['usr_you', 'usr_sofia', 'usr_ken'];
  const contenders = [buyer, watcherA, watcherB];

  const start = arena.auction.currentBid;
  const step = arena.minimumBid - arena.auction.currentBid;
  const burst = 9;

  // Fire overlapping bids from three independent connections.
  for (let index = 0; index < burst; index += 1) {
    const idx = index % 3;
    contenders[idx].emit('auction:placeBid', {
      auctionId: 'auc_airmax',
      amount: start + step * (index + 1),
      bidderId: ids[idx],
      bidderHandle: ids[idx],
    });
  }

  await sleep(1400);
  const settled = (await api('/api/auctions/auc_airmax')).json;
  const history = settled.bids ?? [];
  const monotonic = history.every((bid, index) => index === 0 || history[index - 1].amount >= bid.amount);
  const uniqueIds = new Set(history.map((bid) => bid.id)).size === history.length;
  const counted = settled.auction.bidCount === history.length;

  monotonic ? ok('bid ladder stays ordered by amount') : bad('bid ladder stays ordered by amount');
  uniqueIds ? ok('no duplicate bid records under concurrency') : bad('no duplicate bid records under concurrency');
  counted
    ? ok('bidCount matches the recorded ladder', `${settled.auction.bidCount} bids`)
    : bad('bidCount matches the recorded ladder', `count ${settled.auction.bidCount} vs ${history.length} records`);
  settled.auction.currentBid === history[0]?.amount
    ? ok('currentBid equals the top of the ladder', `${settled.auction.currentBid}`)
    : bad('currentBid equals the top of the ladder', `${settled.auction.currentBid} vs ${history[0]?.amount}`);

  /* ── 9. Measured latency ─────────────────────────────────────────────── */
  section('9. Broadcast latency against the sub-second budget');
  const samples = [];
  const latencyAuction = 'auc_hublot';
  watcherA.emit('auction:join', latencyAuction);
  await sleep(300);

  const seats = ['usr_you', 'usr_sofia', 'usr_ken'];

  for (let index = 0; index < 6; index += 1) {
    const currentState = (await api(`/api/auctions/${latencyAuction}`)).json;
    const amount = currentState.minimumBid;
    // Never bid as the sitting leader: the engine would reject before broadcasting.
    const bidderId = seats.find((seat) => seat !== currentState.auction.currentBidderId) ?? 'usr_you';

    const received = waitFor(watcherA, 'auction:bid', 3000);
    const sentAt = process.hrtime.bigint();
    watcherB.emit('auction:placeBid', {
      auctionId: latencyAuction,
      amount,
      bidderId,
      bidderHandle: bidderId,
    });
    const got = await received;
    if (got) {
      const elapsedMs = Number(process.hrtime.bigint() - sentAt) / 1e6;
      samples.push(elapsedMs);
    }
    await sleep(180);
  }

  if (samples.length) {
    const max = Math.max(...samples);
    const avg = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    const withinSubSecond = max < 1000;
    const withinFast = max < 250;
    console.log(`  \u001b[2m${samples.length} samples · avg ${avg.toFixed(1)}ms · max ${max.toFixed(1)}ms\u001b[0m`);
    withinSubSecond
      ? ok('every broadcast landed inside the sub-second budget', `max ${max.toFixed(1)}ms`)
      : bad('every broadcast landed inside the sub-second budget', `max ${max.toFixed(1)}ms`);
    if (withinFast) ok('broadcast latency is well inside 250ms', `avg ${avg.toFixed(1)}ms`);
  } else {
    bad('collected latency samples');
  }
} catch (error) {
  bad('realtime suite completed without an exception', String(error?.message ?? error));
} finally {
  for (const socket of sockets) {
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  }
}

console.log('\n\u001b[1m═══════════════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((entry) => console.log(`    \u001b[31m· ${entry}\u001b[0m`));
console.log('\u001b[1m═══════════════════════════════════════════════════════\u001b[0m\n');
process.exit(fail === 0 ? 0 : 1);
