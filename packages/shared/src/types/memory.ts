export interface MemoryEntry {
  content: string;
  score: number;
  containerTag: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryContext {
  content: string;
  scope: string;
}

export interface MemorySearchResponse {
  results: MemoryEntry[];
}

export interface MemoryAddRequest {
  content: string;
  scope?: "agent" | "company" | "project";
  metadata?: Record<string, unknown>;
}

export interface MemorySearchRequest {
  query: string;
  limit?: number;
  scope?: "agent" | "company" | "project" | "all";
}
