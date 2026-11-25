// fork 31erGER: full Run Queue panel — active inference slots, all queued messages
// (with Steer / Send now / Discard + metadata), and ordered waiting runs with metadata.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  Hourglass,
  ListOrdered,
  MessageCircle,
  MessageSquareText,
  RefreshCw,
  Send,
  Settings,
  Square,
  Trash2,
  Zap,
} from "lucide-react";
import {
  effectiveMaxConcurrentAgentRuns,
  type Agent,
  type Issue,
  type IssueComment,
  type IssueQueuedCommentQueue,
} from "@paperclipai/shared";
import { agentChatsApi } from "@/api/agentChats";
import { agentsApi } from "@/api/agents";
import { heartbeatsApi, type LiveRunForIssue } from "@/api/heartbeats";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { issuesApi } from "@/api/issues";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AgentStatusDot } from "@/components/AgentStatusIndicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { useToastActions } from "@/context/ToastContext";
import { useDeploymentProfile } from "@/hooks/useDeploymentProfile";
import { queryKeys } from "@/lib/queryKeys";
import {
  buildQueuedMessageItems,
  buildRunQueueView,
  formatBytesCompact,
  formatQueueDuration,
  type QueuedMessageItem,
  type QueueRunItem,
  type VisualQueueSlot,
} from "@/lib/run-queue-view";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";

type QueueScope = "all" | "company";

function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function formatIsoTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function locationBadgeText(item: QueueRunItem): string {
  if (item.location === "chat") return "Direct chat";
  if (item.issueIdentifier) return item.issueIdentifier;
  if (item.location === "task") return "Task";
  return "Background run";
}

function itemHeadline(item: QueueRunItem): string {
  if (item.location === "chat") return `Chat with ${item.agentName}`;
  if (item.issueIdentifier && item.issueTitle) {
    return `${item.issueIdentifier} · ${item.issueTitle}`;
  }
  if (item.issueTitle) return item.issueTitle;
  if (item.issueIdentifier) return item.issueIdentifier;
  if (item.location === "task") return "Assigned task";
  return `Heartbeat (${item.invocationSource})`;
}

