// fork 31erGER: redesigned single-agent chat turn presentation.
// Packs wake payloads / run logs into a collapsible dropdown, renders Hermes/Pi-TUI-style
// expandable thinking blocks, and keeps tool actions uncompressed in chronological order.
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Brain,
  ChevronRight,
  CirclePause,
  FilePenLine,
  FilePlus2,
  Gauge,
  Loader2,
  ScrollText,
  ShieldX,
} from "lucide-react";
import type { TranscriptEntry } from "@/adapters";
import { MarkdownBody } from "@/components/MarkdownBody";
import { ANALYTICS_MASK_CLASS } from "@/lib/analytics/privacy";
import { cn } from "@/lib/utils";
import { AutoApprovedBadge, AutoReviewDetail } from "./TaskChatAutoReview";
import { TaskChatDiffCounts, TaskChatDiffView } from "./TaskChatDiffView";
import { TaskChatProtocolCard } from "./TaskChatProtocolCard";
import {
  ResearchSourceStrip,
  TaskChatProtocolActivityDetails,
  WaitCountdown,
  hasTaskChatProtocolActivityDetails,
  verificationOutcome,
  verificationTone,
} from "./TaskChatProtocolActivityRow";
import { TaskChatReasoningSummary } from "./TaskChatReasoningSummary";
import { useTaskChatShimmer, visibleTranscriptPlaceholder } from "./TaskChatShimmer";
import { TaskChatUsageReadout } from "./TaskChatUsageReadout";
import { useTaskChatExpansion } from "./expansion-state";
import { latestReasoningHeadline } from "./reasoning-summary";
import {
  protocolActivityIsRunning,
  protocolActivityLabel,
  protocolActivityPresentation,
} from "./task-chat-activity-presentation";
import type {
  TaskChatActivityPhaseItem,
  TaskChatAutoReview,
  TaskChatDiffLine,
  TaskChatItem,
  TaskChatRuntimeRequestDecision,
  TaskChatRuntimeRequestItem,
  TaskChatThinkingItem,
  TaskChatToolItem,
} from "./task-chat-model";
import { hunkLabel } from "./diff-lines";
import { useTaskReferenceLabel, withTaskReference } from "./task-reference";
import { toolActivityPresentation, type ToolIcon } from "./tool-taxonomy";

interface SingleAgentChatModeValue {
  enabled: boolean;
  rawEntriesByRunId?: ReadonlyMap<string, readonly TranscriptEntry[]>;
}

const SingleAgentChatModeContext = createContext<SingleAgentChatModeValue>({
  enabled: false,
});

export function SingleAgentChatModeProvider({
  enabled,
  rawEntriesByRunId,
  children,
}: {
  enabled: boolean;
  rawEntriesByRunId?: ReadonlyMap<string, readonly TranscriptEntry[]>;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ enabled, rawEntriesByRunId }),
    [enabled, rawEntriesByRunId],
  );
  return (
    <SingleAgentChatModeContext.Provider value={value}>
      {children}
    </SingleAgentChatModeContext.Provider>
  );
}

export function useSingleAgentChatMode(): boolean {
  return useContext(SingleAgentChatModeContext).enabled;
}

export function useSingleAgentRawEntries(runId: string | null | undefined): readonly TranscriptEntry[] {
  const { rawEntriesByRunId } = useContext(SingleAgentChatModeContext);
  if (!runId || !rawEntriesByRunId) return [];
  return rawEntriesByRunId.get(runId) ?? [];
}

/**
 * Detect internal Paperclip wake/resume harness prompts so legacy persisted
 * transcripts (recorded before the Pi parser filtered `role: "user"`) are also
 * folded into the collapsible context log dropdown instead of filling the chat.
 */
export function isWakePayloadText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (
    trimmed.startsWith("## Paperclip Wake Payload") ||
    trimmed.startsWith("## Paperclip Resume Delta") ||
    trimmed.includes("## Paperclip Wake Payload") ||
    trimmed.includes("## Paperclip Resume Delta")
  ) {
    return true;
  }
  if (
    trimmed.includes("Paperclip may post a short platform-generated fast-response receipt") ||
    (trimmed.includes("Chat mode directive:") && trimmed.includes("Paperclip")) ||
    (trimmed.startsWith("You are agent ") && trimmed.includes("Continue your Paperclip work."))
  ) {
    return true;
  }
  return false;
}

export interface SingleAgentLogEntry {
  id: string;
  label: string;
  text: string;
  ts?: string;
}

