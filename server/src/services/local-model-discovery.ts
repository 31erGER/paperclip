import {
  aiProviderRoutingSchema,
  type DiscoveredLocalModel,
  type LocalModelDiscoveryRequest,
  type LocalModelDiscoveryResult,
} from "@paperclipai/shared";
import { unprocessable } from "../errors.js";

/**
 * List the models of a local OpenAI-compatible server (fork 31erGER).
 *
 * - `GET <baseUrl>/models` is the OpenAI format; LM Studio and llama.cpp's
 *   llama-server both answer it.
 * - LM Studio also answers `GET <origin>/api/v0/models` with the model type
 *   and load state. When available, embedding models are left out and loaded
 *   models are listed first.
 *
 * Only loopback URLs pass (same rule as saved `local` connections), redirects
 * are refused, and only model IDs are returned, never the raw response.
 */
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_MODELS = 500;
const MAX_MODEL_ID_LENGTH = 256;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function normalizeBaseUrl(raw: string): string {
  let hostname: string | null = null;
  try {
    hostname = new URL(raw.trim()).hostname;
  } catch {
    throw unprocessable("Enter a local server URL such as http://localhost:1234/v1.");
  }
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw unprocessable("A local model server must use localhost or 127.0.0.1: it runs on the same machine as Paperclip.");
  }
  const routing = aiProviderRoutingSchema.safeParse({
    kind: "local", protocol: "chat", auth: "none", baseUrl: raw.trim(), models: [],
  });
  if (!routing.success) {
    throw unprocessable(routing.error.issues[0]?.message ?? "Enter a local server URL such as http://localhost:1234/v1.");
  }
  return raw.trim().replace(/\/+$/, "");
}

async function getJson(fetchImpl: FetchLike, url: string, apiKey: string | undefined): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    headers: { Accept: "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function readModelIds(body: unknown): string[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const entry of data) {
    const id = (entry as { id?: unknown } | null)?.id;
    if (typeof id === "string" && id.trim() && id.length <= MAX_MODEL_ID_LENGTH && !ids.includes(id)) ids.push(id);
    if (ids.length >= MAX_MODELS) break;
  }
  return ids;
}

function readLmStudioDetails(body: unknown): Map<string, { type?: string; loaded?: boolean }> | null {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  const details = new Map<string, { type?: string; loaded?: boolean }>();
  for (const entry of data) {
    const record = entry as { id?: unknown; type?: unknown; state?: unknown } | null;
    if (typeof record?.id !== "string") continue;
    details.set(record.id, {
      ...(typeof record.type === "string" ? { type: record.type } : {}),
      ...(typeof record.state === "string" ? { loaded: record.state === "loaded" } : {}),
    });
  }
  return details;
}

export async function discoverLocalModels(
  input: LocalModelDiscoveryRequest,
  fetchImpl: FetchLike = fetch,
): Promise<LocalModelDiscoveryResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const apiKey = input.apiKey?.trim() || undefined;

  let ids: string[];
  try {
    ids = readModelIds(await getJson(fetchImpl, `${baseUrl}/models`, apiKey));
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403) {
      throw unprocessable(`The model server at ${baseUrl} requires authentication. Enter its API key.`);
    }
    if (status) throw unprocessable(`The model server at ${baseUrl} answered HTTP ${status} for /models. Check the URL (it usually ends in /v1).`);
    if (error instanceof SyntaxError) throw unprocessable(`The model server at ${baseUrl} did not return a model list. Check the URL (it usually ends in /v1).`);
    throw unprocessable(`Could not reach a model server at ${baseUrl}. Start it first, for example "lms server start" for LM Studio or "llama-server … --port 8080" for llama.cpp.`);
  }

  // Best effort: LM Studio's own API adds type and load state.
  let details: Map<string, { type?: string; loaded?: boolean }> | null = null;
  try {
    details = readLmStudioDetails(await getJson(fetchImpl, `${new URL(baseUrl).origin}/api/v0/models`, apiKey));
  } catch {
    details = null;
  }

  let models: DiscoveredLocalModel[] = ids.map((id) => ({ id, ...(details?.get(id) ?? {}) }));
  if (details) models = models.filter((model) => model.type !== "embeddings");
  models.sort((left, right) => Number(Boolean(right.loaded)) - Number(Boolean(left.loaded)) || left.id.localeCompare(right.id));
  return { baseUrl, source: details ? "lmstudio" : "openai", models };
}
