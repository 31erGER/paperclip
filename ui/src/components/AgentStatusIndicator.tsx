// fork 31erGER: token-backed agent status indicator for chat agent lists and headers.
import type { CSSProperties, ReactNode } from "react";
import { AgentAvatar, type AgentAvatarProps } from "@/components/AgentAvatar";
import {
  agentStatusMotion,
  agentStatusVar,
  agentStatusVarDefault,
} from "@/lib/status-colors";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  running: "Running",
  idle: "Idle",
  active: "Idle",
  paused: "Paused",
  error: "Error",
  pending_approval: "Awaiting approval",
  terminated: "Terminated",
};

const STATUS_TEXT_CLASS: Record<string, string> = {
  running: "text-(--status-agent-running) font-medium",
  paused: "text-(--status-agent-paused)",
  pending_approval: "text-(--status-agent-paused)",
  error: "text-(--status-agent-error) font-medium",
};

export function resolveEffectiveAgentStatus(
  status: string,
  hasActiveConversation?: boolean,
): string {
  if (status === "active") return hasActiveConversation ? "running" : "idle";
  if (
    hasActiveConversation &&
    status !== "terminated" &&
    status !== "paused" &&
    status !== "error"
  ) {
    return "running";
  }
  return status;
}

export function agentStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

function agentStatusCssVar(status: string): string {
  if (status === "pending_approval") return "--status-agent-paused";
  return agentStatusVar[status] ?? agentStatusVarDefault;
}

export function AgentStatusDot({
  status,
  size = "sm",
  className,
}: {
  status: string;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const cssVar = agentStatusCssVar(status);
  const motion = agentStatusMotion[status] ?? "";
  const label = agentStatusLabel(status);
  const sizeClass =
    size === "xs" ? "size-2" : size === "md" ? "size-3" : "size-2.5";

  return (
    <span
      data-slot="agent-status-dot"
      data-status={status}
      aria-label={`Status: ${label}`}
      title={label}
      className={cn(
        "status-fill inline-block shrink-0 rounded-full",
        sizeClass,
        motion,
        className,
      )}
      style={{ "--sc": `var(${cssVar})` } as CSSProperties}
    />
  );
}

export function AgentStatusText({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const label = agentStatusLabel(status);
  return (
    <span
      data-slot="agent-status-text"
      data-status={status}
      className={cn(STATUS_TEXT_CLASS[status] ?? "text-muted-foreground", className)}
    >
      {label}
    </span>
  );
}

export function AgentAvatarWithStatus({
  status,
  dotSize,
  children,
  ...avatarProps
}: AgentAvatarProps & {
  status: string;
  dotSize?: "xs" | "sm" | "md";
  children?: ReactNode;
}) {
  const resolvedDotSize =
    dotSize ?? ((avatarProps.size ?? 24) >= 40 ? "sm" : "xs");
  return (
    <span className="relative inline-flex shrink-0">
      {children ?? <AgentAvatar {...avatarProps} />}
      <AgentStatusDot
        status={status}
        size={resolvedDotSize}
        className="absolute -bottom-0.5 -right-0.5 ring-2 ring-background"
      />
    </span>
  );
}
