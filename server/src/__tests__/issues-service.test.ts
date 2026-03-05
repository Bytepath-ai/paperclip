import { describe, expect, it } from "vitest";
import { issueService } from "../services/issues.js";
import { createMockDb } from "./helpers/mock-db.js";

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    projectId: null,
    goalId: null,
    parentId: null,
    title: "Investigate checkout",
    description: null,
    status: "todo",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    createdByAgentId: null,
    createdByUserId: null,
    requestDepth: 0,
    billingCode: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    checkoutRunId: null,
    executionRunId: null,
    assigneeAdapterOverrides: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    updatedAt: new Date("2026-03-05T10:00:00.000Z"),
    createdAt: new Date("2026-03-05T09:00:00.000Z"),
    ...overrides,
  };
}

describe("issueService", () => {
  it("rejects moving an issue to in_progress without any assignee", async () => {
    const mockDb = createMockDb({
      select: [[makeIssue()]],
    });

    const service = issueService(mockDb.db);

    await expect(
      service.update("11111111-1111-4111-8111-111111111111", {
        status: "in_progress",
        assigneeAgentId: null,
        assigneeUserId: null,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: "in_progress issues require an assignee",
    });
  });

  it("clears checkout ownership when reassigned to a different agent", async () => {
    const existing = makeIssue({
      status: "in_progress",
      assigneeAgentId: "22222222-2222-4222-8222-222222222222",
      checkoutRunId: "run-1",
      executionRunId: "run-1",
    });
    const updated = makeIssue({
      ...existing,
      assigneeAgentId: "33333333-3333-4333-8333-333333333333",
      checkoutRunId: null,
      executionRunId: "run-1",
    });

    const mockDb = createMockDb({
      select: [
        [existing],
        [
          {
            id: "33333333-3333-4333-8333-333333333333",
            companyId: "company-1",
            status: "active",
          },
        ],
      ],
      transactions: [
        {
          update: [[updated]],
          select: [
            [
              {
                issueId: existing.id,
                label: {
                  id: "label-1",
                  companyId: "company-1",
                  name: "Bug",
                  color: null,
                  createdAt: new Date("2026-03-05T09:00:00.000Z"),
                  updatedAt: new Date("2026-03-05T09:00:00.000Z"),
                },
              },
            ],
          ],
        },
      ],
    });

    const service = issueService(mockDb.db);
    const result = await service.update(existing.id, {
      assigneeAgentId: "33333333-3333-4333-8333-333333333333",
    });

    const tx = mockDb.history.transactions[0];
    expect(tx?.history.updates[0]?.setArg).toMatchObject({
      assigneeAgentId: "33333333-3333-4333-8333-333333333333",
      checkoutRunId: null,
      updatedAt: expect.any(Date),
    });
    expect(result).toMatchObject({
      id: existing.id,
      assigneeAgentId: "33333333-3333-4333-8333-333333333333",
      labelIds: ["label-1"],
    });
  });

  it("treats same-run checkout as idempotent instead of conflicting", async () => {
    const current = makeIssue({
      status: "in_progress",
      assigneeAgentId: "22222222-2222-4222-8222-222222222222",
      checkoutRunId: "run-1",
      executionRunId: "run-1",
      startedAt: new Date("2026-03-05T09:30:00.000Z"),
    });

    const mockDb = createMockDb({
      select: [
        [{ companyId: "company-1" }],
        [
          {
            id: "22222222-2222-4222-8222-222222222222",
            companyId: "company-1",
            status: "active",
          },
        ],
        [
          {
            id: current.id,
            status: "in_progress",
            assigneeAgentId: current.assigneeAgentId,
            checkoutRunId: "run-1",
            executionRunId: "run-1",
          },
        ],
        [current],
        [],
      ],
      update: [[]],
    });

    const service = issueService(mockDb.db);
    const result = await service.checkout(
      current.id,
      "22222222-2222-4222-8222-222222222222",
      ["todo", "in_progress"],
      "run-1",
    );

    expect(result).toMatchObject({
      id: current.id,
      assigneeAgentId: "22222222-2222-4222-8222-222222222222",
      checkoutRunId: "run-1",
      labelIds: [],
    });
  });
});
