-- Sales table
CREATE TABLE IF NOT EXISTS sales (
  sale_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_count INT NOT NULL,
  is_active BOOLEAN DEFAULT false,
  sold_out BOOLEAN DEFAULT false
);

-- Prevent multiple active sales concurrently
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_active
ON sales (is_active)
WHERE is_active = true;

-- Tickets table
CREATE TABLE IF NOT EXISTS tickets (
  sale_id UUID NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
  ticket_number INT NOT NULL,
  user_id TEXT,
  request_id TEXT,
  PRIMARY KEY (sale_id, ticket_number)
);

-- Composite uniqueness for idempotency (allow NULL request_id for unclaimed)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_request
ON tickets (sale_id, request_id)
WHERE request_id IS NOT NULL;

-- Partial index for fast available ticket lookup
CREATE INDEX IF NOT EXISTS idx_tickets_available
ON tickets (sale_id, ticket_number)
WHERE user_id IS NULL;
