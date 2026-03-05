CREATE TABLE IF NOT EXISTS "company_webhooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "secret" text NOT NULL,
  "events" jsonb NOT NULL DEFAULT '[]',
  "active" boolean NOT NULL DEFAULT true,
  "description" text,
  "last_delivery_at" timestamp with time zone,
  "last_delivery_status" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "company_webhooks_company_id_idx" ON "company_webhooks" ("company_id");
