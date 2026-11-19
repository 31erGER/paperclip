import { expect, it } from "vitest";
import { applyChildRuntimePrivacyEnv } from "./diagnostic-env.js";

it("removes mixed-case diagnostic settings without changing provider or host state", () => {
  const input = Object.freeze({
    otel_sdk_disabled: "false", OtEl_Exporter_Otlp_Endpoint: "https://diagnostics.invalid/otel",
    sentry_dsn: "https://diagnostics.invalid/1", pi_telemetry: "1", DO_NOT_TRACK: "0",
    BETA_TRACING_ENDPOINT: "https://diagnostics.invalid/beta", ENABLE_BETA_TRACING_DETAILED: "1",
    PAPERCLIP_OBSERVABILITY_CODEX_CONFIG: '{"exporter":"otlp"}', OPENAI_BASE_URL: "https://provider.invalid/v1", HTTPS_PROXY: "http://proxy.invalid:8080",
    OPENAI_API_KEY: "fixture-provider-key", BRAVE_API_KEY: "fixture-search-key", PI_SKIP_VERSION_CHECK: "0", DISABLE_AUTOUPDATER: "0", DISABLE_UPDATES: "0",
  });
  const env = applyChildRuntimePrivacyEnv(input);
  expect(env).toMatchObject({ OTEL_SDK_DISABLED: "true", PI_TELEMETRY: "0", DO_NOT_TRACK: "1", ENABLE_BETA_TRACING_DETAILED: "0", OPENAI_BASE_URL: input.OPENAI_BASE_URL, HTTPS_PROXY: input.HTTPS_PROXY,
    OPENAI_API_KEY: input.OPENAI_API_KEY, BRAVE_API_KEY: input.BRAVE_API_KEY, PI_SKIP_VERSION_CHECK: "0", DISABLE_AUTOUPDATER: "0", DISABLE_UPDATES: "0" });
  for (const key of ["otel_sdk_disabled", "Otel_Exporter_Otlp_Endpoint", "OtEl_Exporter_Otlp_Endpoint", "sentry_dsn", "pi_telemetry", "BETA_TRACING_ENDPOINT", "PAPERCLIP_OBSERVABILITY_CODEX_CONFIG"]) expect(env).not.toHaveProperty(key);
  expect(input.DO_NOT_TRACK).toBe("0");
});

it("does not disable agent updates or impose network restrictions", () => {
  const env = applyChildRuntimePrivacyEnv({});
  for (const key of ["PI_SKIP_VERSION_CHECK", "DISABLE_AUTOUPDATER", "DISABLE_UPDATES", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"]) expect(env).not.toHaveProperty(key);
});
