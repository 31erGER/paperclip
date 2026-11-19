import { z } from "zod";

/**
 * Model discovery for local model servers (fork 31erGER, local harness).
 *
 * The board asks the Paperclip server to list the models of an
 * OpenAI-compatible server on the Paperclip host (LM Studio, llama.cpp), so
 * nobody has to type model IDs. Only loopback URLs are accepted, the same
 * rule as for saved `local` connections.
 */
export const localModelDiscoveryRequestSchema = z.object({
  baseUrl: z.string().trim().min(1).max(2048),
  apiKey: z.string().trim().max(4096).optional(),
}).strict();

export type LocalModelDiscoveryRequest = z.infer<typeof localModelDiscoveryRequestSchema>;

export interface DiscoveredLocalModel {
  id: string;
  /** LM Studio only: the model is loaded in memory right now. */
  loaded?: boolean;
  /** LM Studio only: "llm", "vlm" (embedding models are left out). */
  type?: string;
}

export interface LocalModelDiscoveryResult {
  baseUrl: string;
  /** "lmstudio" when LM Studio's model details were available, else "openai". */
  source: "lmstudio" | "openai";
  models: DiscoveredLocalModel[];
}
