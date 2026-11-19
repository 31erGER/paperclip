import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { DEFAULT_AGENT_OBSERVABILITY_CAPTURE } from "@paperclipai/shared";
import { agentObservabilityService } from "../services/agent-observability.js";

const secrets = vi.hoisted(() => ({ open: vi.fn(() => { throw new Error("credentials must remain sealed"); }) }));
vi.mock("../services/secrets.js", () => ({ secretService: secrets.open }));
afterEach(() => { vi.clearAllMocks(); });

function serviceFor(provider: "braintrust" | "otlp", enabled: boolean) {
  const row = { companyId: "private-company", revision: "saved-revision", enabled,
    destination: provider === "braintrust" ? { provider, projectId: "10000000-0000-4000-8000-000000000001" } : { provider, endpointBaseUrl: "https://saved-receiver.example.com" },
    capture: DEFAULT_AGENT_OBSERVABILITY_CAPTURE, credentialsSecretId: "saved-secret", headerNames: ["authorization"] };
  const db = { select: () => ({ from: () => ({ where: async () => [row] }) }) } as unknown as Db;
  return agentObservabilityService(db);
}

describe("saved destinations cannot enable production diagnostics", () => {
  it.each(["braintrust", "otlp"] as const)("resolves an enabled %s destination as disabled without opening credentials", async provider => {
    const resolved = await serviceFor(provider, true).resolve("private-company");
    expect(resolved).toMatchObject({ state: "disabled", revision: "saved-revision" });
    expect(resolved).not.toHaveProperty("headers");
    expect(resolved).not.toHaveProperty("logsEndpoint");
    expect(secrets.open).not.toHaveBeenCalled();
  });

  it.each([false, true])("refuses an explicit test with saved enabled=%s without opening credentials", async enabled => {
    await expect(serviceFor("braintrust", enabled).resolve("private-company", { forTest: true, expectedRevision: "saved-revision" }))
      .rejects.toMatchObject({ status: 403, details: { code: "external_diagnostics_disabled" } });
    expect(secrets.open).not.toHaveBeenCalled();
  });
});
