import { afterEach, describe, expect, it, vi } from "vitest";
import { runChildProcess, sanitizeInheritedPaperclipEnv } from "./server-utils.js";

afterEach(() => vi.unstubAllEnvs());

describe("sanitizeInheritedPaperclipEnv", () => {
  it("drops the host-only Paperclip CLI command pointer", () => {
    expect(sanitizeInheritedPaperclipEnv({
      PAPERCLIPAI_CMD: "node /missing/paperclipai/dist/index.js",
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    })).toEqual({
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    });
  });
});

describe("child runtime privacy", () => {
  it("forces diagnostic opt-outs after host and configured env merges in a real child", async () => {
    vi.stubEnv("SENTRY_DSN", "https://host-diagnostics.invalid/1");
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://host-diagnostics.invalid/otel");
    vi.stubEnv("PI_TELEMETRY", "1");
    const env = {
      OTEL_SDK_DISABLED: "false",
      OTEL_TRACES_EXPORTER: "otlp",
      OTEL_LOGS_EXPORTER: "console",
      OTEL_METRICS_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://configured-diagnostics.invalid/traces",
      OTEL_EXPORTER_OTLP_HEADERS: "authorization=fixture-diagnostic-secret",
      sentry_dsn: "https://configured-diagnostics.invalid/2",
      CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      DISABLE_TELEMETRY: "0",
      DISABLE_ERROR_REPORTING: "0",
      DO_NOT_TRACK: "0",
      PI_TELEMETRY: "1",
      OPENAI_BASE_URL: "https://provider.invalid/v1",
      OPENAI_API_KEY: "fixture-provider-secret",
      HTTPS_PROXY: "http://proxy.invalid:8080",
      PI_SKIP_VERSION_CHECK: "0",
      DISABLE_AUTOUPDATER: "0",
    };
    const keys = [...Object.keys(env), "SENTRY_DSN", "OTEL_EXPORTER_OTLP_ENDPOINT", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"];
    const result = await runChildProcess("privacy-local-fixture", process.execPath, [
      "-e",
      `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map(key => [key, process.env[key]]))))`,
    ], { cwd: process.cwd(), env, timeoutSec: 10, graceSec: 1, onLog: async () => {} });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const actual = JSON.parse(result.stdout);
    expect(actual).toMatchObject({
      OTEL_SDK_DISABLED: "true", OTEL_TRACES_EXPORTER: "none", OTEL_LOGS_EXPORTER: "none", OTEL_METRICS_EXPORTER: "none",
      CLAUDE_CODE_ENABLE_TELEMETRY: "0", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", DO_NOT_TRACK: "1", PI_TELEMETRY: "0",
      OPENAI_BASE_URL: env.OPENAI_BASE_URL, OPENAI_API_KEY: env.OPENAI_API_KEY, HTTPS_PROXY: env.HTTPS_PROXY,
      PI_SKIP_VERSION_CHECK: "0", DISABLE_AUTOUPDATER: "0",
    });
    for (const key of ["SENTRY_DSN", "sentry_dsn", "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS"]) {
      expect(actual).not.toHaveProperty(key);
    }
    expect(env.PI_TELEMETRY).toBe("1");
    expect(process.env.PI_TELEMETRY).toBe("1");
  });
});
