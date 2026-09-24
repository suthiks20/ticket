# Ticket Stampede

Ticket Stampede is a Node.js and PostgreSQL ticket-sale concurrency assignment. The seller API and buyer load generator are being built in phases.

## Prerequisites

- Node.js 20 or newer
- Docker Engine or Docker Desktop with Docker Compose

## Quick start

Start PostgreSQL, all three seller containers, and Nginx:

```sh
docker compose up --build
```

Send requests through the load balancer at `http://localhost:8080`. The three sellers are also available directly at ports 3001, 3002, and 3003 for diagnosis.

To start a single seller for local development, run `docker compose up --build postgres seller-1` and use `http://localhost:3001`. Stop the stack with `docker compose down`; `docker compose down -v` also removes the PostgreSQL data volume.

## Load and failure scenarios

The buyer CLI and seller routes are currently placeholders: the CLI prints its startup message, the route modules register no endpoints, and the `SELLER_MODE` setting does not yet select different implementations. The commands below describe the planned scenarios; they do not run load tests against this scaffold yet.

The buyer CLI accepts `--url`, `--tickets`, `--total`, `--concurrency`, and `--dup-rate`. When the load generator is implemented, run it from the project root with:

```sh
npm --prefix buyer start -- --url http://localhost:8080 --tickets 100 --total 50000 --concurrency 1000 --dup-rate 0
```

- **Naive:** `SELLER_MODE=naive docker compose up --build`, then run the buyer command above.
- **Fixed:** `SELLER_MODE=fixed docker compose up --build`, then run the buyer command above.
- **Ramp:** run the buyer repeatedly with increasing `--concurrency` values (for example 100, 500, then 1000) and compare the results.
- **DB Kill:** while the buyer is running, execute `docker compose kill postgres`; restore it with `docker compose up -d postgres`.

These scenarios require the buyer load generator and seller endpoint implementations before they can produce meaningful results.
