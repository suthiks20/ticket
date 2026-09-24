# Ticket Stampede Brief

Ticket Stampede models a high-demand ticket sale with many buyers arriving at once.
The seller API manages a fixed inventory of tickets.
Buy requests identify both a user and a unique request.
Repeated request IDs must return the original purchase.
The seller must never issue more tickets than inventory contains.
Each ticket number must be assigned at most once.
Status reports the sold count and current ticket holders.
PostgreSQL is responsible for enforcing concurrency correctness.
The buyer client generates concurrent traffic and checks the outcomes.
The project uses Node.js, Fastify, PostgreSQL, and Docker-based chaos testing.
