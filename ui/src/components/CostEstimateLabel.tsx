import type { CostByAgent } from "@paperclipai/shared";
import { Badge } from "./ui/badge";
import { useShowCostMetrics } from "@/hooks/useDeploymentProfile";

/** Use this group's ledger counts, never the page-wide estimate count. */
export function CostEstimateLabel({
  eventCount,
  estimatedEventCount,
}: Partial<Pick<CostByAgent, "eventCount" | "estimatedEventCount">>) {
  const showCostMetrics = useShowCostMetrics();
  if (!estimatedEventCount || !showCostMetrics) return null;
  const allEstimated = estimatedEventCount === eventCount;
  return (
    <Badge
      variant="outline"
      className="font-normal text-muted-foreground"
      title={`${estimatedEventCount} estimated ${estimatedEventCount === 1 ? "charge" : "charges"}. Calculated from token usage and published rates; provider bills may differ.`}
    >
      {allEstimated ? "Estimated" : "Partially estimated"}
    </Badge>
  );
}