export function extractWakeLogEntries(
  rawEntries: readonly TranscriptEntry[],
  legacyWakeTexts: readonly string[] = [],
): SingleAgentLogEntry[] {
  const result: SingleAgentLogEntry[] = [];
  const seenTexts = new Set<string>();

  rawEntries.forEach((entry, index) => {
    if (entry.kind === "user") {
      const text = entry.text.trim();
      if (!text || seenTexts.has(text)) return;
      seenTexts.add(text);
      result.push({
        id: `raw-user-${index}`,
        label: isWakePayloadText(text) ? "Wake payload" : "Prompt",
        text,
        ts: entry.ts,
      });
    } else if (entry.kind === "system") {
      const text = entry.text.trim();
      if (!text || seenTexts.has(text)) return;
      seenTexts.add(text);
      result.push({
        id: `raw-system-${index}`,
        label: "System",
        text,
        ts: entry.ts,
      });
    } else if (entry.kind === "init") {
      const parts = [
        entry.model ? `model=${entry.model}` : null,
        entry.sessionId ? `session=${entry.sessionId}` : null,
      ].filter(Boolean);
      const text = parts.length > 0 ? `Session initialized (${parts.join(", ")})` : "Session initialized";
      if (seenTexts.has(text)) return;
      seenTexts.add(text);
      result.push({
        id: `raw-init-${index}`,
        label: "Init",
        text,
        ts: entry.ts,
      });
    }
  });

  legacyWakeTexts.forEach((rawText, index) => {
    const text = rawText.trim();
    if (!text || seenTexts.has(text)) return;
    seenTexts.add(text);
    result.push({
      id: `legacy-wake-${index}`,
      label: "Wake payload",
      text,
    });
  });

  return result;
}

