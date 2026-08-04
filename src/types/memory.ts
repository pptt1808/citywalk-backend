export type MemoryKind = "semantic" | "episodic" | "procedural";

export type MemorySource =
  | "user_explicit"
  | "user_feedback"
  | "system_observed"
  | "inferred";

export type MemoryPolarity = "positive" | "negative" | "neutral";

export type MemoryEventAction = "ADD" | "UPDATE" | "DELETE" | "NONE";

export interface MemoryItem {
  id: string;
  userId: string;
  kind: MemoryKind;
  /** Stable, domain-level identity used for deterministic conflict resolution. */
  key: string;
  text: string;
  data: Record<string, unknown>;
  city?: string;
  polarity: MemoryPolarity;
  confidence: number;
  source: MemorySource;
  status: "active" | "deleted";
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
  accessCount: number;
  expiresAt?: string;
}

export interface MemoryCandidate {
  kind: MemoryKind;
  key: string;
  text: string;
  data?: Record<string, unknown>;
  city?: string;
  polarity?: MemoryPolarity;
  confidence?: number;
  source?: MemorySource;
  /** Explicit user requests such as “忘掉我喜欢咖啡” can request deletion. */
  actionHint?: "UPSERT" | "DELETE";
  existingMemoryId?: string;
}

export interface MemoryDecision {
  event: MemoryEventAction;
  candidate?: MemoryCandidate;
  memoryId?: string;
  reason: string;
}

export interface MemoryEvent {
  id: string;
  memoryId: string;
  userId: string;
  threadId?: string;
  action: Exclude<MemoryEventAction, "NONE">;
  previousValue?: MemoryItem;
  newValue?: MemoryItem;
  reason: string;
  createdAt: string;
}

export interface ConversationMemoryMessage {
  id: string;
  userId: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface RecalledMemory {
  id: string;
  kind: MemoryKind;
  key: string;
  text: string;
  data: Record<string, unknown>;
  city?: string;
  polarity: MemoryPolarity;
  confidence: number;
  source: MemorySource;
  score: number;
  retrieval?: "lexical" | "vector" | "hybrid";
  lexicalScore?: number;
  vectorScore?: number;
}

export interface MemoryContext {
  userId: string;
  threadId?: string;
  recalled: RecalledMemory[];
  recentMessages: ConversationMemoryMessage[];
}

export interface MemoryMutationResult {
  events: MemoryDecision[];
}

export interface PlaceFeedbackInput {
  userId: string;
  threadId?: string;
  placeName: string;
  poiId?: string;
  city?: string;
  sentiment: "like" | "dislike";
  tags?: string[];
  comment?: string;
}
