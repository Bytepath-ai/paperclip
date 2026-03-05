import { z } from "zod";

export const memoryAddSchema = z.object({
  content: z.string().min(1).max(10000),
  scope: z.enum(["agent", "company", "project"]).optional().default("agent"),
  metadata: z.record(z.unknown()).optional(),
});

export type MemoryAdd = z.infer<typeof memoryAddSchema>;

export const memorySearchSchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(50).optional().default(10),
  scope: z.enum(["agent", "company", "project", "all"]).optional().default("all"),
});

export type MemorySearch = z.infer<typeof memorySearchSchema>;
