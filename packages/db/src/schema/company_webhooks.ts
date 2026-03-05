import { pgTable, uuid, text, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const companyWebhooks = pgTable(
  "company_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: jsonb("events").notNull().$type<string[]>(),
    active: boolean("active").notNull().default(true),
    description: text("description"),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    lastDeliveryStatus: text("last_delivery_status"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("company_webhooks_company_id_idx").on(table.companyId),
  }),
);
