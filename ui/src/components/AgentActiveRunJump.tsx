// fork 31erGER: honest live-run status resolution + 1-click jump to the exact
// task or chat window where an agent is currently executing.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Hourglass } from "lucide-react";
import type { Agent, Issue } from "@paperclipai/shared";
import { heartbeatsApi, type LiveRunForIssue } from "@/api/heartbeats";
import { AgentStatusDot, type AgentLiveRunState } from "@/components/AgentStatusIndicator";
import { isWaitingToStart } from "@/lib/agent-queue-wait";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { agentRouteRef, cn } from "@/lib/utils";

export interface AgentActiveRunSummary {
  kind: "running" | "queued";
  location: "chat" | "task" | "run";
  run: LiveRunForIssue;
  href: string;
  locationLabel: string;
  actionLabel: string;
}

export function buildChatIssueIdByAgentMap(
  chats: readonly Pick<Issue, "id" | "conversationAgentId">[] | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const chat of chats ?? []) {
    if (chat.conversationAgentId) {
      map.set(chat.conversationAgentId, chat.id);
    }
  }
  return map;
}

export function resolveAgentActiveRunSummary(
  agent: Pick<Agent, "id" | "name" | "urlKey" | "status">,
  liveRuns: readonly LiveRunForIssue[] | undefined,
  chatIssueIdByAgentId?: ReadonlyMap<string, string>,
): AgentActiveRunSummary | null {
  if (!liveRuns || liveRuns.length === 0) return null;
  const agentRuns = liveRuns.filter((run) => run.agentId === agent.id);
  if (agentRuns.length === 0) return null;

  const runningRun = agentRuns.find(
    (run) => run.status === "running" && !isWaitingToStart(run),
  );
  const chosen = runningRun ?? agentRuns[0]!;
  const kind: "running" | "queued" = runningRun ? "running" : "queued";
  const chatIssueId = chatIssueIdByAgentId?.get(agent.id);

  if (chosen.issueId && chatIssueId && chosen.issueId === chatIssueId) {
    return {
      kind,
      location: "chat",
      run: chosen,
      href: `/chats/${encodeURIComponent(agent.status === "terminated" ? agent.id : agentRouteRef(agent))}`,
      locationLabel: kind === "running" ? "Running in chat" : "Queued in chat",
      actionLabel: "Open chat",
    };
  }

  if (chosen.issueId) {
    return {
      kind,
      location: "task",
      run: chosen,
      href: `/issues/${encodeURIComponent(chosen.issueId)}`,
      locationLabel: kind === "running" ? "Running in task" : "Queued in task",
      actionLabel: kind === "running" ? "Jump to task" : "Open task",
    };
  }

  return {
    kind,
    location: "run",
    run: chosen,
    href: `/agents/${encodeURIComponent(agent.id)}/runs/${encodeURIComponent(chosen.id)}`,
    locationLabel: kind === "running" ? "Running" : "Queued",
    actionLabel: "Open run",
  };
}

export function resolveLiveRunState(
  summary: AgentActiveRunSummary | null | undefined,
  liveRunsLoaded: boolean,
): AgentLiveRunState | undefined {
  if (!liveRunsLoaded) return undefined;
  if (!summary) return "none";
  return summary.kind;
}

export function useCompanyLiveRuns(companyId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.liveRuns(companyId ?? ""),
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId!),
    enabled: Boolean(companyId),
    staleTime: 10_000,
  });
}

/**
 * Banner shown inside a single-agent chat when that agent is actually running
 * (or queued) in a different task/window, letting the user jump straight there.
 */
