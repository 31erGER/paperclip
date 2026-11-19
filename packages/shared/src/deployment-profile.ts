/**
 * Deployment profile of a self-hosted instance (fork 31erGER, local harness).
 *
 * - `standard`: upstream behavior.
 * - `local`: agents run only as host processes (Legacy runner, Local
 *   environment). Paperclip Runner, managed sandboxes and native-only agent
 *   kinds are switched off and hidden.
 * - `local_only`: `local` plus local models only. Price and cost metrics are
 *   hidden and the instance-wide run limit defaults to one model run at a time.
 *
 * The profile is chosen by the operator with `PAPERCLIP_DEPLOYMENT_PROFILE`.
 * See doc/local/README.md.
 */
export const DEPLOYMENT_PROFILES = ["standard", "local", "local_only"] as const;
export type DeploymentProfile = (typeof DEPLOYMENT_PROFILES)[number];

export const DEPLOYMENT_PROFILE_ENV = "PAPERCLIP_DEPLOYMENT_PROFILE";

/** Run limit used by `local_only` when the operator has not set one. */
export const LOCAL_ONLY_DEFAULT_MAX_CONCURRENT_AGENT_RUNS = 1;

/** Upper bound for the instance-wide run limit setting. */
export const MAX_CONCURRENT_AGENT_RUNS_LIMIT = 64;

/**
 * Experimental flags that a local profile forces off. They all depend on
 * Paperclip Runner, a managed sandbox, or a hosted agent service.
 */
export const LOCAL_PROFILE_DISABLED_EXPERIMENTAL_FLAGS = [
  "enableNativeRunner",
  "enableManagedSandboxOnly",
  "enableSandboxDuplexBridge",
  "enableOpenAiDot",
  "enableGrokBot",
  "enableMuse",
] as const;

export function parseDeploymentProfile(raw: unknown): DeploymentProfile {
  if (typeof raw !== "string") return "standard";
  const value = raw.trim().toLowerCase().replace(/-/g, "_");
  return (DEPLOYMENT_PROFILES as readonly string[]).includes(value)
    ? (value as DeploymentProfile)
    : "standard";
}

/** True for `local` and `local_only`: host execution only. */
export function isLocalDeploymentProfile(profile: DeploymentProfile | null | undefined): boolean {
  return profile === "local" || profile === "local_only";
}

/** True only for `local_only`: no price or cost metrics. */
export function hidesCostMetrics(profile: DeploymentProfile | null | undefined): boolean {
  return profile === "local_only";
}

/**
 * Effective instance-wide limit of concurrently running agent runs.
 * `null` means unlimited (upstream behavior).
 */
export function effectiveMaxConcurrentAgentRuns(
  configured: number | null | undefined,
  profile: DeploymentProfile | null | undefined,
): number | null {
  if (typeof configured === "number" && Number.isInteger(configured) && configured > 0) {
    return Math.min(configured, MAX_CONCURRENT_AGENT_RUNS_LIMIT);
  }
  return profile === "local_only" ? LOCAL_ONLY_DEFAULT_MAX_CONCURRENT_AGENT_RUNS : null;
}
