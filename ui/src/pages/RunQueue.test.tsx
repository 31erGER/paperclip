// @vitest-environment jsdom
// fork 31erGER
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, Company, Issue, IssueComment, IssueQueuedCommentQueue } from "@paperclipai/shared";
import type { LiveRunForIssue } from "@/api/heartbeats";
import {
  buildQueuedMessageItems,
  buildRunQueueView,
  formatQueueDuration,
} from "@/lib/run-queue-view";

vi.mock("@/lib/router", async () => {
  const rr = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...rr };
});

const mocks = vi.hoisted(() => ({
  liveRunsForCompany: vi.fn(),
  cancelRun: vi.fn(),
  agentsList: vi.fn(),
  chatsList: vi.fn(),
  issuesGet: vi.fn(),
  listComments: vi.fn(),
  getQueuedComments: vi.fn(),
  steerQueuedComment: vi.fn(),
  interruptQueuedComments: vi.fn(),
  discardQueuedComment: vi.fn(),
  getGeneral: vi.fn(),
  setBreadcrumbs: vi.fn(),
  pushToast: vi.fn(),
}));

vi.mock("@/api/heartbeats", () => ({
  heartbeatsApi: {
    liveRunsForCompany: mocks.liveRunsForCompany,
    cancel: mocks.cancelRun,
  },
}));
vi.mock("@/api/agents", () => ({
  agentsApi: { list: mocks.agentsList },
}));
vi.mock("@/api/agentChats", () => ({
  agentChatsApi: { list: mocks.chatsList },
}));
vi.mock("@/api/issues", () => ({
  issuesApi: {
    get: mocks.issuesGet,
    listComments: mocks.listComments,
    getQueuedComments: mocks.getQueuedComments,
    steerQueuedComment: mocks.steerQueuedComment,
    interruptQueuedComments: mocks.interruptQueuedComments,
    discardQueuedComment: mocks.discardQueuedComment,
  },
}));
vi.mock("@/api/instanceSettings", () => ({
  instanceSettingsApi: { getGeneral: mocks.getGeneral },
}));
vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: mocks.setBreadcrumbs }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToastActions: () => ({ pushToast: mocks.pushToast }),
}));
vi.mock("@/hooks/useDeploymentProfile", () => ({
  useDeploymentProfile: () => ({
    profile: "local_only",
    isLocal: true,
    showCostMetrics: false,
    loaded: true,
  }),
}));

const companyAlpha = {
  id: "comp-alpha",
  name: "Alpha Labs",
  issuePrefix: "ALP",
  status: "active",
} as Company;

const companyBeta = {
  id: "comp-beta",
  name: "Beta Studio",
  issuePrefix: "BET",
  status: "active",
} as Company;

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [companyAlpha, companyBeta],
    selectedCompanyId: companyAlpha.id,
    selectedCompany: companyAlpha,
  }),
}));

import { RunQueue } from "./RunQueue";

const ceoAgent = {
  id: "agent-ceo",
  companyId: companyAlpha.id,
  name: "Director",
  urlKey: "director",
  role: "ceo",
  reportsTo: null,
  status: "idle",
} as Agent;

const engAgent = {
  id: "agent-eng",
  companyId: companyAlpha.id,
  name: "Engineer",
  urlKey: "engineer",
  role: "engineer",
  reportsTo: "agent-ceo",
  status: "running",
} as Agent;

const betaAgent = {
  id: "agent-beta",
  companyId: companyBeta.id,
  name: "Researcher",
  urlKey: "researcher",
  role: "researcher",
  reportsTo: "agent-beta-lead",
  status: "idle",
} as Agent;

function makeRun(overrides: Partial<LiveRunForIssue>): LiveRunForIssue {
  return {
    id: "run-1",
    status: "running",
    invocationSource: "assignment",
    triggerDetail: null,
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    agentId: engAgent.id,
    agentName: engAgent.name,
    adapterType: "pi_local",
    issueId: "issue-1",
    ...overrides,
  };
}

