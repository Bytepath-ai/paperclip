import { describe, expect, it } from "vitest";
import { projectService } from "../services/projects.js";
import { createMockDb } from "./helpers/mock-db.js";

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    companyId: "company-1",
    goalId: null,
    name: "Paperclip",
    description: null,
    status: "planned",
    color: "blue",
    leadAgentId: null,
    targetDate: null,
    updatedAt: new Date("2026-03-05T10:00:00.000Z"),
    createdAt: new Date("2026-03-05T09:00:00.000Z"),
    ...overrides,
  };
}

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    companyId: "company-1",
    projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Workspace",
    cwd: null,
    repoUrl: null,
    repoRef: null,
    metadata: null,
    isPrimary: true,
    createdAt: new Date("2026-03-05T09:30:00.000Z"),
    updatedAt: new Date("2026-03-05T09:30:00.000Z"),
    ...overrides,
  };
}

describe("projectService", () => {
  it("creates the first workspace as primary and derives its name from the repo URL", async () => {
    const project = makeProject();
    const inserted = makeWorkspace({
      name: "paperclip",
      repoUrl: "https://github.com/acme/paperclip.git",
      isPrimary: true,
    });

    const mockDb = createMockDb({
      select: [[project], []],
      transactions: [
        {
          insert: [[inserted]],
        },
      ],
    });

    const service = projectService(mockDb.db);
    const result = await service.createWorkspace(project.id, {
      repoUrl: "https://github.com/acme/paperclip.git",
    });

    const tx = mockDb.history.transactions[0];
    expect(tx?.history.inserts[0]?.valuesArg).toMatchObject({
      projectId: project.id,
      companyId: "company-1",
      name: "paperclip",
      repoUrl: "https://github.com/acme/paperclip.git",
      isPrimary: true,
    });
    expect(result).toMatchObject({
      id: inserted.id,
      name: "paperclip",
      isPrimary: true,
    });
  });

  it("re-promotes another workspace when the current primary is explicitly demoted", async () => {
    const existing = makeWorkspace({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Primary workspace",
      isPrimary: true,
      cwd: "/tmp/paperclip",
    });
    const updated = makeWorkspace({
      ...existing,
      isPrimary: false,
      name: "Primary workspace",
    });

    const mockDb = createMockDb({
      select: [[existing]],
      transactions: [
        {
          update: [[updated], [], []],
          select: [
            [],
            [{ id: existing.id }],
            [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }],
            [updated],
          ],
        },
      ],
    });

    const service = projectService(mockDb.db);
    const result = await service.updateWorkspace(existing.projectId, existing.id, {
      isPrimary: false,
    });

    const tx = mockDb.history.transactions[0];
    expect(tx?.history.updates).toHaveLength(3);
    expect(tx?.history.updates[0]?.setArg).toMatchObject({
      updatedAt: expect.any(Date),
      isPrimary: false,
    });
    expect(tx?.history.updates[2]?.setArg).toMatchObject({
      isPrimary: true,
      updatedAt: expect.any(Date),
    });
    expect(result).toMatchObject({
      id: existing.id,
      isPrimary: false,
    });
  });
});
