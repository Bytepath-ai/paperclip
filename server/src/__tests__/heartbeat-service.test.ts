import { describe, expect, it } from "vitest";
import { heartbeatService } from "../services/heartbeat.js";
import { createMockDb } from "./helpers/mock-db.js";

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    companyId: "company-1",
    name: "Worker",
    role: "general",
    title: null,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "process",
    adapterConfig: {},
    runtimeConfig: {},
    contextMode: "thin",
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    lastHeartbeatAt: null,
    permissions: null,
    metadata: null,
    icon: null,
    createdAt: new Date("2026-03-05T09:00:00.000Z"),
    updatedAt: new Date("2026-03-05T09:00:00.000Z"),
    ...overrides,
  };
}

describe("heartbeatService", () => {
  it("rejects wakeups for paused agents before queueing anything", async () => {
    const mockDb = createMockDb({
      select: [[makeAgent({ status: "paused" })]],
    });

    const service = heartbeatService(mockDb.db);

    await expect(service.wakeup("22222222-2222-4222-8222-222222222222")).rejects.toMatchObject({
      status: 409,
      message: "Agent is not invokable in its current state",
      details: { status: "paused" },
    });
    expect(mockDb.history.inserts).toHaveLength(0);
  });

  it("records a skipped wakeup when on-demand wakes are disabled", async () => {
    const mockDb = createMockDb({
      select: [[makeAgent({ runtimeConfig: { heartbeat: { wakeOnDemand: false } } })]],
      insert: [undefined],
    });

    const service = heartbeatService(mockDb.db);
    const result = await service.wakeup("22222222-2222-4222-8222-222222222222", {
      source: "on_demand",
      reason: "manual_ping",
    });

    expect(result).toBeNull();
    expect(mockDb.history.inserts[0]?.valuesArg).toMatchObject({
      companyId: "company-1",
      agentId: "22222222-2222-4222-8222-222222222222",
      status: "skipped",
      reason: "heartbeat.wakeOnDemand.disabled",
      finishedAt: expect.any(Date),
    });
  });

  it("checks only active agents with enabled timer policies during scheduler ticks", async () => {
    const now = new Date("2026-03-05T10:00:00.000Z");
    const mockDb = createMockDb({
      select: [[
        makeAgent({ id: "a", status: "paused", runtimeConfig: { heartbeat: { enabled: true, intervalSec: 60 } } }),
        makeAgent({ id: "b", status: "terminated", runtimeConfig: { heartbeat: { enabled: true, intervalSec: 60 } } }),
        makeAgent({ id: "c", runtimeConfig: { heartbeat: { enabled: false, intervalSec: 60 } } }),
        makeAgent({
          id: "d",
          runtimeConfig: { heartbeat: { enabled: true, intervalSec: 60 } },
          lastHeartbeatAt: new Date("2026-03-05T09:59:45.000Z"),
        }),
      ]],
    });

    const service = heartbeatService(mockDb.db);
    const result = await service.tickTimers(now);

    expect(result).toEqual({ checked: 1, enqueued: 0, skipped: 0 });
    expect(mockDb.history.inserts).toHaveLength(0);
  });
});
