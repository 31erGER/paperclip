import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  execFile: Object.assign(vi.fn(), { [Symbol.for("nodejs.util.promisify.custom")]: mocks.exec }),
}));
import { captureClaudeCliUsageText, readClaudeAuthStatus } from "./quota.js";

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
it.each(["auth", "usage"])("suppresses inherited diagnostics at the Claude %s subprocess boundary", async (probe) => {
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://tracker.invalid/otel");
  vi.stubEnv("SENTRY_DSN", "https://tracker.invalid/sentry");
  vi.stubEnv("CLAUDE_CODE_ENABLE_TELEMETRY", "1");
  vi.stubEnv("HTTPS_PROXY", "http://localhost:8888");
  vi.stubEnv("DISABLE_AUTOUPDATER", "0");
  mocks.exec.mockResolvedValue({ stdout: '{"loggedIn":true}', stderr: "" });
  if (probe === "auth") await expect(readClaudeAuthStatus()).resolves.toMatchObject({ loggedIn: true });
  else await expect(captureClaudeCliUsageText()).rejects.toThrow("before rendering usage");
  const env = mocks.exec.mock.calls[0][2].env;
  expect(env).not.toHaveProperty("OTEL_EXPORTER_OTLP_ENDPOINT");
  expect(env).not.toHaveProperty("SENTRY_DSN");
  expect(env).toMatchObject({ OTEL_SDK_DISABLED: "true", CLAUDE_CODE_ENABLE_TELEMETRY: "0", HTTPS_PROXY: "http://localhost:8888", DISABLE_AUTOUPDATER: "0" });
});
