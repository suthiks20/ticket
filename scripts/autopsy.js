// Build a post-run incident report from local audit and status files only.
'use strict';

const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_AUDIT_PATH = path.join(ROOT, 'results', 'audit.ndjson');
const DEFAULT_STATUS_PATH = path.join(ROOT, 'results', 'final-status.json');
const REPORT_PATH = path.join(ROOT, 'results', 'incident-report.md');
const OUTCOMES = new Set(['confirmed', 'sold_out', 'in_doubt', 'error']);
const CATEGORY_NAMES = [
  'confirmed_first_try',
  'confirmed_after_retry',
  'sold_out',
  'in_doubt_resolved',
  'in_doubt_unresolved',
  'lost',
];

function extractRawRequestId(line, requestId) {
  const match = line.match(/"request_id"\s*:\s*("(?:\\.|[^"\\])*"|null|true|false|-?\d+(?:\.\d+)?)/);
  return match ? match[1] : JSON.stringify(requestId);
}

async function readAuditLog(filePath) {
  const attemptsByRequestId = new Map();
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;

  for await (const line of lines) {
    lineNumber++;
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (err) {
      throw new Error(`Invalid NDJSON at line ${lineNumber}: ${err.message}`);
    }
    if (record.request_id === undefined || record.timestamp === undefined || !OUTCOMES.has(record.outcome)) {
      throw new Error(`Audit line ${lineNumber} is missing request_id/timestamp or has an invalid outcome.`);
    }
    const timestampMs = Date.parse(record.timestamp);
    if (!Number.isFinite(timestampMs)) throw new Error(`Invalid timestamp at audit line ${lineNumber}.`);

    const requestId = String(record.request_id);
    const attempt = {
      ...record,
      requestId,
      timestampMs,
      rawLine: line,
      rawRequestId: extractRawRequestId(line, record.request_id),
      lineNumber,
    };
    if (!attemptsByRequestId.has(requestId)) attemptsByRequestId.set(requestId, []);
    attemptsByRequestId.get(requestId).push(attempt);
  }

  for (const attempts of attemptsByRequestId.values()) {
    attempts.sort((a, b) => a.timestampMs - b.timestampMs || a.lineNumber - b.lineNumber);
  }
  return attemptsByRequestId;
}

async function readStatusSnapshot(filePath) {
  try {
    const text = await fs.promises.readFile(filePath, 'utf8');
    const body = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (!body || !Array.isArray(body.tickets)) {
      return { available: false, error: 'snapshot does not contain a tickets array' };
    }
    return { available: true, body };
  } catch (err) {
    return { available: false, error: err.code === 'ENOENT' ? 'file not found' : err.message };
  }
}

