// fork 31erGER: pure view-model builder for the visual cross-company Run Queue page
// (active inference slots, queued messages, ordered waiting runs, and full metadata).
import type {
  Agent,
  Company,
  HeartbeatRun,
  Issue,
  IssueComment,
  IssueQueuedCommentQueue,
} from "@paperclipai/shared";
import type { LiveRunForIssue } from "@/api/heartbeats";
import { isWaitingToStart } from "@/lib/agent-queue-wait";
import { agentRouteRef } from "@/lib/utils";

export const EXPRESS_STEERING_EXTRA_SLOTS = 1;

export type QueuePriorityTier = 1 | 2 | 3;

export interface QueuePriorityMeta {
  tier: QueuePriorityTier;
  label: string;
  shortLabel: string;
  expressEligible: boolean;
}

export const QUEUE_PRIORITY_META: Record<QueuePriorityTier, QueuePriorityMeta> = {
  1: {
    tier: 1,
    label: "Coordinator · Express",
    shortLabel: "Express",
    expressEligible: true,
  },
  2: {
    tier: 2,
    label: "Board message",
    shortLabel: "Board",
    expressEligible: false,
  },
  3: {
    tier: 3,
    label: "Background task",
    shortLabel: "Background",
    expressEligible: false,
  },
};

export interface QueueRunItem {
  id: string;
  companyId: string;
  companyName: string;
  companyPrefix: string;
  status: "running" | "queued";
  agentId: string;
  agentName: string;
  agent: Agent | null;
  issueId: string | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  location: "chat" | "task" | "run";
  href: string;
  priorityTier: QueuePriorityTier;
  priorityMeta: QueuePriorityMeta;
  invocationSource: string;
  triggerDetail: string | null;
  wakeupRequestId: string | null;
  runtimeMode: "legacy" | "native" | null;
  livenessState: LiveRunForIssue["livenessState"] | null;
  livenessReason: string | null;
  continuationAttempt: number;
  logBytes: number | null;
  createdAt: string;
  startedAt: string | null;
  lastEventAt: string | null;
  currentToolName: string | null;
  currentStatusMessage: string | null;
  adapterType: string;
  contextCommentId: string | null;
  contextWakeCommentId: string | null;
  triggerMessageBody: string | null;
  triggerMessageCreatedAt: string | null;
  execution: HeartbeatRun["execution"] | null;
  /** 1-based dispatch position for queued items; null for running items. */
  queuePosition: number | null;
}

export interface QueuedMessageItem {
  commentId: string;
  issueId: string;
  companyId: string;
  companyName: string;
  companyPrefix: string;
  location: "chat" | "task";
  targetLabel: string;
  agentName: string | null;
  agent: Agent | null;
  href: string;
  body: string;
  createdAt: string;
  position: number;
  authorLabel: string;
  queueId: string;
  revision: string;
  queueState: IssueQueuedCommentQueue["state"];
  targetRunId: string | null;
  protocol: IssueQueuedCommentQueue["protocol"];
  steeringDisposition: IssueQueuedCommentQueue["steeringDisposition"];
  executionWait: IssueQueuedCommentQueue["executionWait"];
  interactionSummary: string | null;
  canEdit: boolean;
  canDiscard: boolean;
}

export interface VisualQueueSlot {
  key: string;
  label: string;
  kind: "worker" | "express";
  item: QueueRunItem | null;
}

export interface RunQueueViewModel {
  running: QueueRunItem[];
  queued: QueueRunItem[];
  slots: VisualQueueSlot[];
  effectiveLimit: number | null;
  maxWithExpress: number | null;
  activeCompanyCount: number;
}

export function inferQueuePriorityTier(
  run: Pick<LiveRunForIssue, "invocationSource" | "triggerDetail">,
  agent: Pick<Agent, "role" | "reportsTo"> | null | undefined,
  isChat: boolean,
): QueuePriorityTier {
  const isBoardTriggered =
    run.invocationSource === "on_demand" ||
    run.triggerDetail === "manual" ||
    isChat;
  const isExecutiveCoordinator =
    agent?.role === "ceo" || (agent != null && agent.reportsTo === null);

  if (isBoardTriggered && isExecutiveCoordinator) return 1;
  if (isBoardTriggered) return 2;
  return 3;
}

