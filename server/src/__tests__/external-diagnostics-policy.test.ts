import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  sentryLoaded: vi.fn(),
  sentryInit: vi.fn(),
  captureException: vi.fn(),
  otelLoaded: vi.fn(),
  otelStart: vi.fn(),
  apiLoaded: vi.fn(),
}));

vi.mock("../peer-version-check.js", () => ({ checkExactPeerVersions: () => ({ ok: true }) }));
vi.mock("@sentry/node", () => {
  sdk.sentryLoaded();
  return { init: sdk.sentryInit, captureException: sdk.captureException, close: async () => true,
    httpIntegration: () => ({ name: "Http" }), onUnhandledRejectionIntegration: () => ({ name: "OnUnhandledRejection" }) };
});
vi.mock("@opentelemetry/sdk-node", () => {
  sdk.otelLoaded();
  return { NodeSDK: class { start = sdk.otelStart; shutdown = async () => {}; } };
});
vi.mock("@opentelemetry/auto-instrumentations-node", () => ({ getNodeAutoInstrumentations: () => [] }));
vi.mock("@opentelemetry/exporter-trace-otlp-grpc", () => ({ OTLPTraceExporter: class {} }));
vi.mock("@opentelemetry/resources", () => ({ resourceFromAttributes: (value: unknown) => value }));
vi.mock("@opentelemetry/semantic-conventions", () => ({ ATTR_SERVICE_NAME: "service.name", ATTR_SERVICE_VERSION: "service.version" }));
vi.mock("node:module", async importOriginal => {
  const actual = await importOriginal<typeof import("node:module")>();
  return { ...actual, createRequire: (...args: Parameters<typeof actual.createRequire>) => {
    const require = actual.createRequire(...args);
    return (name: string) => {
      if (name === "@opentelemetry/api") {
        sdk.apiLoaded();
        return { trace: { getTracer: () => ({ startSpan: () => ({ setAttribute() {}, setStatus() {}, end() {} }) }),
          getSpanContext: () => ({ traceId: "a".repeat(32), spanId: "b".repeat(16), traceFlags: 1 }),
          setSpan: () => "remote-context", setSpanContext: () => "remote-context" }, context: { active: () => ({}) } };
      }
      return require(name);
    };
  } };
});

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("production external diagnostics policy", () => {
  it("withholds every configured frontend and backend Sentry DSN", async () => {
    const { resolveSentryDsns } = await import("../sentry-dsn.js");
    expect(resolveSentryDsns({ SENTRY_DSN: "https://legacy@example.com/1", SENTRY_DSN_FRONTEND: "https://frontend@example.com/2",
      SENTRY_DSN_BACKEND: "https://backend@example.com/3" })).toEqual({ frontend: null, backend: null, legacyFallbackUsed: false });
  });

  it("never loads or initializes Sentry with an installed SDK and configured DSNs", async () => {
    vi.stubEnv("SENTRY_DSN", "https://public@example.com/1");
    vi.stubEnv("SENTRY_DSN_BACKEND", "https://public@example.com/2");
    const sentry = await import("../sentry.js");
    await sentry.sentryReady;
    sentry.captureException(new Error("private task failure"));
    await sentry.shutdownSentry();
    expect(sdk.sentryLoaded).not.toHaveBeenCalled();
    expect(sdk.sentryInit).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it("never starts OTLP or loads its API for configured startup and plugin traces", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example.com");
    vi.stubEnv("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc");
    const instrumentation = await import("../instrumentation.js");
    await instrumentation.instrumentationReady;
    const context = instrumentation.getStartupTraceContext();
    const span = instrumentation.getStartupTracer().startSpan("private startup");
    span.setAttribute("task", "private"); span.end();
    expect(context.contextWithSpan(span)).toBeUndefined();
    expect(instrumentation.traceparentFromContextToken({ private: true })).toBeUndefined();
    instrumentation.recordProviderPluginSpan({ name: "private plugin call", parent: { traceId: "a".repeat(32), spanId: "b".repeat(16), traceFlags: 1 }, attributes: { task: "private" } });
    await instrumentation.shutdownInstrumentation();
    expect(sdk.otelLoaded).not.toHaveBeenCalled();
    expect(sdk.otelStart).not.toHaveBeenCalled();
    expect(sdk.apiLoaded).not.toHaveBeenCalled();
  });
});