function summarizeLogEntries(entries: readonly SingleAgentLogEntry[]): string {
  const promptCount = entries.filter(
    (entry) => entry.label === "Wake payload" || entry.label === "Prompt",
  ).length;
  const logCount = entries.length - promptCount;
  const parts: string[] = [];
  if (promptCount > 0) {
    parts.push(`${promptCount} ${promptCount === 1 ? "prompt" : "prompts"}`);
  }
  if (logCount > 0) {
    parts.push(`${logCount} ${logCount === 1 ? "log" : "logs"}`);
  }
  return parts.join(" · ") || `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;
}

export function WakeContextDropdown({
  id,
  entries,
}: {
  id: string;
  entries: readonly SingleAgentLogEntry[];
}) {
  const [open, setOpen] = useTaskChatExpansion(`single-agent-log:${id}`, false);
  const panelId = useId();
  if (entries.length === 0) return null;

  const hasWake = entries.some((entry) => entry.label === "Wake payload");
  const title = hasWake ? "Run context & log" : "Run log";
  const summary = summarizeLogEntries(entries);

  return (
    <div
      className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-muted/20"
      data-testid="single-agent-log-dropdown"
      data-open={open ? "true" : "false"}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-testid="single-agent-log-dropdown-toggle"
        className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ScrollText className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="font-medium text-foreground/85">{title}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground/80">
          {summary}
        </span>
        <ChevronRight
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div
          id={panelId}
          data-testid="single-agent-log-dropdown-body"
          className="max-h-72 overflow-y-auto border-t border-border/70 bg-background/50 p-3"
        >
          <ul className="flex min-w-0 flex-col gap-3">
            {entries.map((entry) => (
              <li key={entry.id} className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-2 text-(length:--text-micro) text-muted-foreground">
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 font-medium text-foreground/80">
                    {entry.label}
                  </span>
                </div>
                <pre
                  className={cn(
                    "whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground",
                    ANALYTICS_MASK_CLASS,
                  )}
                >
                  {entry.text}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function countThinkingStats(body: string): { lines: number; words: number } {
  const nonEmptyLines = body.split("\n").filter((line) => line.trim().length > 0);
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  return { lines: nonEmptyLines.length, words };
}

function formatThinkingMeta(stats: { lines: number; words: number }): string | null {
  if (stats.words === 0) return null;
  if (stats.lines > 1) {
    return `${stats.lines} lines · ${stats.words} words`;
  }
  return `${stats.words} ${stats.words === 1 ? "word" : "words"}`;
}

function collapsedThinkingPreview(body: string, active: boolean): string {
  const nonEmptyLines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (nonEmptyLines.length === 0) return "";
  if (active) {
    // Pi TUI / Hermes style: show the last few active lines while streaming so
    // the user can read the live reasoning tail even when collapsed.
    return nonEmptyLines.slice(-3).join("\n");
  }
  const headline = latestReasoningHeadline(body);
  if (headline) return headline;
  return nonEmptyLines.slice(0, 2).join(" ");
}

/**
 * Hermes / Pi TUI-style expandable thinking block.
 * Collapsible both while streaming and after settling, with a readable multi-line
 * tail preview while active and a bounded auto-scrolling reasoning drawer when open.
 */
export function SingleAgentThinkingBlock({
  item,
  active = Boolean(item.streaming),
  defaultOpen = false,
}: {
  item: TaskChatThinkingItem;
  active?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useTaskChatExpansion(`single-agent-thinking:${item.id}`, defaultOpen);
  const shimmer = useTaskChatShimmer(item.id);
  const bodyId = useId();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const body = item.lines.join("\n").trim();
  const stats = useMemo(() => countThinkingStats(body), [body]);
  const meta = formatThinkingMeta(stats);
  const preview = useMemo(() => collapsedThinkingPreview(body, active), [body, active]);

  const title = active
    ? "Thinking…"
    : item.summaryLabel ?? "Thought";

  useEffect(() => {
    if (!open || !active || !stickToBottomRef.current) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [open, active, body]);

  if (!body) {
    return (
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-lg border border-border/80 border-l-2 bg-muted/25 px-3 py-2 text-xs text-muted-foreground",
          active ? "border-l-(--status-agent-running)" : "border-l-border",
        )}
        data-testid="single-agent-thinking-block"
        data-state={active ? "streaming" : "settled"}
      >
        <Brain
          className={cn(
            "size-3.5 shrink-0",
            active ? "text-(--status-agent-running)" : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
        <span className={cn("font-medium", active && shimmer && "shimmer-text shimmer-text-muted")}>
          {title}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-w-0 max-w-full flex-col overflow-hidden rounded-lg border border-border/80 border-l-2 bg-muted/25",
        active ? "border-l-(--status-agent-running)" : "border-l-border",
      )}
      data-testid="single-agent-thinking-block"
      data-state={active ? "streaming" : "settled"}
      data-open={open ? "true" : "false"}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        data-testid="single-agent-thinking-toggle"
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Brain
          className={cn(
            "size-3.5 shrink-0",
            active ? "text-(--status-agent-running)" : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            "shrink-0 font-medium text-foreground/90",
            active && shimmer && "shimmer-text",
          )}
        >
          {title}
        </span>
        {meta ? (
          <span className="truncate text-(length:--text-micro) text-muted-foreground/80">
            {meta}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1 text-(length:--text-micro) text-muted-foreground">
          <span>{open ? "Hide" : "Expand"}</span>
          <ChevronRight
            className={cn("size-3.5 transition-transform", open && "rotate-90")}
            aria-hidden="true"
          />
        </span>
      </button>

      {!open && preview ? (
        <div
          data-testid="single-agent-thinking-preview"
          className={cn(
            "border-t border-border/50 bg-muted/15 px-3 py-1.5 text-xs leading-relaxed text-muted-foreground/90",
            active ? "line-clamp-3 whitespace-pre-wrap" : "line-clamp-2",
          )}
        >
          {preview}
        </div>
      ) : null}

      {open ? (
        <div
          id={bodyId}
          ref={scrollRef}
          data-testid="single-agent-thinking-body"
          onScroll={(event) => {
            const el = event.currentTarget;
            const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            stickToBottomRef.current = distanceFromBottom < 24;
          }}
          className="max-h-96 overflow-y-auto border-t border-border/60 bg-background/50 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground"
        >
          <TaskChatReasoningSummary text={body} streaming={active} />
        </div>
      ) : null}
    </div>
  );
}

type PhaseActivity = TaskChatActivityPhaseItem["items"][number];

const SUBJECT_FAMILIES = new Set(["terminal", "read", "edit", "grep", "search", "web"]);

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 10_000) return `${(ms / 1_000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

interface ActionRowModel {
  icon: ToolIcon;
  label: string;
  target?: string;
  mono: boolean;
  running: boolean;
  failed: boolean;
  iconClassName?: string;
  trailing?: ReactNode;
  note?: string;
  exitCode?: number | null;
  durationMs?: number | null;
  blocked?: string;
}

function actionRowModel(
  item: Exclude<PhaseActivity, { kind: "thinking" }>,
  active: boolean,
  taskLabel?: string,
): ActionRowModel | null {
  if (item.kind === "tool") {
    const tool = toolActivityPresentation({
      name: item.rawName ?? item.name,
      target: item.target,
    });
    const running = active && (item.status === "pending" || item.status === "in_progress");
    const failed = item.status === "failed" || Boolean(item.blockedReason);
    const label =
      item.status === "failed"
        ? tool.failedLabel
        : item.status === "interrupted"
          ? tool.interruptedLabel
          : running
            ? tool.runningLabel
            : tool.completedLabel;
    const terminal = tool.family === "terminal";
    const subject = withTaskReference(item.target?.trim() || undefined, taskLabel);
    const marker =
      item.status === "failed" || item.status === "interrupted"
        ? label.split(" · ").at(1)
        : undefined;
    const verb =
      subject && SUBJECT_FAMILIES.has(tool.family)
        ? `${label.split(" ")[0]!}${marker ? ` · ${marker}` : ""}`
        : label;
    const exitCode = item.exitCode ?? null;
    const shownExit = exitCode === 0 && !terminal ? null : exitCode;
    if (item.blockedReason) {
      return {
        icon: ShieldX,
        label: "Blocked",
        target: subject ? (terminal ? `$ ${subject}` : subject) : undefined,
        mono: true,
        running: false,
        failed: true,
        blocked: item.blockedReason,
      };
    }
    return {
      icon: tool.icon,
      label: verb,
      target: subject ? (terminal ? `$ ${subject}` : subject) : undefined,
      mono: true,
      running,
      failed,
      exitCode: running ? null : shownExit,
      durationMs: running || !item.durationMs ? null : item.durationMs,
    };
  }

  if (item.kind === "protocol") {
    const protocol = protocolActivityPresentation(item);
    if (!protocol) return null;
    const isProvider = item.surface === "provider_activity";
    const iconClassName =
      isProvider && item.family === "verification"
        ? verificationTone(item)
        : protocol.tone === "blocked" || protocol.tone === "failed"
          ? "text-destructive"
          : undefined;
    const trailing =
      isProvider && item.family === "verification"
        ? verificationOutcome(item)
        : isProvider && item.family === "wait" && item.status === "running"
          ? <WaitCountdown item={item} />
          : undefined;
    return {
      icon: protocol.icon,
      label: protocolActivityLabel(item, protocol),
      target: protocol.detail,
      mono: true,
      running: active && protocolActivityIsRunning(item),
      failed: protocol.tone === "blocked" || protocol.tone === "failed",
      iconClassName,
      trailing,
      note: protocol.note,
    };
  }

  if (item.kind === "marker") {
    return {
      icon: CirclePause,
      label: item.label,
      target: item.detail,
      mono: false,
      running: false,
      failed: item.tone === "error",
    };
  }

  const { used, size, inputTokens, outputTokens, costUsd } = item.usage;
  const usage = [
    size > 0 ? `${used.toLocaleString()}/${size.toLocaleString()} ctx` : undefined,
    inputTokens != null || outputTokens != null
      ? `↑${(inputTokens ?? 0).toLocaleString()} ↓${(outputTokens ?? 0).toLocaleString()}`
      : undefined,
    costUsd != null ? `$${costUsd.toFixed(4)}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    icon: Gauge,
    label: item.label ?? "Token usage",
    target: usage || item.detail,
    mono: false,
    running: false,
    failed: false,
  };
}

function actionAutoReview(
  item: Exclude<PhaseActivity, { kind: "thinking" }>,
): TaskChatAutoReview | undefined {
  if (item.kind === "tool") return item.autoReview;
  if (item.kind === "protocol" && item.surface === "provider_activity") return item.autoReview;
  return undefined;
}

function hasActionDetails(item: Exclude<PhaseActivity, { kind: "thinking" }>): boolean {
  if (actionAutoReview(item)) return true;
  if (item.kind === "protocol") return hasTaskChatProtocolActivityDetails(item);
  if (item.kind === "tool") {
    return Boolean(
      item.target?.trim() ||
        item.detail?.trim() ||
        item.diff ||
        item.decision ||
        item.blockedReason ||
        item.description,
    );
  }
  if (item.kind === "marker") return Boolean(item.detail?.trim());
  return Boolean(
    item.detail ||
      item.usage.size > 0 ||
      item.usage.inputTokens != null ||
      item.usage.outputTokens != null ||
      item.usage.costUsd != null,
  );
}

function ActionDetailBody({ item }: { item: Exclude<PhaseActivity, { kind: "thinking" }> }) {
  const autoReview = item.kind === "tool" ? item.autoReview : undefined;
  return (
    <>
      {item.kind === "usage" ? (
        <TaskChatUsageReadout item={item} />
      ) : item.kind === "protocol" ? (
        <TaskChatProtocolActivityDetails item={item} neutral />
      ) : item.kind === "marker" ? (
        <p className="whitespace-pre-wrap break-words">{item.detail ?? item.label}</p>
      ) : item.diff?.lines?.length ? (
        <TaskChatDiffView lines={item.diff.lines} truncated={item.diff.truncated} />
      ) : (
        <>
          {item.description ? <p className="text-foreground/85">{item.description}</p> : null}
          {item.target ? <p className="break-all font-mono text-foreground/80">{item.target}</p> : null}
          {item.blockedReason ? (
            <p className="text-destructive">Blocked: {item.blockedReason}</p>
          ) : null}
          {item.detail ? (
            <pre
              className={cn(
                "whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground",
                ANALYTICS_MASK_CLASS,
              )}
            >
              {item.detail}
            </pre>
          ) : null}
          {item.decision ? <p>Permission {item.decision}</p> : null}
          {item.diff ? (
            <p className="break-all font-mono">
              {item.diff.path} · +{item.diff.added} −{item.diff.removed}
            </p>
          ) : null}
        </>
      )}
      {autoReview ? <AutoReviewDetail review={autoReview} /> : null}
    </>
  );
}

function SingleAgentActionRowInner({
  item,
  active,
  taskLabel,
}: {
  item: Exclude<PhaseActivity, { kind: "thinking" }>;
  active: boolean;
  taskLabel?: string;
}) {
  const [open, setOpen] = useTaskChatExpansion(`single-agent-action:${item.id}`, false);
  const detailId = useId();
  const row = actionRowModel(item, active, taskLabel);
  if (!row) return null;

  const expandable = hasActionDetails(item);
  const Icon = row.icon;
  const autoReview = actionAutoReview(item);

  const headerContent = (
    <span className="flex min-w-0 flex-1 items-start gap-2">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {row.running ? (
          <Loader2
            className="size-3.5 animate-spin text-(--status-agent-running)"
            aria-hidden="true"
          />
        ) : (
          <Icon
            className={cn(
              "size-3.5",
              row.iconClassName,
              row.failed && "text-destructive",
            )}
            aria-hidden="true"
          />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {row.label ? (
            <span
              className={cn(
                "shrink-0 text-xs font-medium",
                row.running ? "text-foreground" : "text-foreground/85",
                row.failed && "text-destructive",
              )}
            >
              {row.label}
            </span>
          ) : null}
          {row.target ? (
            <span
              title={row.target}
              className={cn(
                "line-clamp-2 min-w-0 break-all text-xs text-muted-foreground",
                row.mono && "font-mono",
              )}
            >
              {row.target}
            </span>
          ) : null}
          {row.blocked ? (
            <span className="min-w-0 break-words text-xs text-destructive">
              {row.blocked}
            </span>
          ) : null}
          {row.trailing ? (
            <span className="min-w-0 text-xs text-muted-foreground">{row.trailing}</span>
          ) : null}
        </span>
        {item.kind === "tool" && item.description && item.description !== item.target ? (
          <span className="line-clamp-1 text-(length:--text-micro) text-muted-foreground/80">
            {item.description}
          </span>
        ) : null}
      </span>
      <span className="mt-0.5 flex shrink-0 items-center gap-1.5 text-(length:--text-micro) tabular-nums">
        {item.kind === "tool" && item.diff && (item.diff.added > 0 || item.diff.removed > 0) ? (
          <TaskChatDiffCounts
            added={item.diff.added}
            removed={item.diff.removed}
            className="text-xs"
          />
        ) : null}
        {row.exitCode != null ? (
          <span
            className={cn(
              "rounded-sm px-1 font-mono leading-4",
              row.exitCode === 0
                ? "bg-muted text-muted-foreground"
                : "bg-destructive/10 text-destructive",
            )}
          >
            exit {row.exitCode}
          </span>
        ) : null}
        {row.durationMs != null ? (
          <span className="text-muted-foreground">{formatDuration(row.durationMs)}</span>
        ) : null}
        {autoReview ? <AutoApprovedBadge review={autoReview} /> : null}
        {expandable ? (
          <ChevronRight
            className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")}
            aria-hidden="true"
          />
        ) : null}
      </span>
    </span>
  );

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-md border bg-background/40",
        row.running
          ? "border-(--status-agent-running)/40"
          : row.failed
            ? "border-destructive/40"
            : "border-border/60",
      )}
      data-testid="single-agent-action-row"
      data-action-id={item.id}
      data-open={open ? "true" : "false"}
    >
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={open ? detailId : undefined}
          className="flex w-full min-w-0 items-start gap-2 px-2.5 py-1.5 text-left text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {headerContent}
        </button>
      ) : (
        <div className="flex w-full min-w-0 items-start gap-2 px-2.5 py-1.5 text-muted-foreground">
          {headerContent}
        </div>
      )}
      {row.note ? (
        <p className="px-2.5 pb-1.5 pl-8 text-xs text-muted-foreground">{row.note}</p>
      ) : null}
      {!open &&
      item.kind === "protocol" &&
      item.surface === "provider_activity" &&
      item.family === "research" &&
      item.status !== "running" ? (
        <div className="px-2.5 pb-1.5">
          <ResearchSourceStrip item={item} />
        </div>
      ) : null}
      {expandable && open ? (
        <div
          id={detailId}
          data-testid="single-agent-action-detail"
          className="flex max-h-80 min-w-0 flex-col gap-2 overflow-y-auto border-t border-border/60 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground"
        >
          <ActionDetailBody item={item} />
        </div>
      ) : null}
    </div>
  );
}

function SingleAgentActionRowWithTaskRef({
  item,
  taskRefId,
  active,
}: {
  item: Extract<PhaseActivity, { kind: "tool" }>;
  taskRefId: string;
  active: boolean;
}) {
  const taskLabel = useTaskReferenceLabel(taskRefId);
  return <SingleAgentActionRowInner item={item} active={active} taskLabel={taskLabel} />;
}

const FILE_EDIT_TOOL_NAMES = new Set([
  "edit",
  "write",
  "edit_file",
  "write_file",
  "create_file",
  "str_replace",
  "str_replace_editor",
  "apply_patch",
  "patch",
  "multi_edit",
  "multiedit",
  "notebookedit",
  "notebook_edit",
  "replace_file_content",
]);

const FILE_WRITE_TOOL_NAMES = new Set(["write", "write_file", "create_file"]);

const DIFF_ABSTRACT_MAX_LINES = 6;

const DIFF_LINE_MARKER: Record<TaskChatDiffLine["kind"], string> = {
  add: "+",
  remove: "−",
  context: " ",
  hunk: "",
  file: "",
};

export function isFileEditTool(item: TaskChatToolItem): boolean {
  if (item.diff) return true;
  const raw = (item.rawName ?? item.name).trim().toLowerCase();
  return FILE_EDIT_TOOL_NAMES.has(raw);
}

/**
 * Pick a short Claude Code / Pi TUI-style inline diff abstract starting around
 * the first changed line (with 1 line of leading context when available).
 */
export function buildDiffAbstract(
  lines: readonly TaskChatDiffLine[],
  maxLines = DIFF_ABSTRACT_MAX_LINES,
): {
  preview: TaskChatDiffLine[];
  hiddenCount: number;
  totalLines: number;
} {
  const displayable = lines.filter((line) => line.kind !== "file");
  if (displayable.length === 0) {
    return { preview: [], hiddenCount: 0, totalLines: 0 };
  }
  const firstChangeIdx = displayable.findIndex(
    (line) => line.kind === "add" || line.kind === "remove",
  );
  let start = 0;
  if (firstChangeIdx > 0) {
    const prev = displayable[firstChangeIdx - 1];
    start = prev && prev.kind === "context" ? firstChangeIdx - 1 : firstChangeIdx;
  }
  const preview = displayable.slice(start, start + maxLines);
  const hiddenCount = Math.max(0, displayable.length - preview.length);
  return { preview, hiddenCount, totalLines: displayable.length };
}

/**
 * Claude Code / Pi TUI-style clickable file edit card.
 * Shows the file path, +N −M stat badge, and a short tinted diff abstract
 * immediately in the stream; clicking the header or the abstract unfolds the
 * full scrollable diff.
 */
export function SingleAgentFileEditCard({
  item,
  active,
}: {
  item: TaskChatToolItem;
  active: boolean;
}) {
  const [open, setOpen] = useTaskChatExpansion(`single-agent-edit:${item.id}`, false);
  const bodyId = useId();
  const normalizedName = (item.rawName ?? item.name).trim().toLowerCase();
  const isWrite = FILE_WRITE_TOOL_NAMES.has(normalizedName);
  const running = active && (item.status === "pending" || item.status === "in_progress");
  const failed = item.status === "failed" || Boolean(item.blockedReason);
  const filePath = item.diff?.path?.trim() || item.target?.trim() || "";
  const diffLines = item.diff?.lines ?? [];
  const abstract = useMemo(() => buildDiffAbstract(diffLines), [diffLines]);

  const hasDiffLines = abstract.totalLines > 0;
  const hasMoreLines = abstract.hiddenCount > 0 || Boolean(item.diff?.truncated);
  const hasFallbackDetail = Boolean(
    item.detail?.trim() || item.blockedReason || item.autoReview || item.description,
  );
  const expandable = hasDiffLines || hasFallbackDetail;

  const actionVerb = item.blockedReason
    ? "Blocked"
    : failed
      ? isWrite
        ? "Write failed"
        : "Edit failed"
      : running
        ? isWrite
          ? "Writing"
          : "Editing"
        : isWrite
          ? "Wrote"
          : "Edited";

  const Icon = item.blockedReason ? ShieldX : isWrite ? FilePlus2 : FilePenLine;

  const headerContent = (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="flex size-4 shrink-0 items-center justify-center">
        {running ? (
          <Loader2
            className="size-3.5 animate-spin text-(--status-agent-running)"
            aria-hidden="true"
          />
        ) : (
          <Icon
            className={cn("size-3.5", failed ? "text-destructive" : "text-muted-foreground")}
            aria-hidden="true"
          />
        )}
      </span>
      <span
        className={cn(
          "shrink-0 text-xs font-medium",
          running ? "text-foreground" : "text-foreground/90",
          failed && "text-destructive",
        )}
      >
        {actionVerb}
      </span>
      {filePath ? (
        <span
          title={filePath}
          className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/85"
        >
          {filePath}
        </span>
      ) : (
        <span className="min-w-0 flex-1" />
      )}
      <span className="flex shrink-0 items-center gap-2 text-(length:--text-micro) tabular-nums">
        {item.diff && (item.diff.added > 0 || item.diff.removed > 0) ? (
          <TaskChatDiffCounts
            added={item.diff.added}
            removed={item.diff.removed}
            className="text-xs"
          />
        ) : null}
        {!running && item.durationMs ? (
          <span className="text-muted-foreground">{formatDuration(item.durationMs)}</span>
        ) : null}
        {item.autoReview ? <AutoApprovedBadge review={item.autoReview} /> : null}
        {expandable ? (
          <span className="flex items-center gap-0.5 text-muted-foreground">
            {open || hasMoreLines ? (
              <span>{open ? "Collapse" : "Expand"}</span>
            ) : null}
            <ChevronRight
              className={cn("size-3.5 transition-transform", open && "rotate-90")}
              aria-hidden="true"
            />
          </span>
        ) : null}
      </span>
    </span>
  );

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-lg border bg-muted/20",
        running
          ? "border-(--status-agent-running)/40"
          : failed
            ? "border-destructive/40"
            : "border-border/80",
      )}
      data-testid="single-agent-file-edit"
      data-action-id={item.id}
      data-open={open ? "true" : "false"}
    >
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          data-testid="single-agent-file-edit-toggle"
          className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {headerContent}
        </button>
      ) : (
        <div className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-muted-foreground">
          {headerContent}
        </div>
      )}

      {/* Collapsed inline diff abstract — clickable to unfold, like Pi TUI / Claude Code */}
      {!open && hasDiffLines ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="single-agent-file-edit-abstract"
          aria-label={`Expand diff for ${filePath || "file edit"}`}
          className="block w-full cursor-pointer border-t border-border/60 bg-background/50 text-left transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse font-mono text-(length:--text-micro) leading-relaxed">
              <tbody>
                {abstract.preview.map((line, index) =>
                  line.kind === "hunk" ? (
                    <tr key={index} className="bg-muted/50 text-muted-foreground">
                      <td colSpan={2} className="whitespace-pre px-2.5 py-0.5">
                        {hunkLabel(line.text)}
                      </td>
                    </tr>
                  ) : (
                    <tr
                      key={index}
                      className={cn(
                        line.kind === "add" && "bg-(--diff-add-bg)",
                        line.kind === "remove" && "bg-(--diff-remove-bg)",
                      )}
                    >
                      <td
                        aria-hidden="true"
                        className={cn(
                          "w-4 select-none pl-2.5 align-top",
                          line.kind === "add" && "text-(--diff-add-fg)",
                          line.kind === "remove" && "text-(--diff-remove-fg)",
                          line.kind === "context" && "text-muted-foreground",
                        )}
                      >
                        {DIFF_LINE_MARKER[line.kind]}
                      </td>
                      <td
                        className={cn(
                          "whitespace-pre pr-3 align-top",
                          line.kind === "context" ? "text-muted-foreground" : "text-foreground",
                        )}
                      >
                        {line.text || " "}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          {hasMoreLines ? (
            <div
              data-testid="single-agent-file-edit-more"
              className="border-t border-border/50 bg-muted/30 px-3 py-1 text-(length:--text-micro) text-muted-foreground"
            >
              {abstract.hiddenCount > 0
                ? `… ${abstract.hiddenCount} more ${abstract.hiddenCount === 1 ? "line" : "lines"} · Click to unfold`
                : "Click to unfold full diff"}
            </div>
          ) : null}
        </button>
      ) : null}

      {/* Expanded full diff or detail drawer */}
      {open && expandable ? (
        <div
          id={bodyId}
          data-testid="single-agent-file-edit-full"
          className="border-t border-border/60 bg-background/60"
        >
          {hasDiffLines ? (
            <TaskChatDiffView
              lines={diffLines}
              truncated={item.diff?.truncated}
              previewLines={Number.MAX_SAFE_INTEGER}
              className="rounded-none border-0 bg-transparent"
            />
          ) : (
            <div className="flex max-h-80 min-w-0 flex-col gap-2 overflow-y-auto p-3 text-xs leading-relaxed text-muted-foreground">
              {item.description ? <p className="text-foreground/85">{item.description}</p> : null}
              {item.blockedReason ? (
                <p className="text-destructive">Blocked: {item.blockedReason}</p>
              ) : null}
              {item.detail ? (
                <pre
                  className={cn(
                    "whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground",
                    ANALYTICS_MASK_CLASS,
                  )}
                >
                  {item.detail}
                </pre>
              ) : null}
            </div>
          )}
          {item.autoReview ? (
            <div className="border-t border-border/50 px-3 py-2 text-xs text-muted-foreground">
              <AutoReviewDetail review={item.autoReview} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SingleAgentActionRow({
  item,
  active,
}: {
  item: Exclude<PhaseActivity, { kind: "thinking" }>;
  active: boolean;
}) {
  if (item.kind === "tool" && isFileEditTool(item)) {
    return <SingleAgentFileEditCard item={item} active={active} />;
  }
  if (item.kind === "tool" && item.taskRefId) {
    return (
      <SingleAgentActionRowWithTaskRef
        item={item}
        taskRefId={item.taskRefId}
        active={active}
      />
    );
  }
  return <SingleAgentActionRowInner item={item} active={active} />;
}

function extractRunIdFromPhaseId(phaseId: string): string | null {
  const idx = phaseId.indexOf(":");
  if (idx <= 0) return null;
  return phaseId.slice(0, idx);
}

/**
 * Uncompressed chronological rendering of a TaskChatActivityPhaseItem for
 * single-agent chat (used by both settled turns and native runner phases).
 */
export function SingleAgentActivityPhaseView({
  item,
}: {
  item: TaskChatActivityPhaseItem;
}) {
  const runId = extractRunIdFromPhaseId(item.id);
  const rawEntries = useSingleAgentRawEntries(runId);
  const isOpeningPhase = item.id.endsWith(":phase:opening");
  const interstitialIsWake = Boolean(
    item.interstitial && isWakePayloadText(item.interstitial.text),
  );

  const logEntries = useMemo(() => {
    const legacyTexts =
      interstitialIsWake && item.interstitial ? [item.interstitial.text] : [];
    return extractWakeLogEntries(isOpeningPhase ? rawEntries : [], legacyTexts);
  }, [isOpeningPhase, rawEntries, interstitialIsWake, item.interstitial]);

  return (
    <section
      className="flex min-w-0 flex-col gap-2"
      data-testid="single-agent-activity-phase"
      data-activity-group={item.id}
    >
      {logEntries.length > 0 ? (
        <WakeContextDropdown id={item.id} entries={logEntries} />
      ) : null}

      {item.interstitial && !interstitialIsWake && item.interstitial.text.trim() ? (
        <div
          className="min-w-0 px-1 text-sm text-foreground/90"
          data-testid="task-chat-phase-interstitial"
          data-conversation-text={item.interstitial.channel === "final" ? "final" : "progress"}
        >
          <MarkdownBody softBreaks linkIssueReferences>
            {item.interstitial.text}
          </MarkdownBody>
        </div>
      ) : null}

      {item.items.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-2" data-testid="single-agent-action-list">
          {item.items.map((activity, index) => {
            const isActiveRow = item.active && index === item.items.length - 1;
            if (activity.kind === "thinking") {
              return (
                <SingleAgentThinkingBlock
                  key={activity.id}
                  item={activity}
                  active={item.active && Boolean(activity.streaming)}
                />
              );
            }
            return (
              <SingleAgentActionRow
                key={activity.id}
                item={activity}
                active={isActiveRow}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Live turn view for single-agent chat (replaces the rolling 1-line TaskChatLiveTail).
 * Keeps wake payloads / run logs collapsed inside WakeContextDropdown, shows
 * expandable thinking blocks, and lists every tool action uncompressed.
 */
export function SingleAgentLiveTurn({
  runId,
  items,
  rawEntries,
  emptyMessage,
  excludeFinal = false,
  onRuntimeRequestDecision,
}: {
  runId?: string | null;
  items: readonly TaskChatItem[];
  rawEntries: readonly TranscriptEntry[];
  emptyMessage?: string;
  excludeFinal?: boolean;
  onRuntimeRequestDecision?: (
    item: TaskChatRuntimeRequestItem,
    decision: TaskChatRuntimeRequestDecision,
  ) => void | Promise<void>;
}) {
  const { legacyWakeTexts, visibleItems } = useMemo(() => {
    const wakes: string[] = [];
    const rest: TaskChatItem[] = [];
    for (const item of items) {
      if (item.kind === "message" && isWakePayloadText(item.text)) {
        wakes.push(item.text);
        continue;
      }
      if (excludeFinal && item.kind === "message" && !item.interstitial) {
        continue;
      }
      rest.push(item);
    }
    return { legacyWakeTexts: wakes, visibleItems: rest };
  }, [items, excludeFinal]);

  const logEntries = useMemo(
    () => extractWakeLogEntries(rawEntries, legacyWakeTexts),
    [rawEntries, legacyWakeTexts],
  );

  const renderedRows = visibleItems
    .map((item): ReactElement | null => {
      switch (item.kind) {
        case "thinking":
          return (
            <SingleAgentThinkingBlock
              key={item.id}
              item={item}
              active={Boolean(item.streaming)}
            />
          );
        case "tool":
          return (
            <SingleAgentActionRow
              key={item.id}
              item={item}
              active={item.status === "pending" || item.status === "in_progress"}
            />
          );
        case "message": {
          const text = item.text.trim();
          if (!text) return null;
          return (
            <div
              key={item.id}
              className="px-1 text-sm text-foreground/90"
              data-testid="task-chat-live-text"
              data-conversation-text={item.channel === "final" ? "final" : "progress"}
            >
              <MarkdownBody softBreaks linkIssueReferences>
                {item.text}
              </MarkdownBody>
            </div>
          );
        }
        case "usage":
          return (
            <div key={item.id}>
              <TaskChatUsageReadout item={item} />
            </div>
          );
        case "activity_phase":
          return <SingleAgentActivityPhaseView key={item.id} item={item} />;
        case "protocol":
          if (item.surface === "provider_activity") {
            return (
              <SingleAgentActionRow
                key={item.id}
                item={item}
                active={protocolActivityIsRunning(item)}
              />
            );
          }
          return (
            <TaskChatProtocolCard
              key={item.id}
              item={item}
              onRuntimeRequestDecision={onRuntimeRequestDecision}
            />
          );
        default:
          return null;
      }
    })
    .filter((row): row is ReactElement => row != null);

  if (logEntries.length === 0 && renderedRows.length === 0) {
    const placeholder = visibleTranscriptPlaceholder(emptyMessage);
    return placeholder ? (
      <div className="px-1 py-1 text-xs text-muted-foreground/70">{placeholder}</div>
    ) : null;
  }

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="single-agent-live-turn">
      {logEntries.length > 0 ? (
        <WakeContextDropdown id={runId ?? "live"} entries={logEntries} />
      ) : null}
      {renderedRows}
      {renderedRows.length === 0 && logEntries.length > 0 ? (
        <div className="px-1 py-0.5 text-xs text-muted-foreground/75">
          {visibleTranscriptPlaceholder(emptyMessage) ?? "Thinking…"}
        </div>
      ) : null}
    </div>
  );
}
