import { z } from "zod";
import { WEBHOOK_EVENTS } from "../types/webhook.js";

export const createWebhookSchema = z.object({
  url: z.string().url().refine((url) => url.startsWith("https://"), "URL must use HTTPS"),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  description: z.string().optional(),
});

export type CreateWebhook = z.infer<typeof createWebhookSchema>;
