# Ticket Stampede Incident Report

Summary: 1814 request IDs across 2079 attempts; confirmed_first_try=887, confirmed_after_retry=113, sold_out=814, in_doubt_resolved=0, in_doubt_unresolved=0, lost=0.

## Incident window
No incident window detected.

## Categories and examples
- confirmed_first_try: count=887; examples: "req-0", "req-448", "req-449"
- confirmed_after_retry: count=113; examples: "req-4", "req-8", "req-14"
- sold_out: count=814; examples: "req-985", "req-979", "req-990"
- in_doubt_resolved: count=0; examples: "N/A", "N/A", "N/A" (no request IDs in this category)
- in_doubt_unresolved: count=0; examples: "N/A", "N/A", "N/A" (no request IDs in this category)
- lost: count=0; examples: "N/A", "N/A", "N/A" (no request IDs in this category)

## Final verdict
Invariant 1 (never oversell): PASS — final sold count was 1000 against a ticket_count of 1000
Invariant 2 (no duplicate ticket numbers): PASS
Invariant 3 (idempotency): PASS — 113 confirmed_after_retry requests all resolved to a single consistent ticket_number across their own attempts, 0 mismatches found
Invariant 4 (no lost confirmed sales): PASS — 0 requests in the lost category

## Recovery duration
Not applicable — no incident window detected.

Audit log: C:\Users\suthikshan k\Desktop\ticket\results\audit.ndjson
Status snapshot: C:\Users\suthikshan k\Desktop\ticket\results\final-status.json
