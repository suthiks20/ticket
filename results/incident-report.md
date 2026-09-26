# Ticket Stampede Incident Report

Summary: 1839 request IDs across 12023 attempts; confirmed_first_try=921, confirmed_after_retry=79, sold_out=689, in_doubt_resolved=0, in_doubt_unresolved=150, lost=0.

## Incident window
Detected: 2026-09-26T04:45:05.057Z to 2026-09-26T04:45:24.535Z (19.478 seconds).

## Categories and examples
- confirmed_first_try: count=921; examples: "req-0", "req-1", "req-2"
- confirmed_after_retry: count=79; examples: "req-4", "req-24", "req-66"
- sold_out: count=689; examples: "req-1000", "req-1001", "req-1002"
- in_doubt_resolved: count=0; examples: "N/A", "N/A", "N/A" (no request IDs in this category)
- in_doubt_unresolved: count=150; examples: "req-1089", "req-1092", "req-1090"
- lost: count=0; examples: "N/A", "N/A", "N/A" (no request IDs in this category)

## Final verdict
Invariant 1 (never oversell): PASS — final sold count was 1000 against a ticket_count of 1000
Invariant 2 (no duplicate ticket numbers): PASS
Invariant 3 (idempotency): PASS — 79 confirmed_after_retry requests all resolved to a single consistent ticket_number across their own attempts, 0 mismatches found
Invariant 4 (no lost confirmed sales): PASS — 0 requests in the lost category

## Recovery duration
Not observed — no subsequent confirmed attempt was found after the incident window.

Audit log: C:\Users\suthikshan k\Desktop\ticket\results\audit.ndjson
Status snapshot: C:\Users\suthikshan k\Desktop\ticket\results\final-status.json
