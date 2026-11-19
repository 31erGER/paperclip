import type { ReactNode } from "react";
import { Navigate } from "@/lib/router";
import { useDeploymentProfile } from "@/hooks/useDeploymentProfile";

/**
 * Route guard for price and cost pages (fork 31erGER). Under the `local_only`
 * deployment profile these pages do not exist, so a bookmark or old link
 * lands on the dashboard instead.
 */
export function CostMetricsGate({ children }: { children: ReactNode }) {
  const { showCostMetrics, loaded } = useDeploymentProfile();
  if (!loaded) return null;
  if (!showCostMetrics) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
