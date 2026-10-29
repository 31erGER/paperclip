import { describe, expect, it, vi } from "vitest";
import { discoverLocalAiModels } from "../services/ai-model-discovery.js";

const input = { routing: { kind: "local", protocol: "chat", auth: "none", baseUrl: "http://host.docker.internal:1234/v1", models: [] } } as const;
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("local OpenAI-compatible model discovery", () => {
  it("requests the exact models endpoint without credentials and returns only bounded model fields", async () => {
    const request = vi.fn().mockResolvedValue(reply({ object: "list", data: [{ id: "model-b", owned_by: "private-owner" }, { id: "model-a", name: "Model A" }, { id: "model-b" }] }));
    await expect(discoverLocalAiModels(input, request)).resolves.toEqual({ models: [{ id: "model-b" }, { id: "model-a", label: "Model A" }] });
    expect(request).toHaveBeenCalledWith(new URL("http://host.docker.internal:1234/v1/models"), expect.objectContaining({ method: "GET", headers: { Accept: "application/json" }, signal: expect.any(AbortSignal) }), expect.objectContaining({ allowPrivateNetwork: true }));
  });

  it("sends only an explicitly supplied bearer credential to the chosen local endpoint", async () => {
    const request = vi.fn().mockResolvedValue(reply({ data: [] }));
    await expect(discoverLocalAiModels({ routing: { ...input.routing, auth: "bearer", baseUrl: "http://localhost:1234/v1/" }, apiKey: "explicit-local-token" }, request)).resolves.toEqual({ models: [] });
    expect(request.mock.calls[0][0].toString()).toBe("http://localhost:1234/v1/models");
    expect(request.mock.calls[0][1].headers).toEqual({ Accept: "application/json", Authorization: "Bearer explicit-local-token" });
  });

  it.each(["http://192.168.1.10:1234/v1", "https://public.example/v1", "http://host.docker.internal.attacker.example/v1", "http://localhost:1234/v1?token=private"])("rejects %s before any network request", async baseUrl => {
    const request = vi.fn();
    await expect(discoverLocalAiModels({ routing: { ...input.routing, baseUrl } }, request)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects missing bearer credentials and nonlocal routes before any request", async () => {
    const request = vi.fn();
    await expect(discoverLocalAiModels({ routing: { ...input.routing, auth: "bearer" } }, request)).rejects.toThrow();
    await expect(discoverLocalAiModels({ routing: { ...input.routing, kind: "gateway", baseUrl: "https://example.com/v1" } }, request)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([301, 302, 401, 403, 404, 500])("does not expose upstream bodies or accept HTTP %s", async status => {
    const request = vi.fn().mockResolvedValue(reply({ error: "provider-secret-must-not-escape" }, status));
    const error = await discoverLocalAiModels(input, request).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain("provider-secret");
  });

  it.each([{ unexpected: [] }, { data: [{ id: "" }] }, { data: [{ id: 12 }] }, { data: Array.from({ length: 201 }, (_, i) => ({ id: `model-${i}` })) }])("rejects invalid or excessive catalog data", async body => {
    await expect(discoverLocalAiModels(input, vi.fn().mockResolvedValue(reply(body)))).rejects.toThrow(/valid model list|too large/i);
  });

  it("bounds response bytes and hides network failure details", async () => {
    await expect(discoverLocalAiModels(input, vi.fn().mockResolvedValue(new Response("x".repeat(1024 * 1024 + 1))))).rejects.toThrow(/too large/i);
    const error = await discoverLocalAiModels(input, vi.fn().mockRejectedValue(new Error("secret-address-token"))).catch(error => error);
    expect(error.message).not.toContain("secret-address-token");
    expect(error.message).toMatch(/could not reach|timed out/i);
  });
});
