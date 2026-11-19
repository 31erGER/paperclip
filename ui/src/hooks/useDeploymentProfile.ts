import { useQuery } from "@tanstack/react-query";
import {
  hidesCostMetrics,
  isLocalDeploymentProfile,
  parseDeploymentProfile,
  type DeploymentProfile,
} from "@paperclipai/shared";
import { healthApi } from "@/api/health";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Deployment profile of this instance (fork 31erGER, local harness), read from
 * the app-wide health query cache. CloudAccessGate owns the fetch; this
 * observer never issues its own request.
 *
 * - `isLocal`: agents run only as host processes; hide Runner/sandbox choices.
 * - `showCostMetrics`: false under `local_only`; hide prices and spend.
 */
export function useDeploymentProfile(): {
  profile: DeploymentProfile;
  isLocal: boolean;
  showCostMetrics: boolean;
  loaded: boolean;
} {
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    enabled: false,
  });
  const profile = parseDeploymentProfile(healthQuery.data?.deploymentProfile);
  return {
    profile,
    isLocal: isLocalDeploymentProfile(profile),
    showCostMetrics: !hidesCostMetrics(profile),
    loaded: healthQuery.data !== undefined,
  };
}

/** Shorthand for components that only render cost and price values. */
export function useShowCostMetrics(): boolean {
  return useDeploymentProfile().showCostMetrics;
}
