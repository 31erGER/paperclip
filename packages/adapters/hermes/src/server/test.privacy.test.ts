import { afterEach, expect, it, vi } from "vitest";

const execFile = vi.hoisted(() => vi.fn((
  file: string, _args: string[], _options: unknown,
  callback: (error: null, result: { stdout: string; stderr: string }) => void,
) => callback(null, { stdout: file === "python3" ? "Python 3.11.0" : "hello hermes-fixture 1.2.3", stderr: "" })));

vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(), execFile,
}));
vi.mock("./detect-model.js", async importOriginal => ({
  ...await importOriginal<typeof import("./detect-model.js")>(), detectModel: async () => null,
}));

import { testEnvironment } from "./test.js";

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

it.each([true, false])("hardens Hermes connection/version probe environments with managed routing %s", async managedAiRouting => {
  vi.stubEnv("SENTRY_DSN", "https://host-diagnostics.invalid/1");
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://host-diagnostics.invalid/otel");
  vi.stubEnv("OPENAI_API_KEY", "fixture-host-provider-key");
  await testEnvironment({ companyId: "fixture", adapterType: "hermes_local", config: {
    command: "hermes-fixture", managedAiRouting, env: {
      OTEL_SDK_DISABLED: "false", SENTRY_DSN: "https://configured-diagnostics.invalid/2",
      OPENAI_BASE_URL: "https://provider.invalid/v1", OPENAI_API_KEY: "fixture-provider-key", HTTPS_PROXY: "http://proxy.invalid:8080",
    },
  } });
  expect(execFile.mock.calls.length).toBeGreaterThan(0);
  for (const call of execFile.mock.calls) {
    const env = (call[2] as { env: NodeJS.ProcessEnv }).env;
    expect(env).toMatchObject({ OTEL_SDK_DISABLED: "true", OTEL_TRACES_EXPORTER: "none", DO_NOT_TRACK: "1" });
    expect(env).not.toHaveProperty("SENTRY_DSN");
    expect(env).not.toHaveProperty("OTEL_EXPORTER_OTLP_ENDPOINT");
    expect(env.OPENAI_API_KEY).toBe(managedAiRouting ? "fixture-provider-key" : "fixture-host-provider-key");
    if (managedAiRouting) expect(env).toMatchObject({ OPENAI_BASE_URL: "https://provider.invalid/v1", HTTPS_PROXY: "http://proxy.invalid:8080" });
    expect(env).not.toHaveProperty("HERMES_TELEMETRY");
  }
});