function detectIncidentWindow(sortedAttempts) {
  const MIN_WINDOW_MS = 2000;
  const intervals = [];
  let right = 0;
  let elevatedCount = 0;

  for (let left = 0; left < sortedAttempts.length; left++) {
    if (right < left) {
      right = left;
      elevatedCount = 0;
    }
    while (right < sortedAttempts.length
      && sortedAttempts[right].timestampMs - sortedAttempts[left].timestampMs <= MIN_WINDOW_MS) {
      if (sortedAttempts[right].outcome === 'error' || sortedAttempts[right].outcome === 'in_doubt') elevatedCount++;
      right++;
    }

    const count = right - left;
    const endIndex = right - 1;
    if (count > 0 && elevatedCount / count > 0.5 && endIndex >= left) {
      intervals.push({
        startMs: sortedAttempts[left].timestampMs,
        endMs: sortedAttempts[endIndex].timestampMs,
      });
    }

    if (left < right && (sortedAttempts[left].outcome === 'error' || sortedAttempts[left].outcome === 'in_doubt')) {
      elevatedCount--;
    }
  }

  if (intervals.length === 0) return null;
  intervals.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged = [];
  for (const interval of intervals) {
    const current = merged[merged.length - 1];
    if (current && interval.startMs <= current.endMs) {
      current.endMs = Math.max(current.endMs, interval.endMs);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged
    .filter((interval) => interval.endMs - interval.startMs >= MIN_WINDOW_MS)
    .sort((a, b) => (b.endMs - b.startMs) - (a.endMs - a.startMs))[0] || null;
}

function groupRequestIds(attemptsByRequestId, statusSnapshot) {
  const statusIds = new Set();
  const statusTicketNumbersById = new Map();
  if (statusSnapshot.available) {
    for (const ticket of statusSnapshot.body.tickets) {
      if (ticket.request_id === undefined || ticket.request_id === null) continue;
      const requestId = String(ticket.request_id);
      statusIds.add(requestId);
      if (!statusTicketNumbersById.has(requestId)) statusTicketNumbersById.set(requestId, new Set());
      if (ticket.ticket_number !== undefined && ticket.ticket_number !== null) {
        statusTicketNumbersById.get(requestId).add(String(ticket.ticket_number));
      }
    }
  }

  const categories = Object.fromEntries(CATEGORY_NAMES.map((name) => [name, []]));
  const recordsById = new Map();
  for (const [requestId, attempts] of attemptsByRequestId) {
    const firstAttempt = attempts[0];
    const lastAttempt = attempts[attempts.length - 1];
    const hadConfirmed = attempts.some((attempt) => attempt.outcome === 'confirmed');
    const hadUncertain = attempts.some((attempt) => attempt.outcome === 'in_doubt' || attempt.outcome === 'error');
    let category;

    if (statusSnapshot.available && hadConfirmed && !statusIds.has(requestId)) {
      category = 'lost';
    } else if (lastAttempt.outcome === 'sold_out') {
      category = 'sold_out';
    } else if (lastAttempt.outcome === 'confirmed') {
      category = attempts.length === 1 ? 'confirmed_first_try' : 'confirmed_after_retry';
    } else if (hadUncertain && statusSnapshot.available && statusIds.has(requestId)) {
      category = 'in_doubt_resolved';
    } else if (hadUncertain) {
      category = 'in_doubt_unresolved';
    } else {
      category = 'in_doubt_unresolved';
    }

    const record = { requestId, attempts, category, rawRequestId: firstAttempt.rawRequestId };
    recordsById.set(requestId, record);
    categories[category].push(record);
  }
  return { categories, recordsById, statusIds, statusTicketNumbersById };
}

function threeExamples(records) {
  if (records.length === 0) return ['"N/A"', '"N/A"', '"N/A"'];
  return [0, 1, 2].map((index) => records[index % records.length].rawRequestId);
}

function findDuplicateTicketNumbers(statusSnapshot, confirmedIds) {
  if (!statusSnapshot.available) return [];
  const ownersByTicket = new Map();
  for (const ticket of statusSnapshot.body.tickets) {
    if (ticket.ticket_number === undefined || ticket.ticket_number === null
      || ticket.request_id === undefined || ticket.request_id === null) continue;
    const requestId = String(ticket.request_id);
    if (!confirmedIds.has(requestId)) continue;
    const ticketNumber = String(ticket.ticket_number);
    if (!ownersByTicket.has(ticketNumber)) ownersByTicket.set(ticketNumber, new Set());
    ownersByTicket.get(ticketNumber).add(requestId);
  }
  return [...ownersByTicket.entries()]
    .filter(([, requestIds]) => requestIds.size > 1)
    .map(([ticketNumber, requestIds]) => ({ ticketNumber, requestIds: [...requestIds] }));
}

function checkIdempotency(afterRetryRecords, statusSnapshot, statusTicketNumbersById) {
  const mismatches = [];
  const unverifiable = [];
  for (const record of afterRetryRecords) {
    const confirmedNumbers = record.attempts
      .filter((attempt) => attempt.outcome === 'confirmed' && attempt.ticket_number !== undefined && attempt.ticket_number !== null)
      .map((attempt) => String(attempt.ticket_number));
    const distinctNumbers = new Set(confirmedNumbers);
    if (distinctNumbers.size === 0) {
      unverifiable.push(record.requestId);
      continue;
    }
    if (distinctNumbers.size > 1) {
      mismatches.push(record.requestId);
      continue;
    }
    if (statusSnapshot.available) {
      const statusNumbers = statusTicketNumbersById.get(record.requestId) || new Set();
      const allNumbers = new Set([...distinctNumbers, ...statusNumbers]);
      if (allNumbers.size > 1) mismatches.push(record.requestId);
    }
  }
  return { mismatches, unverifiable };
}

function createReport({ auditPath, statusPath, attemptsByRequestId, statusSnapshot }) {
  const sortedAttempts = [...attemptsByRequestId.values()].flat().sort((a, b) => a.timestampMs - b.timestampMs || a.lineNumber - b.lineNumber);
  const { categories, statusIds, statusTicketNumbersById } = groupRequestIds(attemptsByRequestId, statusSnapshot);
  const totalAttempts = sortedAttempts.length;
  const totalRequestIds = attemptsByRequestId.size;
  const incident = detectIncidentWindow(sortedAttempts);
  const confirmedIds = new Set(sortedAttempts.filter((attempt) => attempt.outcome === 'confirmed').map((attempt) => attempt.requestId));
  const duplicateTickets = findDuplicateTicketNumbers(statusSnapshot, confirmedIds);
  const afterRetryRecords = categories.confirmed_after_retry;
  const idempotency = checkIdempotency(afterRetryRecords, statusSnapshot, statusTicketNumbersById);
  const lostIds = categories.lost.map((record) => record.requestId);

  const soldCount = statusSnapshot.available && Number.isFinite(statusSnapshot.body.sold)
    ? statusSnapshot.body.sold
    : null;
  const ticketCountValue = statusSnapshot.available
    ? (statusSnapshot.body.ticket_count ?? statusSnapshot.body.ticketCount)
    : null;
  const ticketCount = Number.isFinite(ticketCountValue) ? ticketCountValue : null;

  const summaryCounts = CATEGORY_NAMES.map((name) => `${name}=${categories[name].length}`).join(', ');
  const lines = [
    '# Ticket Stampede Incident Report',
    '',
    `Summary: ${totalRequestIds} request IDs across ${totalAttempts} attempts; ${summaryCounts}.`,
    '',
    '## Incident window',
  ];

  if (incident) {
    const durationSeconds = (incident.endMs - incident.startMs) / 1000;
    lines.push(`Detected: ${new Date(incident.startMs).toISOString()} to ${new Date(incident.endMs).toISOString()} (${durationSeconds.toFixed(3)} seconds).`);
  } else {
    lines.push('No incident window detected.');
  }

  lines.push('', '## Categories and examples');
  for (const category of CATEGORY_NAMES) {
    const records = categories[category];
    const examples = threeExamples(records);
    const note = records.length === 0
      ? ' (no request IDs in this category)'
      : records.length < 3
        ? ' (repeated raw IDs fill the three example slots)'
        : '';
    lines.push(`- ${category}: count=${records.length}; examples: ${examples.join(', ')}${note}`);
  }

  lines.push('', '## Final verdict');
  if (soldCount !== null && ticketCount !== null) {
    lines.push(`Invariant 1 (never oversell): ${soldCount <= ticketCount ? 'PASS' : 'FAIL'} — final sold count was ${soldCount} against a ticket_count of ${ticketCount}`);
  } else {
    lines.push(`Invariant 1 (never oversell): could not be verified — ${soldCount === null ? 'final sold count unavailable' : `ticket_count unavailable in ${path.basename(statusPath)}`}`);
  }

  if (!statusSnapshot.available) {
    lines.push('Invariant 2 (no duplicate ticket numbers): could not be verified — final status snapshot unavailable');
  } else if (duplicateTickets.length === 0) {
    lines.push('Invariant 2 (no duplicate ticket numbers): PASS');
  } else {
    const details = duplicateTickets.map((item) => `${item.ticketNumber} claimed by ${item.requestIds.join(', ')}`).join('; ');
    lines.push(`Invariant 2 (no duplicate ticket numbers): FAIL — ${details}`);
  }

  if (idempotency.unverifiable.length > 0) {
    lines.push(`Invariant 3 (idempotency): could not be verified — ticket_number missing from audit attempts for ${idempotency.unverifiable.join(', ')}`);
  } else if (idempotency.mismatches.length > 0) {
    lines.push(`Invariant 3 (idempotency): FAIL — mismatching request_ids: ${idempotency.mismatches.join(', ')}`);
  } else {
    lines.push(`Invariant 3 (idempotency): PASS — ${afterRetryRecords.length} confirmed_after_retry requests all resolved to a single consistent ticket_number across their own attempts, 0 mismatches found`);
  }

  if (!statusSnapshot.available) {
    lines.push('Invariant 4 could not be verified — final-status.json not provided');
  } else if (lostIds.length === 0) {
    lines.push('Invariant 4 (no lost confirmed sales): PASS — 0 requests in the lost category');
  } else {
    lines.push(`Invariant 4 (no lost confirmed sales): FAIL — lost request_ids: ${lostIds.join(', ')}`);
  }

  lines.push('', '## Recovery duration');
  if (!incident) {
    lines.push('Not applicable — no incident window detected.');
  } else {
    const lastUncertain = sortedAttempts
      .filter((attempt) => attempt.timestampMs >= incident.startMs && attempt.timestampMs <= incident.endMs
        && (attempt.outcome === 'error' || attempt.outcome === 'in_doubt'))
      .reduce((latest, attempt) => Math.max(latest, attempt.timestampMs), -Infinity);
    const firstConfirmed = sortedAttempts.find((attempt) => attempt.timestampMs > lastUncertain && attempt.outcome === 'confirmed');
    if (firstConfirmed && Number.isFinite(lastUncertain)) {
      lines.push(`${((firstConfirmed.timestampMs - lastUncertain) / 1000).toFixed(3)} seconds from the last error/in_doubt attempt in the incident window to the first subsequent confirmed attempt (${new Date(lastUncertain).toISOString()} to ${new Date(firstConfirmed.timestampMs).toISOString()}).`);
    } else {
      lines.push('Not observed — no subsequent confirmed attempt was found after the incident window.');
    }
  }

  lines.push('', `Audit log: ${auditPath}`, `Status snapshot: ${statusSnapshot.available ? statusPath : 'unavailable'}`, '');
  return lines.join('\n');
}

async function main() {
  const auditPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : DEFAULT_AUDIT_PATH;
  const statusPath = process.argv[3] ? path.resolve(process.cwd(), process.argv[3]) : DEFAULT_STATUS_PATH;
  const [attemptsByRequestId, statusSnapshot] = await Promise.all([
    readAuditLog(auditPath),
    readStatusSnapshot(statusPath),
  ]);
  const report = createReport({ auditPath, statusPath, attemptsByRequestId, statusSnapshot });
  await fs.promises.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.promises.writeFile(REPORT_PATH, report, 'utf8');
  console.log(`Wrote incident report: ${REPORT_PATH}`);
  if (!statusSnapshot.available) {
    console.log('Invariant 4 could not be verified — final-status.json not provided');
  }
}

main().catch((err) => {
  console.error('Autopsy failed:', err.message);
  process.exitCode = 1;
});