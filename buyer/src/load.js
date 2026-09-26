// buyer/src/load.js — adds P50/P99, duplicate-ID probing, pacing, in-doubt tracking, safe /status check
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, arr) => {
    if (v.startsWith('--')) acc.push([v.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const BASE_URL = args.url || 'http://localhost:3000';
const TICKETS = Number(args.tickets || 100);
const TOTAL = Number(args.total || 500);
const CONCURRENCY = Number(args.concurrency || 500);
const DUP_RATE = Number(args['dup-rate'] || 0.08);
const PACED = args.paced === 'true';
const DURATION_MS = Number(args.duration || 60) * 1000;
const retryCountsByRequestId = new Map();
let auditStream;

async function openAuditLog() {
  try {
    const auditPath = path.resolve(__dirname, '../../results/audit.ndjson');
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    const freshLog = process.argv.includes('--fresh-log');
    auditStream = fs.createWriteStream(auditPath, { flags: freshLog ? 'w' : 'a' });
    auditStream.on('error', (err) => {
      console.error('Audit log write failed; continuing without audit logging:', err);
      auditStream = null;
    });
    await new Promise((resolve, reject) => {
      auditStream.once('open', resolve);
      auditStream.once('error', reject);
    });
  } catch (err) {
    console.error('Audit log could not be opened; continuing without audit logging:', err);
    if (auditStream) auditStream.destroy();
    auditStream = null;
  }
}

function recordAttempt(payload, response) {
  if (!auditStream) return;
  const requestId = payload.request_id;
  const retryCount = retryCountsByRequestId.get(requestId) || 0;
  retryCountsByRequestId.set(requestId, retryCount + 1);
  const outcome = response.status === 200
    ? 'confirmed'
    : response.status === 409
      ? 'sold_out'
      : response.status === 0 || response.status >= 500
        ? 'in_doubt'
        : 'error';
  auditStream.write(`${JSON.stringify({
    request_id: requestId,
    http_status: response.status,
    latency_ms: response.ms,
    retry_count: retryCount,
    outcome,
    timestamp: new Date().toISOString(),
    ticket_number: response.status === 200 && response.body ? response.body.ticket_number : null,
  })}\n`);
}

function closeAuditLog() {
  if (!auditStream || auditStream.destroyed) return Promise.resolve();
  const stream = auditStream;
  auditStream = null;
  return new Promise((resolve) => stream.end(resolve));
}

function sendRequest(path, method, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(BASE_URL);
    const options = {
      hostname: u.hostname,
      port: u.port || 80,
      path,
      method,
      timeout: 8000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data ? Buffer.byteLength(data) : 0 },
    };
    const t0 = process.hrtime.bigint();
    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (c) => (responseData += c));
      res.on('end', () => {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        let body;
        try { body = JSON.parse(responseData); } catch { body = responseData; }
        resolve({ status: res.statusCode, body, ms });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout', ms: 8000 }); });
    req.on('error', (e) => resolve({ status: 0, error: e.message, ms: Number(process.hrtime.bigint() - t0) / 1e6 }));
    if (data) req.write(data);
    req.end();
  });
}

function buildPayloads(total, dupRate) {
  const out = [];
  let i = 0;
  while (out.length < total) {
    const p = { user_id: `user-${i}`, request_id: `req-${i}` };
    i++;
    out.push(p);
    if (out.length < total && Math.random() < dupRate) out.push({ ...p }); // intentional duplicate
  }
  return out;
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.ceil((p / 100) * sortedArr.length) - 1);
  return sortedArr[Math.max(0, idx)];
}

async function buyWithRetry(payload, deadlineMs) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    const r = await sendRequest('/buy', 'POST', payload);
    recordAttempt(payload, r);
    if (r.status === 200 || r.status === 409 || r.status === 422 || r.status === 400) {
      return { ...r, inDoubt: false };
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  return { status: 0, inDoubt: true };
}

