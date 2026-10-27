import { EXTERNAL_DIAGNOSTICS_ENABLED } from "@paperclipai/shared/privacy-policy";

const DIAGNOSTIC_OPT_OUT_ENV = {
  OTEL_SDK_DISABLED: "true",
  OTEL_TRACES_EXPORTER: "none",
  OTEL_LOGS_EXPORTER: "none",
  OTEL_METRICS_EXPORTER: "none",
  DO_NOT_TRACK: "1",
  PI_TELEMETRY: "0",
  DISABLE_TELEMETRY: "1",
  DISABLE_ERROR_REPORTING: "1",
  CLAUDE_CODE_ENABLE_TELEMETRY: "0",
  CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "0",
  ENABLE_ENHANCED_TELEMETRY_BETA: "0",
  ENABLE_BETA_TRACING_DETAILED: "0",
} as const;

/** Apply after environment merges, including explicit adapter settings. */
export function applyChildRuntimePrivacyEnv(env: Record<string, string>): Record<string, string>;
export function applyChildRuntimePrivacyEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function applyChildRuntimePrivacyEnv(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...input };
  if (EXTERNAL_DIAGNOSTICS_ENABLED) return env;
  for (const key of Object.keys(env)) {
    const normalized = key.toUpperCase();
    if (normalized.startsWith("OTEL_") || normalized.startsWith("SENTRY_") ||
        normalized === "BETA_TRACING_ENDPOINT" || normalized === "PAPERCLIP_OBSERVABILITY_CODEX_CONFIG" ||
        normalized in DIAGNOSTIC_OPT_OUT_ENV) {
      delete env[key];
    }
  }
  // Narrow Claude flags preserve updates; its broad nonessential-traffic flag
  // also disables the updater. Provider URLs, credentials and proxies pass through.
  return Object.assign(env, DIAGNOSTIC_OPT_OUT_ENV);
}
