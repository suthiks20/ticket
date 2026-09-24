# Decisions

## Architecture choices

Node.js keeps the seller and buyer in one language and handles many concurrent network requests with a small runtime footprint. PostgreSQL owns inventory state and enforces the rules that must survive concurrent requests and process restarts.

The fixed implementation will claim pre-allocated ticket rows with `SELECT ... FOR UPDATE SKIP LOCKED`. PostgreSQL transactions and unique constraints keep the claim and idempotency rules close to the data. Redis would add another stateful service and consistency boundary; application-level locks would protect only one process and fail across multiple seller instances.

## Naive versus fixed

A naive read-modify-write flow lets multiple buyers read the same remaining inventory before any of them records a purchase. That race can oversell tickets or issue duplicate numbers. Pre-allocated rows provide one claimable record per ticket; row locks coordinate competing buyers, while database uniqueness constraints provide a final guard against duplicate assignments and request IDs.

## Bottleneck evidence and limits

At low load, request handling is mostly network and application work. Under high concurrency, the expected bottleneck shifts to PostgreSQL transaction lock contention and connection pool exhaustion. The project still needs repeatable benchmark results to quantify that shift; the current buyer and route modules are placeholders, so no measured evidence is available yet.

Known weaknesses:

- Each buy currently requires multiple database round trips; this adds latency and load.
- Docker Desktop on Windows and macOS has weaker fsync durability than bare-metal Linux, so local results do not represent production storage guarantees.
- A single PostgreSQL node is a single point of failure.

## Two more weeks

1. Implement the waitlist state machine with a 30-second expiry.
2. Reduce buy-path round trips by combining the claim into one CTE statement.
3. Run a distributed buyer across multiple machines to show whether the seller is limited by client-side sockets.
