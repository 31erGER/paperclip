import { z } from "zod";
import { discoverLocalAiModelsSchema, type LocalAiModelDiscovery } from "@paperclipai/shared";
import { unprocessable } from "../errors.js";
import { guardedRemoteHttpFetch } from "./remote-http-fetch.js";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const catalogSchema = z.object({ data: z.array(z.object({ id: z.string().trim().min(1).max(256) }).passthrough()).max(200) });

async function readCatalogBody(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new RangeError("Model list too large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new RangeError("Model list too large");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** Metadata only: never invokes a model, follows redirects, or inherits credentials. */
export async function discoverLocalAiModels(input: unknown, request: typeof guardedRemoteHttpFetch = guardedRemoteHttpFetch): Promise<LocalAiModelDiscovery> {
  const { routing, apiKey } = discoverLocalAiModelsSchema.parse(input);
  const endpoint = new URL(`${routing.baseUrl!.replace(/\/+$/, "")}/models`);
  const signal = AbortSignal.timeout(10_000);
  let response: Response;
  try {
    response = await request(endpoint, { method: "GET", redirect: "error", signal,
      headers: { Accept: "application/json", ...(routing.auth === "bearer" ? { Authorization: `Bearer ${apiKey}` } : {}) },
    }, { allowPrivateNetwork: true, connectTimeoutMs: 5_000, responseTimeoutMs: 10_000,
      error: () => unprocessable("Could not reach the local model endpoint. Check its URL and server.", { code: "ai_model_discovery_network_failed" }) });
  } catch {
    throw unprocessable(signal.aborted ? "The local model endpoint timed out. Try again." : "Could not reach the local model endpoint. Check its URL and server.", { code: "ai_model_discovery_network_failed" });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw unprocessable(response.status === 401 || response.status === 403
      ? "The local endpoint rejected authentication. Check its API key."
      : response.status === 404 ? "The endpoint has no model list at this URL. Include /v1 in an OpenAI-compatible base URL, or enter model IDs manually."
      : "The local endpoint rejected model discovery. Redirects are not followed.", { code: "ai_model_discovery_rejected" });
  }
  let payload: unknown;
  try { payload = await readCatalogBody(response); }
  catch (error) {
    throw unprocessable(error instanceof RangeError ? "The model list is too large." : signal.aborted
      ? "The local model endpoint timed out. Try again." : "The endpoint did not return a valid model list.", { code: "ai_model_discovery_invalid_response" });
  }
  const parsed = catalogSchema.safeParse(payload);
  if (!parsed.success) throw unprocessable("The endpoint did not return a valid model list (maximum 200 models).", { code: "ai_model_discovery_invalid_response" });
  const unique = new Map<string, { id: string; label?: string }>();
  for (const entry of parsed.data.data) {
    if (unique.has(entry.id)) continue;
    const label = typeof entry.name === "string" ? entry.name.trim() : "";
    unique.set(entry.id, { id: entry.id, ...(label && label.length <= 160 ? { label } : {}) });
  }
  return { models: [...unique.values()] };
}
