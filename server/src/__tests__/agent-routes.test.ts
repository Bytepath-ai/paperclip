import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { invokeRouterPath } from "./helpers/http-mocks.js";

const routeMocks = vi.hoisted(() => {
  return {
    agentService: {
      list: vi.fn(),
      getById: vi.fn(),
      getChainOfCommand: vi.fn(),
    },
    accessService: {
      hasPermission: vi.fn(),
      canUser: vi.fn(),
    },
    heartbeatService: {
      wakeup: vi.fn(),
      invoke: vi.fn(),
    },
    approvalService: {},
    issueApprovalService: {},
    issueService: {},
    secretService: {
      normalizeAdapterConfigForPersistence: vi.fn(),
    },
    logActivity: vi.fn(),
  };
});

vi.mock("../services/index.js", () => ({
  agentService: vi.fn(() => routeMocks.agentService),
  accessService: vi.fn(() => routeMocks.accessService),
  approvalService: vi.fn(() => routeMocks.approvalService),
  heartbeatService: vi.fn(() => routeMocks.heartbeatService),
  issueApprovalService: vi.fn(() => routeMocks.issueApprovalService),
  issueService: vi.fn(() => routeMocks.issueService),
  secretService: vi.fn(() => routeMocks.secretService),
  logActivity: routeMocks.logActivity,
}));

const { agentRoutes } = await import("../routes/agents.js");

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    name: "Agent Smith",
    role: "general",
    title: null,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "process",
    adapterConfig: { token: "secret" },
    runtimeConfig: { cwd: "/tmp/workspace" },
    permissions: null,
    metadata: null,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    lastHeartbeatAt: null,
    createdAt: new Date("2026-03-05T09:00:00.000Z"),
    updatedAt: new Date("2026-03-05T10:00:00.000Z"),
    urlKey: "agent-smith",
    icon: null,
    ...overrides,
  };
}

async function invokeAgentRoute(input: {
  method: "get" | "post";
  path: string;
  params?: Record<string, string>;
  actor: Record<string, unknown>;
  body?: Record<string, unknown>;
}) {
  const router = agentRoutes({} as any);
  const result = await invokeRouterPath(router, input);
  if (result.error) {
    errorHandler(result.error, result.req as any, result.res as any, () => {});
  }
  return result.res;
}

describe("agentRoutes", () => {
  beforeEach(() => {
    routeMocks.agentService.list.mockReset();
    routeMocks.agentService.getById.mockReset();
    routeMocks.agentService.getChainOfCommand.mockReset();
    routeMocks.accessService.hasPermission.mockReset();
    routeMocks.accessService.canUser.mockReset();
    routeMocks.heartbeatService.wakeup.mockReset();
    routeMocks.heartbeatService.invoke.mockReset();
    routeMocks.secretService.normalizeAdapterConfigForPersistence.mockReset();
    routeMocks.logActivity.mockReset();
  });

  it("redacts agent configs in company listings for restricted agent viewers", async () => {
    const viewerId = "22222222-2222-4222-8222-222222222222";
    routeMocks.agentService.list.mockResolvedValue([
      makeAgent({ id: "33333333-3333-4333-8333-333333333333" }),
    ]);
    routeMocks.agentService.getById.mockResolvedValue(
      makeAgent({ id: viewerId, adapterConfig: { own: "config" }, runtimeConfig: { own: true } }),
    );
    routeMocks.accessService.hasPermission.mockResolvedValue(false);

    const res = await invokeAgentRoute({
      method: "get",
      path: "/companies/:companyId/agents",
      params: { companyId: "company-1" },
      actor: {
        type: "agent",
        agentId: viewerId,
        companyId: "company-1",
        runId: null,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: "33333333-3333-4333-8333-333333333333",
      adapterConfig: {},
      runtimeConfig: {},
    });
  });

  it("blocks direct configuration reads for agents without config-read privileges", async () => {
    const viewerId = "22222222-2222-4222-8222-222222222222";
    routeMocks.agentService.getById
      .mockResolvedValueOnce(makeAgent({ id: "33333333-3333-4333-8333-333333333333" }))
      .mockResolvedValueOnce(makeAgent({ id: viewerId, permissions: null }));
    routeMocks.accessService.hasPermission.mockResolvedValue(false);

    const res = await invokeAgentRoute({
      method: "get",
      path: "/agents/:id/configuration",
      params: { id: "33333333-3333-4333-8333-333333333333" },
      actor: {
        type: "agent",
        agentId: viewerId,
        companyId: "company-1",
        runId: null,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Missing permission: can create agents" });
  });

  it("passes actor context through self-wakeup requests", async () => {
    const agent = makeAgent({ id: "33333333-3333-4333-8333-333333333333" });
    routeMocks.agentService.getById.mockResolvedValue(agent);
    routeMocks.heartbeatService.wakeup.mockResolvedValue({
      id: "run-1",
      companyId: "company-1",
      agentId: agent.id,
    });
    routeMocks.logActivity.mockResolvedValue(undefined);

    const res = await invokeAgentRoute({
      method: "post",
      path: "/agents/:id/wakeup",
      params: { id: agent.id },
      body: { source: "on_demand", reason: "manual_ping" },
      actor: {
        type: "agent",
        agentId: agent.id,
        companyId: "company-1",
        runId: "run-actor",
      },
    });

    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({ id: "run-1" });
    expect(routeMocks.heartbeatService.wakeup).toHaveBeenCalledWith(agent.id, {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "manual_ping",
      payload: null,
      idempotencyKey: null,
      requestedByActorType: "agent",
      requestedByActorId: agent.id,
      contextSnapshot: {
        triggeredBy: "agent",
        actorId: agent.id,
      },
    });
  });

  it("prevents agents from waking up other agents", async () => {
    const target = makeAgent({ id: "33333333-3333-4333-8333-333333333333" });
    routeMocks.agentService.getById.mockResolvedValue(target);

    const res = await invokeAgentRoute({
      method: "post",
      path: "/agents/:id/wakeup",
      params: { id: target.id },
      body: { source: "on_demand" },
      actor: {
        type: "agent",
        agentId: "44444444-4444-4444-8444-444444444444",
        companyId: "company-1",
        runId: null,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Agent can only invoke itself" });
    expect(routeMocks.heartbeatService.wakeup).not.toHaveBeenCalled();
  });
});