function parseIsoMs(iso: string | null | undefined): number {
  if (!iso) return Number.MAX_SAFE_INTEGER;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

function toIsoString(value: string | Date | null | undefined): string {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : value;
}

function buildItemHref(
  companyPrefix: string,
  location: "chat" | "task" | "run",
  run: Pick<LiveRunForIssue, "id" | "agentId" | "issueId">,
  agent: Pick<Agent, "id" | "name" | "urlKey" | "status"> | null,
): string {
  const prefix = companyPrefix ? `/${encodeURIComponent(companyPrefix.toUpperCase())}` : "";
  if (location === "chat") {
    const ref = agent
      ? agent.status === "terminated"
        ? agent.id
        : agentRouteRef(agent)
      : run.agentId;
    return `${prefix}/chats/${encodeURIComponent(ref)}`;
  }
  if (location === "task" && run.issueId) {
    return `${prefix}/issues/${encodeURIComponent(run.issueId)}`;
  }
  const ref = agent ? agentRouteRef(agent) : run.agentId;
  return `${prefix}/agents/${encodeURIComponent(ref)}/runs/${encodeURIComponent(run.id)}`;
}

export function buildRunQueueView(input: {
  companies: readonly Pick<Company, "id" | "name" | "issuePrefix">[];
  runsByCompanyId: ReadonlyMap<string, readonly LiveRunForIssue[]>;
  agentsByCompanyId: ReadonlyMap<string, readonly Agent[]>;
  chatsByCompanyId: ReadonlyMap<string, readonly Pick<Issue, "id" | "conversationAgentId">[]>;
  issuesById: ReadonlyMap<string, Pick<Issue, "id" | "identifier" | "title">>;
  commentsById?: ReadonlyMap<string, Pick<IssueComment, "id" | "body" | "createdAt">>;
  effectiveLimit: number | null;
  scopeCompanyId?: string | null;
}): RunQueueViewModel {
  const targetCompanies = input.scopeCompanyId
    ? input.companies.filter((company) => company.id === input.scopeCompanyId)
    : input.companies;

  const running: QueueRunItem[] = [];
  const queued: QueueRunItem[] = [];
  const companiesWithActivity = new Set<string>();

  for (const company of targetCompanies) {
    const runs = input.runsByCompanyId.get(company.id) ?? [];
    if (runs.length === 0) continue;

    const agentById = new Map(
      (input.agentsByCompanyId.get(company.id) ?? []).map((agent) => [agent.id, agent]),
    );
    const chatIssueByAgent = new Map<string, string>();
    for (const chat of input.chatsByCompanyId.get(company.id) ?? []) {
      if (chat.conversationAgentId) chatIssueByAgent.set(chat.conversationAgentId, chat.id);
    }

    for (const run of runs) {
      if (run.status !== "running" && run.status !== "queued") continue;
      companiesWithActivity.add(company.id);

      const agent = agentById.get(run.agentId) ?? null;
      const chatIssueId = chatIssueByAgent.get(run.agentId);
      const isChat = Boolean(run.issueId && chatIssueId && run.issueId === chatIssueId);
      const location: "chat" | "task" | "run" = isChat
        ? "chat"
        : run.issueId
          ? "task"
          : "run";
      const issue = run.issueId ? input.issuesById.get(run.issueId) ?? null : null;
      const priorityTier = inferQueuePriorityTier(run, agent, isChat);
      const isActuallyRunning = run.status === "running" && !isWaitingToStart(run);
      const triggerCommentId = run.contextWakeCommentId ?? run.contextCommentId ?? null;
      const triggerComment = triggerCommentId ? input.commentsById?.get(triggerCommentId) ?? null : null;

      const item: QueueRunItem = {
        id: run.id,
        companyId: company.id,
        companyName: company.name,
        companyPrefix: company.issuePrefix,
        status: isActuallyRunning ? "running" : "queued",
        agentId: run.agentId,
        agentName: agent?.name ?? run.agentName,
        agent,
        issueId: run.issueId ?? null,
        issueIdentifier: issue?.identifier ?? null,
        issueTitle: issue?.title ?? null,
        location,
        href: buildItemHref(company.issuePrefix, location, run, agent),
        priorityTier,
        priorityMeta: QUEUE_PRIORITY_META[priorityTier],
        invocationSource: run.invocationSource,
        triggerDetail: run.triggerDetail,
        wakeupRequestId: run.wakeupRequestId ?? null,
        runtimeMode: run.runtimeMode ?? null,
        livenessState: run.livenessState ?? null,
        livenessReason: run.livenessReason ?? null,
        continuationAttempt: run.continuationAttempt ?? 0,
        logBytes: run.logBytes ?? run.lastOutputBytes ?? null,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        lastEventAt: run.lastEventAt ?? null,
        currentToolName: run.currentToolName ?? null,
        currentStatusMessage: run.currentStatusMessage ?? null,
        adapterType: run.adapterType,
        contextCommentId: run.contextCommentId ?? null,
        contextWakeCommentId: run.contextWakeCommentId ?? null,
        triggerMessageBody: triggerComment?.body ?? null,
        triggerMessageCreatedAt: triggerComment ? toIsoString(triggerComment.createdAt) : null,
        execution: run.execution ?? null,
        queuePosition: null,
      };

      if (isActuallyRunning) {
        running.push(item);
      } else {
        queued.push(item);
      }
    }
  }

  // Running items sorted by start time (oldest active first).
  running.sort((a, b) => parseIsoMs(a.startedAt ?? a.createdAt) - parseIsoMs(b.startedAt ?? b.createdAt));

  // Queued items sorted strictly in backend dispatch order: priority tier ASC, createdAt ASC.
  queued.sort((a, b) => {
    if (a.priorityTier !== b.priorityTier) return a.priorityTier - b.priorityTier;
    return parseIsoMs(a.createdAt) - parseIsoMs(b.createdAt);
  });
  for (let i = 0; i < queued.length; i += 1) {
    queued[i]!.queuePosition = i + 1;
  }

  const slots = buildVisualSlots(running, input.effectiveLimit);
  const maxWithExpress =
    input.effectiveLimit === null
      ? null
      : input.effectiveLimit + EXPRESS_STEERING_EXTRA_SLOTS;

  return {
    running,
    queued,
    slots,
    effectiveLimit: input.effectiveLimit,
    maxWithExpress,
    activeCompanyCount: companiesWithActivity.size,
  };
}

export function buildQueuedMessageItems(input: {
  companies: readonly Pick<Company, "id" | "name" | "issuePrefix">[];
  agentsByCompanyId: ReadonlyMap<string, readonly Agent[]>;
  chatsByCompanyId: ReadonlyMap<string, readonly Pick<Issue, "id" | "conversationAgentId">[]>;
  issuesById: ReadonlyMap<string, Pick<Issue, "id" | "companyId" | "identifier" | "title" | "assigneeAgentId">>;
  queuedCommentsByIssueId: ReadonlyMap<string, IssueQueuedCommentQueue>;
  companyIdByIssueId: ReadonlyMap<string, string>;
}): QueuedMessageItem[] {
  const companyById = new Map(input.companies.map((company) => [company.id, company]));
  const chatAgentByIssueId = new Map<string, { companyId: string; agentId: string }>();
  for (const [companyId, chats] of input.chatsByCompanyId.entries()) {
    for (const chat of chats) {
      if (chat.conversationAgentId) {
        chatAgentByIssueId.set(chat.id, { companyId, agentId: chat.conversationAgentId });
      }
    }
  }

  const items: QueuedMessageItem[] = [];

  for (const [issueId, queue] of input.queuedCommentsByIssueId.entries()) {
    if (!queue.queueId || queue.entries.length === 0) continue;
    const firstTurnIds = new Set(queue.firstTurnCommentIds ?? []);
    const chatInfo = chatAgentByIssueId.get(issueId) ?? null;
    const issue = input.issuesById.get(issueId) ?? null;
    const companyId = chatInfo?.companyId ?? issue?.companyId ?? input.companyIdByIssueId.get(issueId);
    const company = companyId ? companyById.get(companyId) ?? null : null;
    if (!company) continue;

    const agents = input.agentsByCompanyId.get(company.id) ?? [];
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const targetAgentId = chatInfo?.agentId ?? issue?.assigneeAgentId ?? null;
    const targetAgent = targetAgentId ? agentById.get(targetAgentId) ?? null : null;
    const location: "chat" | "task" = chatInfo ? "chat" : "task";
    const prefix = `/${encodeURIComponent(company.issuePrefix.toUpperCase())}`;
    const href =
      location === "chat"
        ? `${prefix}/chats/${encodeURIComponent(targetAgent ? agentRouteRef(targetAgent) : (targetAgentId ?? issueId))}`
        : `${prefix}/issues/${encodeURIComponent(issueId)}`;
    const targetLabel =
      location === "chat"
        ? `Chat with ${targetAgent?.name ?? "Agent"}`
        : issue?.identifier && issue?.title
          ? `${issue.identifier} · ${issue.title}`
          : issue?.title ?? issue?.identifier ?? "Task thread";

    for (const entry of queue.entries) {
      if (firstTurnIds.has(entry.comment.id)) continue;
      const authorAgent = entry.comment.authorAgentId
        ? agentById.get(entry.comment.authorAgentId) ?? null
        : null;
      const authorLabel = authorAgent
        ? authorAgent.name
        : entry.comment.authorUserId
          ? "Board user"
          : "User";

      items.push({
        commentId: entry.comment.id,
        issueId,
        companyId: company.id,
        companyName: company.name,
        companyPrefix: company.issuePrefix,
        location,
        targetLabel,
        agentName: targetAgent?.name ?? null,
        agent: targetAgent,
        href,
        body: entry.comment.body,
        createdAt: toIsoString(entry.comment.createdAt),
        position: entry.position,
        authorLabel,
        queueId: queue.queueId,
        revision: queue.revision,
        queueState: queue.state,
        targetRunId: queue.targetRunId,
        protocol: queue.protocol,
        steeringDisposition: queue.steeringDisposition,
        executionWait: queue.executionWait ?? null,
        interactionSummary: entry.source?.summary ?? null,
        canEdit: entry.canEdit,
        canDiscard: entry.canDiscard,
      });
    }
  }

  items.sort((a, b) => {
    const timeDiff = parseIsoMs(a.createdAt) - parseIsoMs(b.createdAt);
    if (timeDiff !== 0) return timeDiff;
    return a.position - b.position;
  });

  return items;
}

function buildVisualSlots(
  running: readonly QueueRunItem[],
  effectiveLimit: number | null,
): VisualQueueSlot[] {
  if (effectiveLimit === null) {
    if (running.length === 0) {
      return [{ key: "worker-1", label: "Slot 1", kind: "worker", item: null }];
    }
    return running.map((item, idx) => ({
      key: `worker-${idx + 1}`,
      label: `Slot ${idx + 1}`,
      kind: "worker" as const,
      item,
    }));
  }

  let expressItem: QueueRunItem | null = null;
  const workerItems: QueueRunItem[] = [];

  const hasNonExpress = running.some((item) => !item.priorityMeta.expressEligible);
  for (const item of running) {
    const preferExpress =
      expressItem === null &&
      item.priorityMeta.expressEligible &&
      (running.length > effectiveLimit || hasNonExpress);
    if (preferExpress) {
      expressItem = item;
    } else if (workerItems.length < effectiveLimit) {
      workerItems.push(item);
    } else if (expressItem === null) {
      expressItem = item;
    } else {
      workerItems.push(item);
    }
  }

  const visualWorkerCount = Math.max(effectiveLimit, workerItems.length);
  const cappedWorkerSlots = Math.min(visualWorkerCount, 8);
  const slots: VisualQueueSlot[] = [];

  for (let i = 0; i < cappedWorkerSlots; i += 1) {
    slots.push({
      key: `worker-${i + 1}`,
      label: `Worker slot ${i + 1}`,
      kind: "worker",
      item: workerItems[i] ?? null,
    });
  }

  for (let i = cappedWorkerSlots; i < workerItems.length; i += 1) {
    slots.push({
      key: `worker-${i + 1}`,
      label: `Worker slot ${i + 1}`,
      kind: "worker",
      item: workerItems[i]!,
    });
  }

  slots.push({
    key: "express-1",
    label: "Express slot (+1)",
    kind: "express",
    item: expressItem,
  });

  return slots;
}

export function formatQueueDuration(
  isoTimestamp: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!isoTimestamp) return "just now";
  const parsed = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsed)) return "just now";
  const diffSeconds = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s`;
  const minutes = Math.floor(diffSeconds / 60);
  const seconds = diffSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

export function formatBytesCompact(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
