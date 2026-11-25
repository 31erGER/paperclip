// @vitest-environment jsdom
// fork 31erGER
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, Issue } from "@paperclipai/shared";
import type { LiveRunForIssue } from "@/api/heartbeats";

vi.mock("@/lib/router", async () => {
  const rr = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...rr };
});

import {
  AgentRunningElsewhereBanner,
  SidebarActiveRuns,
  buildChatIssueIdByAgentMap,
  resolveAgentActiveRunSummary,
} from "./AgentActiveRunJump";
import { queryKeys } from "@/lib/queryKeys";

const engineer = {
  id: "agent-eng",
  name: "Engineer",
  urlKey: "engineer",
  status: "idle",
} as Agent;

const lead = {
  id: "agent-lead",
  name: "Lead",
  urlKey: "lead",
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
    agentId: engineer.id,
    agentName: engineer.name,
    adapterType: "pi_local",
    issueId: "issue-100",
    ...overrides,
  };
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("resolveAgentActiveRunSummary", () => {
  it("distinguishes running in task, running in chat, and queued runs", () => {
    const chatMap = buildChatIssueIdByAgentMap([
      { id: "chat-lead", conversationAgentId: lead.id } as Issue,
    ]);
    const runs: LiveRunForIssue[] = [
      makeRun({ id: "r-queued", agentId: engineer.id, status: "queued", startedAt: null, issueId: "task-2" }),
      makeRun({ id: "r-running", agentId: engineer.id, status: "running", issueId: "task-1" }),
      makeRun({ id: "r-chat", agentId: lead.id, agentName: lead.name, status: "running", issueId: "chat-lead" }),
    ];

    const engSummary = resolveAgentActiveRunSummary(engineer, runs, chatMap);
    expect(engSummary?.kind).toBe("running");
    expect(engSummary?.location).toBe("task");
    expect(engSummary?.locationLabel).toBe("Running in task");
    expect(engSummary?.href).toBe("/issues/task-1");

    const leadSummary = resolveAgentActiveRunSummary(lead, runs, chatMap);
    expect(leadSummary?.kind).toBe("running");
    expect(leadSummary?.location).toBe("chat");
    expect(leadSummary?.locationLabel).toBe("Running in chat");
    expect(leadSummary?.href).toBe("/chats/lead");
  });

  it("classifies queued runs with no startedAt as queued rather than running", () => {
    const summary = resolveAgentActiveRunSummary(engineer, [
      makeRun({ id: "r-q", status: "queued", startedAt: null, issueId: "task-9" }),
    ]);
    expect(summary?.kind).toBe("queued");
    expect(summary?.locationLabel).toBe("Queued in task");
    expect(summary?.actionLabel).toBe("Open task");
    expect(summary?.href).toBe("/issues/task-9");
  });
});

describe("AgentRunningElsewhereBanner", () => {
  it("renders a 1-click Jump to task banner when the agent is running in a task", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.liveRuns("comp-1"), [
      makeRun({ id: "r-task", agentId: engineer.id, issueId: "task-77", currentStatusMessage: "Editing file" }),
    ]);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <AgentRunningElsewhereBanner
              companyId="comp-1"
              agent={engineer}
              currentChatIssueId="chat-eng"
            />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    const banner = container.querySelector('[data-testid="agent-running-elsewhere-banner"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("Engineer is currently running in a task");
    expect(banner?.textContent).toContain("Editing file");
    const link = container.querySelector<HTMLAnchorElement>('[data-testid="agent-running-elsewhere-jump"]');
    expect(link?.getAttribute("href")).toBe("/issues/task-77");
    expect(link?.textContent).toContain("Jump to task");
  });

  it("hides the banner when the agent is already running in the current chat", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.liveRuns("comp-1"), [
      makeRun({ id: "r-chat", agentId: engineer.id, issueId: "chat-eng" }),
    ]);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <AgentRunningElsewhereBanner
              companyId="comp-1"
              agent={engineer}
              currentChatIssueId="chat-eng"
            />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    expect(container.querySelector('[data-testid="agent-running-elsewhere-banner"]')).toBeNull();
  });
});

describe("SidebarActiveRuns", () => {
  it("lists only genuinely running agents with 1-click jumps and summarizes queued runs separately", async () => {
    const runs: LiveRunForIssue[] = [
      makeRun({ id: "r-eng", agentId: engineer.id, agentName: engineer.name, status: "running", issueId: "task-19" }),
      makeRun({ id: "r-lead", agentId: lead.id, agentName: lead.name, status: "running", issueId: "chat-lead" }),
      makeRun({ id: "r-q1", agentId: "agent-3", agentName: "QA", status: "queued", startedAt: null, issueId: "task-20" }),
      makeRun({ id: "r-q2", agentId: "agent-4", agentName: "Ops", status: "queued", startedAt: null, issueId: "task-21" }),
    ];

    await act(async () => {
      root.render(
        <MemoryRouter>
          <SidebarActiveRuns
            liveRuns={runs}
            agents={[engineer, lead]}
            chats={[{ id: "chat-lead", conversationAgentId: lead.id } as Issue]}
          />
        </MemoryRouter>,
      );
    });

    const card = container.querySelector('[data-testid="sidebar-active-runs"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Active now");
    expect(card?.textContent).toContain("2 queued");

    const engLink = container.querySelector<HTMLAnchorElement>('[data-testid="sidebar-active-run-r-eng"]');
    expect(engLink?.getAttribute("href")).toBe("/issues/task-19");
    expect(engLink?.textContent).toContain("Engineer");
    expect(engLink?.textContent).toContain("in task");

    const leadLink = container.querySelector<HTMLAnchorElement>('[data-testid="sidebar-active-run-r-lead"]');
    expect(leadLink?.getAttribute("href")).toBe("/chats/lead");
    expect(leadLink?.textContent).toContain("Lead");
    expect(leadLink?.textContent).toContain("in chat");

    // Queued runs are NOT listed as active running rows
    expect(container.querySelector('[data-testid="sidebar-active-run-r-q1"]')).toBeNull();
    expect(container.querySelector('[data-testid="sidebar-active-run-r-q2"]')).toBeNull();
  });

  it("renders nothing when no runs are running or queued", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SidebarActiveRuns liveRuns={[]} />
        </MemoryRouter>,
      );
    });
    expect(container.querySelector('[data-testid="sidebar-active-runs"]')).toBeNull();
  });
});
