import { describe, expect, it, vi } from "vitest";
import type { AiProviderRouting } from "@paperclipai/shared";
import { resolveLocalConnectionInheritance } from "./local-connection-inheritance.js";

const binding = {
  provider: "openai", method: "api_key", mode: "delegated",
  connectionId: "11111111-1111-4111-8111-111111111111", grantId: "22222222-2222-4222-8222-222222222222",
} as const;

const localRouting: AiProviderRouting = {
  kind: "local", protocol: "chat", auth: "none", baseUrl: "http://localhost:1234/v1",
  models: [{ id: "qwen/qwen3-coder-30b" }, { id: "google/gemma-3-12b" }],
} as AiProviderRouting;

const parent = {
  adapterType: "pi_local",
  adapterConfig: { model: "paperclip/qwen/qwen3-coder-30b" },
  runtimeConfig: { aiConnection: binding, heartbeat: { enabled: true } },
  defaultEnvironmentId: "env-local",
};

const readLocal = async () => localRouting;

describe("resolveLocalConnectionInheritance", () => {
  it("gives a hired Pi agent the parent's local connection, model and environment", async () => {
    const result = await resolveLocalConnectionInheritance({
      parent,
      child: { adapterType: "pi_local", adapterConfig: {}, runtimeConfig: { heartbeat: { enabled: false } } },
      readParentRouting: readLocal,
    });
    expect(result).toMatchObject({
      adapterConfig: { model: "paperclip/qwen/qwen3-coder-30b" },
      runtimeConfig: { aiConnection: binding, heartbeat: { enabled: false } },
      defaultEnvironmentId: "env-local",
      model: "paperclip/qwen/qwen3-coder-30b",
    });
  });

  it("prefixes a requested model for Pi and keeps a requested environment", async () => {
    const result = await resolveLocalConnectionInheritance({
      parent,
      child: { adapterType: "pi_local", adapterConfig: { model: "google/gemma-3-12b" }, runtimeConfig: {}, defaultEnvironmentId: "env-other" },
      readParentRouting: readLocal,
    });
    expect(result?.adapterConfig.model).toBe("paperclip/google/gemma-3-12b");
    expect(result?.defaultEnvironmentId).toBe("env-other");
  });

  it("uses the connection's first model for another compatible harness", async () => {
    const result = await resolveLocalConnectionInheritance({
      parent,
      child: { adapterType: "hermes_local", adapterConfig: {}, runtimeConfig: undefined },
      readParentRouting: readLocal,
    });
    // Hermes addresses the model by its plain id; only Pi/OpenCode need the provider prefix.
    expect(result?.adapterConfig.model).toBe("qwen/qwen3-coder-30b");
    expect(result?.runtimeConfig.aiConnection).toEqual(binding);
  });

  it("does not override a connection the hire request names", async () => {
    const readParentRouting = vi.fn(readLocal);
    const result = await resolveLocalConnectionInheritance({
      parent,
      child: { adapterType: "pi_local", adapterConfig: {}, runtimeConfig: { aiConnection: { provider: "openai", method: "api_key", mode: "responsible_user" } } },
      readParentRouting,
    });
    expect(result).toBeNull();
    expect(readParentRouting).not.toHaveBeenCalled();
  });

  it("never passes on cloud or gateway connections", async () => {
    for (const routing of [
      { kind: "gateway", protocol: "chat", auth: "bearer", baseUrl: "https://gateway.example.test/v1", models: [] },
      { kind: "openrouter", protocol: "chat", auth: "bearer", models: [] },
      undefined,
    ]) {
      const result = await resolveLocalConnectionInheritance({
        parent,
        child: { adapterType: "pi_local", adapterConfig: {}, runtimeConfig: {} },
        readParentRouting: async () => routing as AiProviderRouting | undefined,
      });
      expect(result).toBeNull();
    }
  });

  it("skips harnesses that cannot use the local endpoint and parents without a fixed connection", async () => {
    expect(await resolveLocalConnectionInheritance({
      parent,
      child: { adapterType: "claude_local", adapterConfig: {}, runtimeConfig: {} },
      readParentRouting: readLocal,
    })).toBeNull();
    expect(await resolveLocalConnectionInheritance({
      parent: { ...parent, runtimeConfig: {} },
      child: { adapterType: "pi_local", adapterConfig: {}, runtimeConfig: {} },
      readParentRouting: readLocal,
    })).toBeNull();
    expect(await resolveLocalConnectionInheritance({
      parent: { ...parent, runtimeConfig: { aiConnection: { provider: "openai", method: "api_key", mode: "responsible_user" } } },
      child: { adapterType: "pi_local", adapterConfig: {}, runtimeConfig: {} },
      readParentRouting: readLocal,
    })).toBeNull();
  });
});
