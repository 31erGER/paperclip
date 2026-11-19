import {
  DEPLOYMENT_PROFILE_ENV,
  LOCAL_PROFILE_DISABLED_EXPERIMENTAL_FLAGS,
  isLocalDeploymentProfile,
  parseDeploymentProfile,
  type DeploymentProfile,
  type InstanceExperimentalSettings,
} from "@paperclipai/shared";

/**
 * Operator-selected deployment profile (fork 31erGER, local harness).
 * Read from `PAPERCLIP_DEPLOYMENT_PROFILE`; unknown values fall back to
 * `standard`. See doc/local/README.md.
 */
export function resolveDeploymentProfile(
  runtimeEnv: Record<string, string | undefined> = process.env,
): DeploymentProfile {
  return parseDeploymentProfile(runtimeEnv[DEPLOYMENT_PROFILE_ENV]);
}

export function isLocalProfileActive(
  runtimeEnv: Record<string, string | undefined> = process.env,
): boolean {
  return isLocalDeploymentProfile(resolveDeploymentProfile(runtimeEnv));
}

/**
 * Force off every experimental capability that needs Paperclip Runner, a
 * managed sandbox, or a hosted agent service. Applied on every read and never
 * persisted, so switching the profile back to `standard` restores the stored
 * values.
 */
export function applyDeploymentProfileExperimentalOverlay<T extends InstanceExperimentalSettings>(
  experimental: T,
  profile: DeploymentProfile,
): T {
  if (!isLocalDeploymentProfile(profile)) return experimental;
  const next = { ...experimental };
  for (const key of LOCAL_PROFILE_DISABLED_EXPERIMENTAL_FLAGS) next[key] = false as T[typeof key];
  return next;
}
