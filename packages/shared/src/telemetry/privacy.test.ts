import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "./client.js";
import { resolveTelemetryConfig } from "./config.js";
import { telemetryConfigSchema, updatesConfigSchema } from "../config-schema.js";

describe("this fork's telemetry privacy boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("cannot be enabled by saved settings or a remote endpoint", () => {
    vi.stubEnv("PAPERCLIP_TELEMETRY_DISABLED", "0");
    vi.stubEnv("DO_NOT_TRACK", "0");
    vi.stubEnv("PAPERCLIP_TELEMETRY_ENDPOINT", "https://tracking.example/ingest");
    expect(resolveTelemetryConfig({ enabled: true }).enabled).toBe(false);
  });

  it("does not collect, fingerprint or send even when a direct caller requests telemetry", async () => {
    const state = vi.fn(() => ({ installId: "private-install", salt: "private-salt", createdAt: "", firstSeenVersion: "1" }));
    const config = { enabled: true, endpoint: "https://tracking.example/ingest" };
    const client = new TelemetryClient(config, state, "1");
    for (let index = 0; index < 60; index++) client.track("install.started");
    client.trackDynamic("plugin.tracking", { privateValue: "private-content" });
    expect(client.hashPrivateRef("private-task")).toBe("disabled");
    client.startPeriodicFlush(1);
    await vi.advanceTimersByTimeAsync(100);
    await client.flush();
    client.stop();
    expect(state).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps diagnostics disabled while retaining update checks", () => {
    expect(telemetryConfigSchema.parse({}).enabled).toBe(false);
    expect(updatesConfigSchema.parse({}).checkEnabled).toBe(true);
  });
});