describe("buildRunQueueView & buildQueuedMessageItems", () => {
  it("maps worker and express slots and orders queued runs across companies by priority tier then FIFO", () => {
    const view = buildRunQueueView({
      companies: [companyAlpha, companyBeta],
      runsByCompanyId: new Map([
        [
          companyAlpha.id,
          [
            makeRun({
              id: "r-worker",
              status: "running",
              agentId: engAgent.id,
              agentName: engAgent.name,
              issueId: "issue-1",
              startedAt: "2026-01-01T00:00:00Z",
            }),
            makeRun({
              id: "r-ceo-chat",
              status: "running",
              invocationSource: "on_demand",
              triggerDetail: "manual",
              agentId: ceoAgent.id,
              agentName: ceoAgent.name,
              issueId: "chat-ceo",
              startedAt: "2026-01-01T00:01:00Z",
            }),
            makeRun({
              id: "r-bg-old",
              status: "queued",
              startedAt: null,
              createdAt: "2026-01-01T00:01:00Z",
              agentId: engAgent.id,
              agentName: engAgent.name,
              issueId: "issue-2",
            }),
            makeRun({
              id: "r-board",
              status: "queued",
              invocationSource: "on_demand",
              triggerDetail: "manual",
              startedAt: null,
              createdAt: "2026-01-01T00:03:00Z",
              agentId: engAgent.id,
              agentName: engAgent.name,
              issueId: "issue-3",
            }),
          ],
        ],
        [
          companyBeta.id,
          [
            makeRun({
              id: "r-beta-bg",
              status: "queued",
              startedAt: null,
              createdAt: "2026-01-01T00:02:00Z",
              agentId: betaAgent.id,
              agentName: betaAgent.name,
              issueId: "issue-b1",
            }),
          ],
        ],
      ]),
      agentsByCompanyId: new Map([
        [companyAlpha.id, [ceoAgent, engAgent]],
        [companyBeta.id, [betaAgent]],
      ]),
      chatsByCompanyId: new Map([
        [companyAlpha.id, [{ id: "chat-ceo", conversationAgentId: ceoAgent.id }]],
        [companyBeta.id, []],
      ]),
      issuesById: new Map([
        ["issue-1", { id: "issue-1", identifier: "ALP-1", title: "Build parser" }],
        ["issue-2", { id: "issue-2", identifier: "ALP-2", title: "Write tests" }],
        ["issue-3", { id: "issue-3", identifier: "ALP-3", title: "Fix layout" }],
        ["issue-b1", { id: "issue-b1", identifier: "BET-9", title: "Draft summary" }],
      ]),
      effectiveLimit: 1,
    });

    expect(view.slots).toHaveLength(2);
    expect(view.slots[0]?.kind).toBe("worker");
    expect(view.slots[0]?.item?.id).toBe("r-worker");
    expect(view.slots[0]?.item?.href).toBe("/ALP/issues/issue-1");
    expect(view.slots[1]?.kind).toBe("express");
    expect(view.slots[1]?.item?.id).toBe("r-ceo-chat");
    expect(view.slots[1]?.item?.href).toBe("/ALP/chats/director");

    expect(view.queued.map((item) => item.id)).toEqual([
      "r-board",
      "r-bg-old",
      "r-beta-bg",
    ]);
    expect(view.queued.map((item) => item.queuePosition)).toEqual([1, 2, 3]);
    expect(view.queued[2]?.href).toBe("/BET/issues/issue-b1");
  });

  it("collects pending queued messages across chats and tasks while excluding first-turn sealed comments", () => {
    const queue: IssueQueuedCommentQueue = {
      issueId: "chat-ceo",
      queueId: "queue-1",
      state: "deferred",
      targetRunId: "run-live-1",
      revision: "rev-1",
      protocol: "legacy",
      steeringDisposition: "available",
      executionWait: { reason: "slot_busy", message: "Waiting for current tool call" },
      firstTurnCommentIds: ["c-sealed"],
      entries: [
        {
          position: 1,
          canEdit: false,
          canDiscard: false,
          comment: {
            id: "c-sealed",
            companyId: companyAlpha.id,
            issueId: "chat-ceo",
            authorAgentId: null,
            authorUserId: "user-1",
            body: "Already sealed into turn 1",
            createdAt: new Date("2026-01-01T00:00:00Z"),
            updatedAt: new Date("2026-01-01T00:00:00Z"),
          } as IssueComment,
        },
        {
          position: 2,
          canEdit: true,
          canDiscard: true,
          comment: {
            id: "c-pending",
            companyId: companyAlpha.id,
            issueId: "chat-ceo",
            authorAgentId: null,
            authorUserId: "user-1",
            body: "Switch focus to the parser bug first",
            createdAt: new Date("2026-01-01T00:02:00Z"),
            updatedAt: new Date("2026-01-01T00:02:00Z"),
          } as IssueComment,
        },
      ],
    };

    const messages = buildQueuedMessageItems({
      companies: [companyAlpha],
      agentsByCompanyId: new Map([[companyAlpha.id, [ceoAgent]]]),
      chatsByCompanyId: new Map([[companyAlpha.id, [{ id: "chat-ceo", conversationAgentId: ceoAgent.id }]]]),
      issuesById: new Map(),
      queuedCommentsByIssueId: new Map([["chat-ceo", queue]]),
      companyIdByIssueId: new Map([["chat-ceo", companyAlpha.id]]),
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.commentId).toBe("c-pending");
    expect(messages[0]?.location).toBe("chat");
    expect(messages[0]?.targetLabel).toBe("Chat with Director");
    expect(messages[0]?.href).toBe("/ALP/chats/director");
    expect(messages[0]?.steeringDisposition).toBe("available");
  });

  it("formats elapsed and waiting durations cleanly", () => {
    const base = Date.parse("2026-01-01T01:00:00Z");
    expect(formatQueueDuration("2026-01-01T00:59:25Z", base)).toBe("35s");
    expect(formatQueueDuration("2026-01-01T00:55:45Z", base)).toBe("4m 15s");
    expect(formatQueueDuration("2025-12-31T23:45:00Z", base)).toBe("1h 15m");
  });
});

describe("RunQueue page", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.clearAllMocks();

    mocks.getGeneral.mockResolvedValue({ maxConcurrentAgentRuns: 1 });
    mocks.agentsList.mockImplementation(async (companyId: string) =>
      companyId === companyAlpha.id ? [ceoAgent, engAgent] : [betaAgent],
    );
    mocks.chatsList.mockImplementation(async (companyId: string) =>
      companyId === companyAlpha.id
        ? [{ id: "chat-ceo", companyId: companyAlpha.id, conversationAgentId: ceoAgent.id } as Issue]
        : [],
    );
    mocks.issuesGet.mockImplementation(async (issueId: string) => ({
      id: issueId,
      companyId: issueId === "issue-1" ? companyAlpha.id : companyBeta.id,
      identifier: issueId === "issue-1" ? "ALP-1" : "BET-9",
      title: issueId === "issue-1" ? "Active build task" : "Queued research task",
      assigneeAgentId: issueId === "issue-1" ? engAgent.id : betaAgent.id,
    }));
    mocks.listComments.mockImplementation(async (issueId: string) =>
      issueId === "issue-b1"
        ? [
            {
              id: "comment-trigger-1",
              body: "Please summarize the latest benchmarks",
              createdAt: "2026-01-01T00:02:00Z",
            },
          ]
        : [],
    );
    mocks.getQueuedComments.mockImplementation(async (issueId: string) => {
      if (issueId === "chat-ceo") {
        return {
          issueId: "chat-ceo",
          queueId: "queue-ceo-1",
          state: "deferred",
          targetRunId: "r-active",
          revision: "rev-9",
          protocol: "legacy",
          steeringDisposition: "available",
          executionWait: { reason: "slot_busy", message: "Waiting for inference slot" },
          entries: [
            {
              position: 1,
              canEdit: true,
              canDiscard: true,
              comment: {
                id: "msg-queued-1",
                companyId: companyAlpha.id,
                issueId: "chat-ceo",
                authorAgentId: null,
                authorUserId: "board-user",
                body: "Pause refactoring and check the queue view",
                createdAt: "2026-01-01T00:03:00Z",
                updatedAt: "2026-01-01T00:03:00Z",
              },
            },
          ],
        } as unknown as IssueQueuedCommentQueue;
      }
      return {
        issueId,
        queueId: null,
        state: null,
        targetRunId: null,
        revision: "0",
        protocol: "legacy",
        steeringDisposition: "unsupported",
        entries: [],
      } as IssueQueuedCommentQueue;
    });
    mocks.cancelRun.mockResolvedValue({ id: "r-queued", status: "cancelled" });
    mocks.steerQueuedComment.mockResolvedValue({});
    mocks.interruptQueuedComments.mockResolvedValue({});
    mocks.discardQueuedComment.mockResolvedValue({});
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders slots, queued messages with metadata & steer/send/discard actions, and queued runs with metadata", async () => {
    mocks.liveRunsForCompany.mockImplementation(async (companyId: string) => {
      if (companyId === companyAlpha.id) {
        return [
          makeRun({
            id: "r-active",
            status: "running",
            agentId: engAgent.id,
            agentName: engAgent.name,
            issueId: "issue-1",
            currentToolName: "edit",
            runtimeMode: "legacy",
            logBytes: 4096,
          }),
        ];
      }
      return [
        makeRun({
          id: "r-queued",
          status: "queued",
          startedAt: null,
          agentId: betaAgent.id,
          agentName: betaAgent.name,
          issueId: "issue-b1",
          contextWakeCommentId: "comment-trigger-1",
          wakeupRequestId: "wake-999",
        }),
      ];
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <RunQueue />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
    });

    expect(container.querySelector('[data-testid="queue-running-count"]')?.textContent).toBe("1");
    expect(container.querySelector('[data-testid="queue-messages-count"]')?.textContent).toBe("1");
    expect(container.querySelector('[data-testid="queue-waiting-count"]')?.textContent).toBe("1");

    // Queued message renders body, actions, and expandable metadata
    const msgCard = container.querySelector('[data-testid="queued-message-msg-queued-1"]');
    expect(msgCard).not.toBeNull();
    expect(msgCard?.textContent).toContain("Pause refactoring and check the queue view");
    expect(msgCard?.textContent).toContain("Chat with Director");
    expect(msgCard?.textContent).toContain("Live steer ready");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="queued-message-meta-toggle-msg-queued-1"]')?.click();
    });
    const msgMeta = container.querySelector('[data-testid="queued-message-meta-msg-queued-1"]');
    expect(msgMeta?.textContent).toContain("queue-ce");
    expect(msgMeta?.textContent).toContain("Waiting for inference slot");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="queued-message-steer-msg-queued-1"]')?.click();
    });
    expect(mocks.steerQueuedComment).toHaveBeenCalledWith("chat-ceo", "msg-queued-1", {
      queueId: "queue-ceo-1",
      targetRunId: "r-active",
      revision: "rev-9",
    });

    // Waiting run renders triggering comment preview + expandable metadata
    const queuedRow = container.querySelector('[data-testid="queue-item-r-queued"]');
    expect(queuedRow?.textContent).toContain("#1");
    expect(queuedRow?.textContent).toContain("Next up");
    expect(queuedRow?.textContent).toContain("Please summarize the latest benchmarks");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="queue-item-meta-toggle-r-queued"]')?.click();
    });
    const runMeta = container.querySelector('[data-testid="queue-item-meta-r-queued"]');
    expect(runMeta?.textContent).toContain("wake-999");
    expect(runMeta?.textContent).toContain("pi_local");

    // Cancel queued run
    const cancelButton = queuedRow?.querySelector<HTMLButtonElement>(
      'button[aria-label="Cancel queued run for Researcher"]',
    );
    await act(async () => {
      cancelButton?.click();
    });
    expect(mocks.cancelRun).toHaveBeenCalledWith("r-queued");
  });
});
