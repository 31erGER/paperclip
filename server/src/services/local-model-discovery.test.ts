import { describe, expect, it, vi } from "vitest";
import { discoverLocalModels } from "./local-model-discovery.js";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("discoverLocalModels", () => {
  it("lists OpenAI-format models (llama.cpp) sorted by id", async () => {
    const fetchImpl = vi.fn(async (url: string) => url.endsWith("/v1/models")
      ? json({ object: "list", data: [{ id: "qwen3-coder" }, { id: "gemma-3" }, { id: "qwen3-coder" }] })
      : new Response("not found", { status: 404 }));
    const result = await discoverLocalModels({ baseUrl: "http://localhost:8080/v1/" }, fetchImpl);
    expect(result).toEqual({ baseUrl: "http://localhost:8080/v1", source: "openai", models: [{ id: "gemma-3" }, { id: "qwen3-coder" }] });
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:8080/v1/models", expect.objectContaining({ redirect: "error" }));
  });

  it("uses LM Studio details: drops embedding models, loaded models first", async () => {
    const fetchImpl = vi.fn(async (url: string) => url.endsWith("/api/v0/models")
      ? json({ data: [
        { id: "text-embedding-nomic", type: "embeddings", state: "not-loaded" },
        { id: "a-model", type: "llm", state: "not-loaded" },
        { id: "z-model", type: "llm", state: "loaded" },
      ] })
      : json({ data: [{ id: "text-embedding-nomic" }, { id: "a-model" }, { id: "z-model" }] }));
    const result = await discoverLocalModels({ baseUrl: "http://127.0.0.1:1234/v1" }, fetchImpl);
    expect(result.source).toBe("lmstudio");
    expect(result.models).toEqual([
      { id: "z-model", type: "llm", loaded: true },
      { id: "a-model", type: "llm", loaded: false },
    ]);
  });

  it("sends the API key as a bearer token when one is given", async () => {
    const fetchImpl = vi.fn(async () => json({ data: [{ id: "m" }] }));
    await discoverLocalModels({ baseUrl: "http://localhost:1234/v1", apiKey: "local-key" }, fetchImpl);
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer local-key");
  });

  it("rejects non-loopback URLs before any request", async () => {
    const fetchImpl = vi.fn();
    await expect(discoverLocalModels({ baseUrl: "http://192.168.1.10:1234/v1" }, fetchImpl)).rejects.toMatchObject({ status: 422 });
    await expect(discoverLocalModels({ baseUrl: "https://example.com/v1" }, fetchImpl)).rejects.toMatchObject({ status: 422 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("explains an unreachable server, authentication and wrong URLs", async () => {
    const refused = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await expect(discoverLocalModels({ baseUrl: "http://localhost:1234/v1" }, refused)).rejects.toThrow(/Could not reach a model server/);
    const auth = vi.fn(async () => new Response("", { status: 401 }));
    await expect(discoverLocalModels({ baseUrl: "http://localhost:1234/v1" }, auth)).rejects.toThrow(/requires authentication/);
    const notFound = vi.fn(async () => new Response("", { status: 404 }));
    await expect(discoverLocalModels({ baseUrl: "http://localhost:1234" }, notFound)).rejects.toThrow(/HTTP 404.*\/v1/);
  });
});