export function AgentRunningElsewhereBanner({
  companyId,
  agent,
  currentChatIssueId,
}: {
  companyId: string | null | undefined;
  agent: Pick<Agent, "id" | "name" | "urlKey" | "status">;
  currentChatIssueId: string | null | undefined;
}) {
  const { data: liveRuns } = useCompanyLiveRuns(companyId);

  const summary = useMemo(() => {
    const chatMap = new Map<string, string>();
    if (currentChatIssueId) chatMap.set(agent.id, currentChatIssueId);
    const resolved = resolveAgentActiveRunSummary(agent, liveRuns, chatMap);
    if (!resolved) return null;
    // Already looking at the chat where this agent is running — no banner needed.
    if (resolved.location === "chat") return null;
    return resolved;
  }, [agent, liveRuns, currentChatIssueId]);

  if (!summary) return null;

  const isRunning = summary.kind === "running";
  const detail = summary.run.currentStatusMessage?.trim();
  const statusCopy = isRunning
    ? summary.location === "task"
      ? "is currently running in a task"
      : "is currently running a background run"
    : summary.location === "task"
      ? "has a queued task waiting for a slot"
      : "has a queued run waiting for a slot";

  return (
    <div
      data-testid="agent-running-elsewhere-banner"
      data-run-kind={summary.kind}
      className={cn(
        "mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs",
        isRunning ? "bg-muted/35 text-foreground" : "bg-muted/20 text-muted-foreground",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {isRunning ? (
          <AgentStatusDot status="running" size="xs" />
        ) : (
          <Hourglass className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="truncate">
          <span className="font-medium text-foreground">{agent.name}</span>{" "}
          {statusCopy}
          {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
        </span>
      </div>
      <Link
        to={summary.href}
        data-testid="agent-running-elsewhere-jump"
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>{summary.actionLabel}</span>
        <ArrowUpRight className="size-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

/**
 * Compact global sidebar indicator listing only agents that are actively
 * executing right now (plus a queued count), with 1-click jump to the exact
 * task or chat window where each agent is running.
 */
export function SidebarActiveRuns({
  liveRuns,
  agents,
  chats,
}: {
  liveRuns: readonly LiveRunForIssue[] | undefined;
  agents?: readonly Pick<Agent, "id" | "name" | "urlKey" | "status">[];
  chats?: readonly Pick<Issue, "id" | "conversationAgentId">[];
}) {
  const { runningItems, queuedCount } = useMemo(() => {
    const runs = liveRuns ?? [];
    const agentById = new Map((agents ?? []).map((a) => [a.id, a]));
    const chatIssueByAgent = buildChatIssueIdByAgentMap(chats);

    const running: Array<{
      id: string;
      agentName: string;
      href: string;
      whereLabel: string;
    }> = [];
    let queued = 0;

    for (const run of runs) {
      if (run.status === "running" && !isWaitingToStart(run)) {
        const agent = agentById.get(run.agentId);
        const chatIssueId = chatIssueByAgent.get(run.agentId);
        const isChat = Boolean(run.issueId && chatIssueId && run.issueId === chatIssueId);
        const href = isChat
          ? `/chats/${encodeURIComponent(agent ? agentRouteRef(agent) : run.agentId)}`
          : run.issueId
            ? `/issues/${encodeURIComponent(run.issueId)}`
            : `/agents/${encodeURIComponent(run.agentId)}/runs/${encodeURIComponent(run.id)}`;
        running.push({
          id: run.id,
          agentName: agent?.name ?? run.agentName,
          href,
          whereLabel: isChat ? "in chat" : run.issueId ? "in task" : "run",
        });
      } else {
        queued += 1;
      }
    }
    return { runningItems: running, queuedCount: queued };
  }, [liveRuns, agents, chats]);

  if (runningItems.length === 0 && queuedCount === 0) return null;

  return (
    <div
      data-testid="sidebar-active-runs"
      className="mx-2 mt-1 flex flex-col gap-1 rounded-lg border border-border/70 bg-muted/25 px-2.5 py-2"
    >
      <div className="flex items-center justify-between gap-2 text-(length:--text-micro) text-muted-foreground">
        <span className="font-medium uppercase tracking-wider">Active now</span>
        {queuedCount > 0 ? (
          <Link
            to="/queue"
            data-testid="sidebar-active-runs-queue-link"
            className="tabular-nums underline-offset-2 hover:text-foreground hover:underline"
          >
            {queuedCount} queued
          </Link>
        ) : null}
      </div>
      {runningItems.length > 0 ? (
        <div className="flex flex-col gap-1">
          {runningItems.map((item) => (
            <Link
              key={item.id}
              to={item.href}
              data-testid={`sidebar-active-run-${item.id}`}
              className="group flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={`Jump to ${item.agentName} (${item.whereLabel})`}
            >
              <AgentStatusDot status="running" size="xs" />
              <span className="min-w-0 flex-1 truncate font-medium">
                {item.agentName}
              </span>
              <span className="shrink-0 text-(length:--text-micro) text-muted-foreground">
                {item.whereLabel}
              </span>
              <ArrowUpRight
                className="size-3 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground"
                aria-hidden="true"
              />
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <Hourglass className="size-3 shrink-0" aria-hidden="true" />
          <span>Waiting for slot…</span>
        </div>
      )}
    </div>
  );
}