async function main() {
  await openAuditLog();
  console.log(`\n🎯 TARGET: ${TICKETS} tickets | ⚔️ ATTACK: ${TOTAL} requests (dup-rate ${DUP_RATE})`);
  if (PACED) console.log(`⏱️ PACED MODE: spreading over ${DURATION_MS / 1000}s\n`);

  console.log('1. Resetting seller...');
  const resetRes = await sendRequest('/reset', 'POST', { ticket_count: TICKETS });
  if (resetRes.status !== 200) {
    console.error('❌ Reset failed:', resetRes);
    await closeAuditLog();
    process.exit(1);
  }
  console.log('✅ Seller reset.\n');

  const payloads = buildPayloads(TOTAL, DUP_RATE);
  const results = [];
  const ledger = new Map(); 

  console.log('2. Firing requests...');
  if (!PACED) {
    let idx = 0;
    async function worker() {
      while (idx < payloads.length) {
        const p = payloads[idx++];
        const deadlineMs = 15000;
        const r = await buyWithRetry(p, deadlineMs);
        results.push({ ...r, requestId: p.request_id });
        if (r.status === 200) ledger.set(p.request_id, r.body.ticket_number);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } else {
    const interval = DURATION_MS / payloads.length;
    for (let i = 0; i < payloads.length; i++) {
      const p = payloads[i];
      buyWithRetry(p, 20000).then((r) => {
        results.push({ ...r, requestId: p.request_id });
        if (r.status === 200) ledger.set(p.request_id, r.body.ticket_number);
      });
      await new Promise((res) => setTimeout(res, interval));
    }
    while (results.length < payloads.length) await new Promise((r) => setTimeout(r, 500));
  }
  console.log('✅ All requests settled.\n');

  const latencies = results.filter((r) => r.ms != null).map((r) => r.ms).sort((a, b) => a - b);
  const successful = results.filter((r) => r.status === 200);
  const soldOut = results.filter((r) => r.status === 409);
  const inDoubt = results.filter((r) => r.inDoubt);

  const ticketNumbers = successful.map((r) => r.body.ticket_number);
  const uniqueTickets = new Set(ticketNumbers);

  const firstTicketByRequest = new Map();
  const ticketOwnersByFirstClaim = new Map();
  const replayMismatches = [];
  let idempotentReplays = 0;

  for (const result of successful) {
    const requestId = result.requestId;
    const ticketNumber = result.body.ticket_number;
    if (!firstTicketByRequest.has(requestId)) {
      firstTicketByRequest.set(requestId, ticketNumber);
      if (!ticketOwnersByFirstClaim.has(ticketNumber)) {
        ticketOwnersByFirstClaim.set(ticketNumber, new Set());
      }
      ticketOwnersByFirstClaim.get(ticketNumber).add(requestId);
    } else if (firstTicketByRequest.get(requestId) === ticketNumber) {
      idempotentReplays++;
    } else {
      replayMismatches.push({ requestId, firstTicket: firstTicketByRequest.get(requestId), replayTicket: ticketNumber });
    }
  }

  const duplicateTicketOwners = [...ticketOwnersByFirstClaim.entries()]
    .filter(([, requestIds]) => requestIds.size > 1);

  console.log('📊 RESULTS:');
  console.log(`   Total Requests:      ${results.length}`);
  console.log(`   Successful (200):    ${successful.length}`);
  console.log(`   Sold Out (409):      ${soldOut.length}`);
  console.log(`   In-Doubt (unresolved):${inDoubt.length}`);
  console.log(`   Unique Tickets:      ${uniqueTickets.size}`);
  console.log(`   First-time claims:   ${firstTicketByRequest.size}`);
  console.log(`   Idempotent replays:  ${idempotentReplays}`);
  const replayMismatchDetails = replayMismatches.length
    ? replayMismatches.map(({ requestId, firstTicket, replayTicket }) =>
      `${requestId} (first ${firstTicket}, replay ${replayTicket})`).join('; ')
    : 'none';
  console.log(`   Replay ticket mismatches: ${replayMismatchDetails}`);
  console.log(`   Median latency:      ${percentile(latencies, 50).toFixed(1)} ms`);
  console.log(`   P99 latency:         ${percentile(latencies, 99).toFixed(1)} ms\n`);

  console.log('🔍 INVARIANT CHECKS:');
  console.log("   [" + (duplicateTicketOwners.length === 0 ? "PASS" : "FAIL") + "] Invariant 2: No duplicate tickets across distinct request_ids");
  console.log(`   [ℹ️ INFO] Duplicate request_ids sent: ${payloads.length - new Set(payloads.map(p => p.request_id)).size}`);

  if (replayMismatches.length > 0) {
    console.log("   [FAIL] Idempotency replay returned a different ticket: " + replayMismatchDetails);
  } else {
    console.log("   [PASS] Idempotency replays returned their first-claim ticket.");
  }
  console.log('\n3. Cross-checking against /status (source of truth)...');
  const statusRes = await sendRequest('/status', 'GET');
  if (statusRes.status !== 200 || !statusRes.body || !statusRes.body.tickets) {
    console.log('   ⚠️ Could not reach /status cleanly:', statusRes.status, statusRes.error || '');
    console.log('   Retrying once after 3s...');
    await new Promise((r) => setTimeout(r, 3000));
    const retry = await sendRequest('/status', 'GET');
    if (retry.status !== 200 || !retry.body || !retry.body.tickets) {
      console.log('   ❌ FAIL: /status unreachable. Cannot verify Invariant 4.');
      return;
    }
    return finishWithStatus(retry.body, ledger, TICKETS, inDoubt);
  }
  finishWithStatus(statusRes.body, ledger, TICKETS, inDoubt);
}

function finishWithStatus(statusBody, ledger, ticketCount, inDoubt) {
  const serverSold = statusBody.sold;
  const serverTicketNums = new Set(statusBody.tickets.map((t) => t.ticket_number));

  console.log(`   Server says sold: ${serverSold} (max allowed: ${ticketCount})`);
  console.log(`   [${serverSold <= ticketCount ? '✅ PASS' : '❌ FAIL'}] Invariant 1: Never oversell`);

  let lostConfirmed = 0;
  for (const [reqId, ticketNum] of ledger) {
    if (!serverTicketNums.has(ticketNum)) lostConfirmed++;
  }
  console.log(`   [${lostConfirmed === 0 ? '✅ PASS' : '❌ FAIL'}] Invariant 4 (no lost confirmed sales): lost=${lostConfirmed}`);
  console.log(`   In-doubt requests that never resolved: ${inDoubt.length}`);
  console.log('\n🏁 TEST COMPLETE.');
}

main()
  .catch((e) => console.error('Fatal error:', e))
  .finally(() => closeAuditLog());
