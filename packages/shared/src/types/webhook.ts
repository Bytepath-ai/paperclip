export const WEBHOOK_EVENTS = [
  "agent.error",
  "agent.paused",
  "agent.terminated",
  "approval.pending",
  "budget.threshold",
  "issue.blocked",
  "heartbeat.failed",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface CompanyWebhook {
  id: string;
  companyId: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  active: boolean;
  description: string | null;
  lastDeliveryAt: Date | null;
  lastDeliveryStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
}