function MetadataGrid({
  rows,
  testId,
}: {
  rows: ReadonlyArray<{ label: string; value: string; mono?: boolean; title?: string }>;
  testId?: string;
}) {
  return (
    <dl
      data-testid={testId}
      className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-xs sm:grid-cols-3"
    >
      {rows.map((row) => (
        <div key={row.label} className="min-w-0">
          <dt className="text-(length:--text-micro) text-muted-foreground">{row.label}</dt>
          <dd
            title={row.title ?? row.value}
            className={cn(
              "truncate text-foreground",
              row.mono && "font-mono text-(length:--text-micro)",
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function buildRunMetadataRows(item: QueueRunItem) {
  const exec = item.execution;
  const rows: Array<{ label: string; value: string; mono?: boolean; title?: string }> = [
    { label: "Run ID", value: shortId(item.id), mono: true, title: item.id },
    { label: "Status", value: item.status },
    { label: "Priority", value: `Tier ${item.priorityTier} · ${item.priorityMeta.shortLabel}` },
    {
      label: "Trigger",
      value: item.triggerDetail ? `${item.invocationSource} (${item.triggerDetail})` : item.invocationSource,
    },
    {
      label: "Adapter",
      value: item.runtimeMode ? `${item.adapterType} · ${item.runtimeMode}` : item.adapterType,
      mono: true,
    },
    { label: "Company", value: `${item.companyName} (${item.companyPrefix})` },
    { label: "Queued at", value: formatIsoTimestamp(item.createdAt), title: item.createdAt },
    {
      label: "Started at",
      value: formatIsoTimestamp(item.startedAt),
      title: item.startedAt ?? undefined,
    },
    {
      label: "Last event",
      value: formatIsoTimestamp(item.lastEventAt),
      title: item.lastEventAt ?? undefined,
    },
  ];
  if (item.wakeupRequestId) {
    rows.push({ label: "Wakeup ID", value: shortId(item.wakeupRequestId), mono: true, title: item.wakeupRequestId });
  }
  if (item.issueId) {
    rows.push({
      label: item.location === "chat" ? "Chat Thread ID" : "Task ID",
      value: item.issueIdentifier ?? shortId(item.issueId),
      mono: true,
      title: item.issueId,
    });
  }
  if (item.contextWakeCommentId || item.contextCommentId) {
    const cid = item.contextWakeCommentId ?? item.contextCommentId!;
    rows.push({ label: "Trigger Comment", value: shortId(cid), mono: true, title: cid });
  }
  if (item.livenessState) {
    rows.push({
      label: "Liveness",
      value: item.livenessReason ? `${item.livenessState} (${item.livenessReason})` : item.livenessState,
    });
  }
  if (item.continuationAttempt > 0) {
    rows.push({ label: "Continuation", value: `Attempt #${item.continuationAttempt}` });
  }
  if (item.logBytes != null && item.logBytes > 0) {
    rows.push({ label: "Log size", value: formatBytesCompact(item.logBytes) });
  }
  if (exec?.label || exec?.cause) {
    rows.push({
      label: "Execution wait",
      value: exec.label ?? exec.cause ?? "—",
    });
  }
  return rows;
}

function buildMessageMetadataRows(msg: QueuedMessageItem) {
  const rows: Array<{ label: string; value: string; mono?: boolean; title?: string }> = [
    { label: "Comment ID", value: shortId(msg.commentId), mono: true, title: msg.commentId },
    { label: "Queue ID", value: shortId(msg.queueId), mono: true, title: msg.queueId },
    { label: "Queue state", value: msg.queueState ?? "queued" },
    { label: "Author", value: msg.authorLabel },
    { label: "Position in thread", value: `#${msg.position}` },
    { label: "Protocol", value: msg.protocol, mono: true },
    { label: "Steering", value: msg.steeringDisposition.replace(/_/g, " ") },
    { label: "Queued at", value: formatIsoTimestamp(msg.createdAt), title: msg.createdAt },
    { label: "Company", value: `${msg.companyName} (${msg.companyPrefix})` },
  ];
  if (msg.targetRunId) {
    rows.push({
      label: "Target Run ID",
      value: shortId(msg.targetRunId),
      mono: true,
      title: msg.targetRunId,
    });
  }
  if (msg.executionWait) {
    rows.push({
      label: "Wait condition",
      value: `${msg.executionWait.reason}: ${msg.executionWait.message}`,
    });
  }
  return rows;
}

function SlotCard({
  slot,
  showCompanyBadge,
  nowMs,
  expanded,
  onToggleExpand,
  cancellingId,
  onCancel,
}: {
  slot: VisualQueueSlot;
  showCompanyBadge: boolean;
  nowMs: number;
  expanded: boolean;
  onToggleExpand: () => void;
  cancellingId: string | null;
  onCancel: (item: QueueRunItem) => void;
}) {
  const isExpress = slot.kind === "express";
  const item = slot.item;

  if (!item) {
    return (
      <div
        data-testid={`queue-slot-${slot.key}`}
        data-slot-state="available"
        className={cn(
          "flex min-h-32 flex-col justify-between rounded-xl border border-dashed p-4 transition-colors",
          isExpress ? "border-border bg-muted/15" : "border-border/80 bg-muted/10",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            {isExpress ? (
              <Zap className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <Cpu className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span>{slot.label}</span>
          </span>
          <Badge variant="outline" className="text-(length:--text-micro) text-muted-foreground">
            Available
          </Badge>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          {isExpress
            ? "Reserved for direct coordinator chat & promoted messages."
            : "Ready for the next queued task."}
        </p>
      </div>
    );
  }

  const activityLine = item.currentToolName
    ? `Running ${item.currentToolName}${item.currentStatusMessage ? ` · ${item.currentStatusMessage}` : ""}`
    : item.currentStatusMessage?.trim() || "Generating response…";
  const elapsed = formatQueueDuration(item.startedAt ?? item.createdAt, nowMs);
  const isCancelling = cancellingId === item.id;

  return (
    <div
      data-testid={`queue-slot-${slot.key}`}
      data-slot-state="occupied"
      className="flex min-h-32 flex-col justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-xs"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <AgentStatusDot status="running" size="sm" />
          <span className="inline-flex items-center gap-1 text-xs font-medium text-(--status-agent-running)">
            {isExpress ? <Zap className="size-3 shrink-0" aria-hidden="true" /> : null}
            <span>{slot.label}</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {showCompanyBadge ? (
            <Badge variant="secondary" className="gap-1 text-(length:--text-micro)">
              <Building2 className="size-3" aria-hidden="true" />
              <span>{item.companyPrefix}</span>
            </Badge>
          ) : null}
          <span className="inline-flex items-center gap-1 text-(length:--text-micro) tabular-nums text-muted-foreground">
            <Clock className="size-3" aria-hidden="true" />
            {elapsed}
          </span>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2.5">
        {item.agent ? (
          <AgentAvatar agent={item.agent} size={32} className="shrink-0" />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">
              {item.agentName}
            </span>
            <Badge variant="outline" className="shrink-0 text-(length:--text-micro)">
              {item.location === "chat" ? (
                <span className="inline-flex items-center gap-1">
                  <MessageCircle className="size-2.5" aria-hidden="true" />
                  Chat
                </span>
              ) : (
                locationBadgeText(item)
              )}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground" title={itemHeadline(item)}>
            {itemHeadline(item)}
          </p>
        </div>
      </div>

      {item.triggerMessageBody ? (
        <p className="line-clamp-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs text-muted-foreground">
          {item.triggerMessageBody}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          data-testid={`queue-slot-meta-toggle-${item.id}`}
          className="inline-flex min-w-0 items-center gap-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate" title={activityLine}>
            {activityLine}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={isCancelling}
            onClick={() => onCancel(item)}
            aria-label={`Cancel active run for ${item.agentName}`}
            className="text-muted-foreground hover:text-destructive"
          >
            <Square className="size-3" aria-hidden="true" />
            <span>{isCancelling ? "Stopping…" : "Stop"}</span>
          </Button>
          <Button asChild size="xs" variant="outline">
            <Link
              to={item.href}
              data-testid={`queue-jump-${item.id}`}
              className="inline-flex items-center gap-1"
            >
              <span>Jump</span>
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>

      {expanded ? (
        <MetadataGrid
          rows={buildRunMetadataRows(item)}
          testId={`queue-slot-meta-${item.id}`}
        />
      ) : null}
    </div>
  );
}

function QueuedMessageCard({
  msg,
  showCompanyBadge,
  nowMs,
  expanded,
  onToggleExpand,
  busyKey,
  onSteer,
  onSendNow,
  onDiscard,
}: {
  msg: QueuedMessageItem;
  showCompanyBadge: boolean;
  nowMs: number;
  expanded: boolean;
  onToggleExpand: () => void;
  busyKey: string | null;
  onSteer: (msg: QueuedMessageItem) => void;
  onSendNow: (msg: QueuedMessageItem) => void;
  onDiscard: (msg: QueuedMessageItem) => void;
}) {
  const waited = formatQueueDuration(msg.createdAt, nowMs);
  const canSteerNow = msg.steeringDisposition === "available" && Boolean(msg.targetRunId);
  const isBusy = busyKey !== null && busyKey.startsWith(`${msg.commentId}:`);

  return (
    <div
      data-testid={`queued-message-${msg.commentId}`}
      className="flex flex-col gap-2.5 rounded-xl border border-border bg-card px-4 py-3 shadow-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {msg.agent ? (
            <AgentAvatar agent={msg.agent} size={24} className="shrink-0" />
          ) : (
            <MessageSquareText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">
              {msg.targetLabel}
            </span>
            <Badge variant="secondary" className="text-(length:--text-micro)">
              {msg.queueState === "deferred" ? "Deferred" : "Queued"} #{msg.position}
            </Badge>
            {canSteerNow ? (
              <Badge variant="outline" className="text-(length:--text-micro) text-(--status-agent-running)">
                Live steer ready
              </Badge>
            ) : null}
            {showCompanyBadge ? (
              <Badge variant="outline" className="gap-1 text-(length:--text-micro)">
                <Building2 className="size-3" aria-hidden="true" />
                <span>{msg.companyPrefix}</span>
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
            <Hourglass className="size-3" aria-hidden="true" />
            <span>{waited}</span>
          </span>
          {canSteerNow ? (
            <Button
              type="button"
              size="xs"
              variant="default"
              disabled={isBusy}
              onClick={() => onSteer(msg)}
              data-testid={`queued-message-steer-${msg.commentId}`}
            >
              <Zap className="size-3" aria-hidden="true" />
              <span>{busyKey === `${msg.commentId}:steer` ? "Steering…" : "Steer"}</span>
            </Button>
          ) : null}
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={isBusy}
            onClick={() => onSendNow(msg)}
            data-testid={`queued-message-send-${msg.commentId}`}
          >
            <Send className="size-3" aria-hidden="true" />
            <span>{busyKey === `${msg.commentId}:send` ? "Promoting…" : "Send now"}</span>
          </Button>
          {msg.canDiscard ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={isBusy}
              onClick={() => onDiscard(msg)}
              aria-label={`Discard queued message ${msg.commentId}`}
              data-testid={`queued-message-discard-${msg.commentId}`}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3" aria-hidden="true" />
            </Button>
          ) : null}
          <Button asChild size="xs" variant="outline">
            <Link
              to={msg.href}
              data-testid={`queued-message-open-${msg.commentId}`}
              className="inline-flex items-center gap-1"
            >
              <span>Open</span>
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Message content */}
      <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm whitespace-pre-wrap break-words text-foreground">
        {msg.interactionSummary ? (
          <span className="text-xs text-muted-foreground">{msg.interactionSummary}</span>
        ) : (
          msg.body
        )}
      </div>

      {/* Compact metadata bar + expand toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>From: <span className="text-foreground">{msg.authorLabel}</span></span>
          <span>Queued: <span className="tabular-nums text-foreground">{formatIsoTimestamp(msg.createdAt)}</span></span>
          {msg.executionWait ? (
            <span>Wait: <span className="text-foreground">{msg.executionWait.message}</span></span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          data-testid={`queued-message-meta-toggle-${msg.commentId}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden="true" />
          )}
          <span>Metadata</span>
        </button>
      </div>

      {expanded ? (
        <MetadataGrid
          rows={buildMessageMetadataRows(msg)}
          testId={`queued-message-meta-${msg.commentId}`}
        />
      ) : null}
    </div>
  );
}

function QueuedRow({
  item,
  showCompanyBadge,
  nowMs,
  expanded,
  onToggleExpand,
  cancellingId,
  onCancel,
}: {
  item: QueueRunItem;
  showCompanyBadge: boolean;
  nowMs: number;
  expanded: boolean;
  onToggleExpand: () => void;
  cancellingId: string | null;
  onCancel: (item: QueueRunItem) => void;
}) {
  const isNext = item.queuePosition === 1;
  const waited = formatQueueDuration(item.createdAt, nowMs);
  const isCancelling = cancellingId === item.id;

  return (
    <div
      data-testid={`queue-item-${item.id}`}
      data-queue-position={item.queuePosition ?? undefined}
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border px-4 py-3 transition-colors",
        isNext
          ? "border-border bg-card shadow-xs"
          : "border-border/70 bg-muted/15 hover:bg-muted/30",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-semibold tabular-nums",
              isNext
                ? "border-border bg-accent text-accent-foreground"
                : "border-border/60 bg-background text-muted-foreground",
            )}
            aria-label={`Queue position ${item.queuePosition}`}
          >
            #{item.queuePosition}
          </div>

          {item.agent ? (
            <AgentAvatar agent={item.agent} size={32} className="shrink-0" />
          ) : null}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">
                {item.agentName}
              </span>
              {isNext ? (
                <Badge variant="default" className="text-(length:--text-micro)">
                  Next up
                </Badge>
              ) : null}
              <Badge
                variant={item.priorityTier === 1 ? "secondary" : "outline"}
                className="text-(length:--text-micro)"
              >
                {item.priorityMeta.label}
              </Badge>
              {showCompanyBadge ? (
                <Badge variant="secondary" className="gap-1 text-(length:--text-micro)">
                  <Building2 className="size-3" aria-hidden="true" />
                  <span>{item.companyPrefix}</span>
                </Badge>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={itemHeadline(item)}>
              {itemHeadline(item)}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
            <Hourglass className="size-3" aria-hidden="true" />
            <span>Waiting {waited}</span>
          </span>
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            data-testid={`queue-item-meta-toggle-${item.id}`}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden="true" />
            )}
            <span>Metadata</span>
          </button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={isCancelling}
            onClick={() => onCancel(item)}
            aria-label={`Cancel queued run for ${item.agentName}`}
            className="text-muted-foreground hover:text-destructive"
          >
            <span>{isCancelling ? "Cancelling…" : "Cancel"}</span>
          </Button>
          <Button asChild size="xs" variant="outline">
            <Link
              to={item.href}
              data-testid={`queue-open-${item.id}`}
              className="inline-flex items-center gap-1"
            >
              <span>Open</span>
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>

      {item.triggerMessageBody ? (
        <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-xs whitespace-pre-wrap break-words text-foreground">
          {item.triggerMessageBody}
        </div>
      ) : null}

      {expanded ? (
        <MetadataGrid
          rows={buildRunMetadataRows(item)}
          testId={`queue-item-meta-${item.id}`}
        />
      ) : null}
    </div>
  );
}

export function RunQueue() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { companies, selectedCompanyId, selectedCompany } = useCompany();
  const { profile } = useDeploymentProfile();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();

  const [scope, setScope] = useState<QueueScope>("all");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [messageBusyKey, setMessageBusyKey] = useState<string | null>(null);
  const [expandedMetaIds, setExpandedMetaIds] = useState<Set<string>>(() => new Set());
  const [expandAllMeta, setExpandAllMeta] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Queue" }]);
  }, [setBreadcrumbs]);

  const toggleMetaExpanded = (id: string) => {
    setExpandedMetaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const isMetaExpanded = (id: string) => expandAllMeta || expandedMetaIds.has(id);

  const activeCompanies = useMemo(
    () => companies.filter((company) => company.status !== "archived"),
    [companies],
  );
  const queriedCompanies = useMemo(() => {
    if (scope === "company" && selectedCompany) return [selectedCompany];
    if (activeCompanies.length > 0) return activeCompanies;
    return selectedCompany ? [selectedCompany] : [];
  }, [scope, selectedCompany, activeCompanies]);

  const generalSettings = useQuery({
    queryKey: queryKeys.instance.generalSettings,
    queryFn: () => instanceSettingsApi.getGeneral(),
    staleTime: 30_000,
  });

  const effectiveLimit = useMemo(
    () =>
      effectiveMaxConcurrentAgentRuns(
        generalSettings.data?.maxConcurrentAgentRuns ?? null,
        profile,
      ),
    [generalSettings.data?.maxConcurrentAgentRuns, profile],
  );

  const liveRunQueries = useQueries({
    queries: queriedCompanies.map((company) => ({
      queryKey: [...queryKeys.liveRuns(company.id), "run-queue-page"] as const,
      queryFn: () => heartbeatsApi.liveRunsForCompany(company.id, { limit: 50 }),
      refetchInterval: 5_000,
    })),
  });

  const agentQueries = useQueries({
    queries: queriedCompanies.map((company) => ({
      queryKey: queryKeys.agents.list(company.id),
      queryFn: () => agentsApi.list(company.id),
      staleTime: 30_000,
    })),
  });

  const chatQueries = useQueries({
    queries: queriedCompanies.map((company) => ({
      queryKey: ["run-queue-chats", company.id] as const,
      queryFn: () => agentChatsApi.list(company.id).catch(() => [] as Issue[]),
      staleTime: 30_000,
    })),
  });

  const runsByCompanyId = useMemo(() => {
    const map = new Map<string, readonly LiveRunForIssue[]>();
    queriedCompanies.forEach((company, idx) => {
      const data = liveRunQueries[idx]?.data;
      if (data) map.set(company.id, data);
    });
    return map;
  }, [queriedCompanies, liveRunQueries]);

  const agentsByCompanyId = useMemo(() => {
    const map = new Map<string, readonly Agent[]>();
    queriedCompanies.forEach((company, idx) => {
      const data = agentQueries[idx]?.data;
      if (data) map.set(company.id, data);
    });
    return map;
  }, [queriedCompanies, agentQueries]);

  const chatsByCompanyId = useMemo(() => {
    const map = new Map<string, readonly Issue[]>();
    queriedCompanies.forEach((company, idx) => {
      const data = chatQueries[idx]?.data;
      if (data) map.set(company.id, data);
    });
    return map;
  }, [queriedCompanies, chatQueries]);

  const chatIssueIds = useMemo(() => {
    const set = new Set<string>();
    for (const chats of chatsByCompanyId.values()) {
      for (const chat of chats) set.add(chat.id);
    }
    return set;
  }, [chatsByCompanyId]);

  const { referencedIssueIds, companyIdByIssueId, commentIssueIds, queuedCommentTargetIssueIds } = useMemo(() => {
    const taskIds = new Set<string>();
    const companyMap = new Map<string, string>();
    const commentIds = new Set<string>();
    const queuedMsgTargetIds = new Set<string>();

    for (const [companyId, chats] of chatsByCompanyId.entries()) {
      for (const chat of chats) {
        companyMap.set(chat.id, companyId);
        queuedMsgTargetIds.add(chat.id);
      }
    }

    for (const [companyId, runs] of runsByCompanyId.entries()) {
      for (const run of runs) {
        if (!run.issueId || (run.status !== "running" && run.status !== "queued")) continue;
        companyMap.set(run.issueId, companyId);
        queuedMsgTargetIds.add(run.issueId);
        if (!chatIssueIds.has(run.issueId)) {
          taskIds.add(run.issueId);
        }
        if (run.contextWakeCommentId || run.contextCommentId) {
          commentIds.add(run.issueId);
        }
      }
    }

    return {
      referencedIssueIds: [...taskIds].slice(0, 30),
      companyIdByIssueId: companyMap,
      commentIssueIds: [...commentIds].slice(0, 20),
      queuedCommentTargetIssueIds: [...queuedMsgTargetIds].slice(0, 40),
    };
  }, [runsByCompanyId, chatsByCompanyId, chatIssueIds]);

  const issueQueries = useQueries({
    queries: referencedIssueIds.map((issueId) => ({
      queryKey: queryKeys.issues.detail(issueId),
      queryFn: () => issuesApi.get(issueId),
      staleTime: 30_000,
    })),
  });

  const queuedCommentQueries = useQueries({
    queries: queuedCommentTargetIssueIds.map((issueId) => ({
      queryKey: ["run-queue-queued-comments", issueId] as const,
      queryFn: () => issuesApi.getQueuedComments(issueId).catch(() => null),
      refetchInterval: 5_000,
    })),
  });

  const triggerCommentQueries = useQueries({
    queries: commentIssueIds.map((issueId) => ({
      queryKey: ["run-queue-trigger-comments", issueId] as const,
      queryFn: () =>
        issuesApi.listComments(issueId, { order: "desc", limit: 10 }).catch(() => [] as IssueComment[]),
      staleTime: 15_000,
    })),
  });

  const issuesById = useMemo(() => {
    const map = new Map<string, Pick<Issue, "id" | "companyId" | "identifier" | "title" | "assigneeAgentId">>();
    for (const query of issueQueries) {
      if (query.data) map.set(query.data.id, query.data);
    }
    return map;
  }, [issueQueries]);

  const commentsById = useMemo(() => {
    const map = new Map<string, Pick<IssueComment, "id" | "body" | "createdAt">>();
    for (const query of triggerCommentQueries) {
      for (const comment of query.data ?? []) {
        map.set(comment.id, comment);
      }
    }
    return map;
  }, [triggerCommentQueries]);

  const queuedCommentsByIssueId = useMemo(() => {
    const map = new Map<string, IssueQueuedCommentQueue>();
    queuedCommentTargetIssueIds.forEach((issueId, idx) => {
      const data = queuedCommentQueries[idx]?.data;
      if (data) map.set(issueId, data);
    });
    return map;
  }, [queuedCommentTargetIssueIds, queuedCommentQueries]);

  const view = useMemo(
    () =>
      buildRunQueueView({
        companies: queriedCompanies,
        runsByCompanyId,
        agentsByCompanyId,
        chatsByCompanyId,
        issuesById,
        commentsById,
        effectiveLimit,
        scopeCompanyId: scope === "company" ? selectedCompanyId : null,
      }),
    [
      queriedCompanies,
      runsByCompanyId,
      agentsByCompanyId,
      chatsByCompanyId,
      issuesById,
      commentsById,
      effectiveLimit,
      scope,
      selectedCompanyId,
    ],
  );

  const queuedMessages = useMemo(
    () =>
      buildQueuedMessageItems({
        companies: queriedCompanies,
        agentsByCompanyId,
        chatsByCompanyId,
        issuesById,
        queuedCommentsByIssueId,
        companyIdByIssueId,
      }),
    [
      queriedCompanies,
      agentsByCompanyId,
      chatsByCompanyId,
      issuesById,
      queuedCommentsByIssueId,
      companyIdByIssueId,
    ],
  );

  const hasLiveItems =
    view.running.length > 0 || view.queued.length > 0 || queuedMessages.length > 0;
  useEffect(() => {
    if (!hasLiveItems) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [hasLiveItems]);

  const invalidateQueueData = async (companyId: string, issueId?: string | null) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(companyId) }),
      ...(issueId
        ? [
            queryClient.invalidateQueries({ queryKey: ["run-queue-queued-comments", issueId] }),
            queryClient.invalidateQueries({ queryKey: queryKeys.issues.queuedComments(issueId) }),
          ]
        : []),
    ]);
  };

  const cancelMutation = useMutation({
    mutationFn: (item: QueueRunItem) => heartbeatsApi.cancel(item.id),
    onMutate: (item) => {
      setCancellingId(item.id);
    },
    onSuccess: async (_data, item) => {
      await invalidateQueueData(item.companyId, item.issueId);
      pushToast({
        title: item.status === "running" ? "Run stopped" : "Queued run cancelled",
        body: `${item.agentName} · ${itemHeadline(item)}`,
        tone: "success",
      });
    },
    onError: (error, item) => {
      pushToast({
        title: "Could not cancel run",
        body: error instanceof Error ? error.message : item.agentName,
        tone: "error",
      });
    },
    onSettled: () => {
      setCancellingId(null);
    },
  });

  const steerMessageMutation = useMutation({
    mutationFn: (msg: QueuedMessageItem) => {
      if (!msg.targetRunId) throw new Error("No active run to steer.");
      return issuesApi.steerQueuedComment(msg.issueId, msg.commentId, {
        queueId: msg.queueId,
        targetRunId: msg.targetRunId,
        revision: msg.revision,
      });
    },
    onMutate: (msg) => setMessageBusyKey(`${msg.commentId}:steer`),
    onSuccess: async (_data, msg) => {
      await invalidateQueueData(msg.companyId, msg.issueId);
      pushToast({
        title: "Steering message delivered",
        body: msg.targetLabel,
        tone: "success",
      });
    },
    onError: (error, msg) => {
      pushToast({
        title: "Could not steer message",
        body: error instanceof Error ? error.message : msg.targetLabel,
        tone: "error",
      });
    },
    onSettled: () => setMessageBusyKey(null),
  });

  const sendNowMessageMutation = useMutation({
    mutationFn: (msg: QueuedMessageItem) =>
      issuesApi.interruptQueuedComments(msg.issueId, {
        queueId: msg.queueId,
        targetRunId: msg.targetRunId,
        revision: msg.revision,
      }),
    onMutate: (msg) => setMessageBusyKey(`${msg.commentId}:send`),
    onSuccess: async (_data, msg) => {
      await invalidateQueueData(msg.companyId, msg.issueId);
      pushToast({
        title: "Message promoted",
        body: msg.targetLabel,
        tone: "success",
      });
    },
    onError: (error, msg) => {
      pushToast({
        title: "Could not promote message",
        body: error instanceof Error ? error.message : msg.targetLabel,
        tone: "error",
      });
    },
    onSettled: () => setMessageBusyKey(null),
  });

  const discardMessageMutation = useMutation({
    mutationFn: (msg: QueuedMessageItem) =>
      issuesApi.discardQueuedComment(msg.issueId, msg.commentId, {
        queueId: msg.queueId,
        revision: msg.revision,
      }),
    onMutate: (msg) => setMessageBusyKey(`${msg.commentId}:discard`),
    onSuccess: async (_data, msg) => {
      await invalidateQueueData(msg.companyId, msg.issueId);
      pushToast({
        title: "Queued message discarded",
        body: msg.targetLabel,
        tone: "success",
      });
    },
    onError: (error, msg) => {
      pushToast({
        title: "Could not discard message",
        body: error instanceof Error ? error.message : msg.targetLabel,
        tone: "error",
      });
    },
    onSettled: () => setMessageBusyKey(null),
  });

  const isRefreshing =
    liveRunQueries.some((query) => query.isFetching) ||
    queuedCommentQueries.some((query) => query.isFetching);
  const isInitialLoading =
    queriedCompanies.length > 0 &&
    liveRunQueries.every((query) => query.isPending);

  const handleRefresh = () => {
    for (const query of liveRunQueries) void query.refetch();
    for (const query of queuedCommentQueries) void query.refetch();
    for (const query of triggerCommentQueries) void query.refetch();
    void generalSettings.refetch();
  };

  const showCompanyBadges = scope === "all" && activeCompanies.length > 1;
  const capacityLabel =
    effectiveLimit === null
      ? "Unlimited parallel runs"
      : `${effectiveLimit} worker ${effectiveLimit === 1 ? "slot" : "slots"} + 1 express slot`;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <ListOrdered className="size-5 text-muted-foreground" aria-hidden="true" />
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Run Queue
            </h1>
            <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
              {capacityLabel}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Live view of active inference slots, pending messages, and queued runs with full metadata
            {activeCompanies.length > 1 ? " across all companies." : "."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeCompanies.length > 1 && selectedCompany ? (
            <div
              role="group"
              aria-label="Queue company scope"
              className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5"
            >
              <button
                type="button"
                onClick={() => setScope("all")}
                aria-pressed={scope === "all"}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  scope === "all"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                All companies ({activeCompanies.length})
              </button>
              <button
                type="button"
                onClick={() => setScope("company")}
                aria-pressed={scope === "company"}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  scope === "company"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {selectedCompany.name}
              </button>
            </div>
          ) : null}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setExpandAllMeta((prev) => !prev)}
            data-testid="queue-toggle-all-metadata"
          >
            {expandAllMeta ? "Hide all metadata" : "Show all metadata"}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn("size-3.5", isRefreshing && "motion-safe:animate-spin")} aria-hidden="true" />
            <span>Refresh</span>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/company/settings">
              <Settings className="size-3.5" aria-hidden="true" />
              <span>Queue settings</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Summary metrics bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">Running now</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              data-testid="queue-running-count"
              className="text-2xl font-semibold tabular-nums text-foreground"
            >
              {view.running.length}
            </span>
            <span className="text-xs text-muted-foreground">
              {view.maxWithExpress !== null ? `of ${view.maxWithExpress} max` : "active"}
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">Queued messages</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              data-testid="queue-messages-count"
              className="text-2xl font-semibold tabular-nums text-foreground"
            >
              {queuedMessages.length}
            </span>
            <span className="text-xs text-muted-foreground">
              {queuedMessages.length === 1 ? "message" : "messages"}
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">Queued runs</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              data-testid="queue-waiting-count"
              className="text-2xl font-semibold tabular-nums text-foreground"
            >
              {view.queued.length}
            </span>
            <span className="text-xs text-muted-foreground">
              {view.queued.length === 1 ? "run waiting" : "runs waiting"}
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">Dispatch order</div>
          <div className="mt-1 text-sm font-medium text-foreground">
            Coordinator → Board → Tasks
          </div>
          <div className="text-xs text-muted-foreground">FIFO within each tier</div>
        </div>
      </div>

      {/* Visual Inference Slots */}
      <section aria-label="Inference slots" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Active Inference Slots
          </h2>
          {view.effectiveLimit !== null ? (
            <span className="text-xs text-muted-foreground">
              Worker limit: {view.effectiveLimit} · Express reserve: +1
            </span>
          ) : null}
        </div>

        {isInitialLoading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {[0, 1].map((idx) => (
              <div
                key={idx}
                className="h-32 rounded-xl border border-border bg-muted/20 motion-safe:animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div
            data-testid="queue-slots-grid"
            className="grid grid-cols-1 gap-3 md:grid-cols-2"
          >
            {view.slots.map((slot) => (
              <SlotCard
                key={slot.key}
                slot={slot}
                showCompanyBadge={showCompanyBadges}
                nowMs={nowMs}
                expanded={slot.item ? isMetaExpanded(`run:${slot.item.id}`) : false}
                onToggleExpand={() => slot.item && toggleMetaExpanded(`run:${slot.item.id}`)}
                cancellingId={cancellingId}
                onCancel={(item) => cancelMutation.mutate(item)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Queued Messages Section */}
      <section aria-label="Queued messages" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Queued Messages ({queuedMessages.length})
          </h2>
          <span className="text-xs text-muted-foreground">
            Pending chat & task messages waiting for steering or delivery
          </span>
        </div>

        {queuedMessages.length === 0 ? (
          <div
            data-testid="queue-messages-empty"
            className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/10 px-4 py-4 text-xs text-muted-foreground"
          >
            <MessageSquareText className="size-4 shrink-0" aria-hidden="true" />
            <span>No pending chat or task messages are waiting in steering queues right now.</span>
          </div>
        ) : (
          <div data-testid="queue-messages-list" className="flex flex-col gap-2.5">
            {queuedMessages.map((msg) => (
              <QueuedMessageCard
                key={msg.commentId}
                msg={msg}
                showCompanyBadge={showCompanyBadges}
                nowMs={nowMs}
                expanded={isMetaExpanded(`msg:${msg.commentId}`)}
                onToggleExpand={() => toggleMetaExpanded(`msg:${msg.commentId}`)}
                busyKey={messageBusyKey}
                onSteer={(target) => steerMessageMutation.mutate(target)}
                onSendNow={(target) => sendNowMessageMutation.mutate(target)}
                onDiscard={(target) => discardMessageMutation.mutate(target)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Pipeline connector */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
        <div className="h-px flex-1 bg-border" />
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-3 py-1 font-medium">
          <ArrowDown className="size-3.5" />
          <span>
            {view.queued.length > 0
              ? `${view.queued.length} queued runs · next free slot picks #1`
              : "Run queue clear"}
          </span>
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Ordered Waiting Run Queue */}
      <section aria-label="Waiting queue" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Waiting Run Queue ({view.queued.length})
          </h2>
          {view.queued.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              Ordered by priority tier, then oldest first
            </span>
          ) : null}
        </div>

        {view.queued.length === 0 ? (
          <div
            data-testid="queue-empty-state"
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/10 px-6 py-10 text-center"
          >
            <CheckCircle2 className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">No runs waiting in queue</p>
            <p className="max-w-md text-xs text-muted-foreground">
              {view.running.length > 0
                ? "Active inference slots are currently executing. Any new tasks will line up here in priority order."
                : "All inference slots are free. New chats and tasks will start immediately."}
            </p>
          </div>
        ) : (
          <div data-testid="queue-waiting-list" className="flex flex-col gap-2">
            {view.queued.map((item) => (
              <QueuedRow
                key={item.id}
                item={item}
                showCompanyBadge={showCompanyBadges}
                nowMs={nowMs}
                expanded={isMetaExpanded(`run:${item.id}`)}
                onToggleExpand={() => toggleMetaExpanded(`run:${item.id}`)}
                cancellingId={cancellingId}
                onCancel={(target) => cancelMutation.mutate(target)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
