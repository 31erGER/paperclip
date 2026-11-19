import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: mocks.spawn,
}));
import { fetchCodexRpcQuota } from "./quota.js";

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
it("suppresses inherited diagnostics at the Codex quota subprocess boundary", async () => {
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://tracker.invalid/otel");
  vi.stubEnv("SENTRY_DSN", "https://tracker.invalid/sentry");
  vi.stubEnv("OPENAI_BASE_URL", "http://localhost:1234/v1");
  vi.stubEnv("HTTPS_PROXY", "http://localhost:8888");
  vi.stubEnv("DISABLE_AUTOUPDATER", "0");
  const child = Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { setEncoding() {} }),
    stderr: Object.assign(new EventEmitter(), { setEncoding() {} }),
    stdin: Object.assign(new EventEmitter(), { write() {}, end() {} }),
    kill: vi.fn(() => { queueMicrotask(() => child.emit("close", 0)); return true; }),
  });
  mocks.spawn.mockImplementation(() => { queueMicrotask(() => child.emit("error", new Error("fixture stop"))); return child; });
  await expect(fetchCodexRpcQuota()).rejects.toThrow("fixture stop");
  const env = mocks.spawn.mock.calls[0][2].env;
  expect(env).not.toHaveProperty("OTEL_EXPORTER_OTLP_ENDPOINT");
  expect(env).not.toHaveProperty("SENTRY_DSN");
  expect(env).toMatchObject({ OTEL_SDK_DISABLED: "true", OPENAI_BASE_URL: "http://localhost:1234/v1", HTTPS_PROXY: "http://localhost:8888", DISABLE_AUTOUPDATER: "0" });
});
