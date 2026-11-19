import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeedbackTraceBundle } from "@paperclipai/shared";
import { DEFAULT_AGENT_OBSERVABILITY_CAPTURE } from "@paperclipai/shared";
import { createFeedbackTraceShareClientFromConfig } from "../services/feedback-share-client.js";
import { testAgentObservability } from "../services/agent-observability-test.js";

const transport = vi.hoisted(() => ({ send: vi.fn(async () => new Response(null, { status: 200 })), serialize: vi.fn(() => new Uint8Array([1])) }));
vi.mock("../services/remote-http-fetch.js", () => ({ guardedRemoteHttpFetch: transport.send }));
vi.mock("@opentelemetry/otlp-transformer", () => ({ ProtobufLogsSerializer: { serializeRequest: transport.serialize }, ProtobufTraceSerializer: { serializeRequest: transport.serialize } }));

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("production diagnostic export refusal", () => {
  it.each([undefined, "https://custom-receiver.example.com"])("rejects feedback upload to %s before reading the bundle or calling fetch", async feedbackExportBackendUrl => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const readBundle = vi.fn(() => "private-company");
    const bundle = Object.defineProperty({}, "companyId", { get: readBundle }) as FeedbackTraceBundle;
    const client = createFeedbackTraceShareClientFromConfig({ feedbackExportBackendUrl, feedbackExportBackendToken: "saved-token" });
    await expect(client.uploadTraceBundle(bundle)).rejects.toMatchObject({ status: 403, details: { code: "external_diagnostics_disabled" } });
    expect(readBundle).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a connection test even when handed an enabled saved destination before serializing or sending", async () => {
    await expect(testAgentObservability({ companyId: "private-company", revision: "saved-revision", allowPrivateNetwork: true,
      resolved: { state: "enabled", revision: "saved-revision", compatibilityKey: "saved", logsEndpoint: "https://receiver.example.com/v1/logs",
        tracesEndpoint: "https://receiver.example.com/v1/traces", headers: { authorization: "Bearer secret" }, capture: DEFAULT_AGENT_OBSERVABILITY_CAPTURE },
    })).rejects.toMatchObject({ status: 403, details: { code: "external_diagnostics_disabled" } });
    expect(transport.serialize).not.toHaveBeenCalled();
    expect(transport.send).not.toHaveBeenCalled();
  });
});
