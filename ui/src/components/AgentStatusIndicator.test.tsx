// @vitest-environment jsdom
// fork 31erGER
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@paperclipai/shared";

vi.mock("@/lib/router", async () => {
  const rr = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...rr };
});
import {
  AgentStatusDot,
  agentStatusLabel,
  resolveEffectiveAgentStatus,
} from "./AgentStatusIndicator";
import { AgentConversationSidebar } from "./AgentConversationSidebar";
import type { AgentActiveRunSummary } from "./AgentActiveRunJump";
import type { LiveRunForIssue } from "@/api/heartbeats";

const sampleAgents = [
  { id: "a-running", name: "Ada", title: "Engineer", role: "engineer", status: "running" },
  { id: "a-idle", name: "Ben", title: "Designer", role: "designer", status: "idle" },
  { id: "a-paused", name: "Cora", title: "Researcher", role: "researcher", status: "paused" },
  { id: "a-error", name: "Dan", title: "Ops", role: "devops", status: "error" },
  { id: "a-pending", name: "Eve", title: "Writer", role: "general", status: "pending_approval" },
  { id: "a-term", name: "Finn", title: "Former", role: "general", status: "terminated" },
] as Agent[];

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("AgentStatusIndicator", () => {
  it("normalizes active status and promotes active conversations to running", () => {
    expect(resolveEffectiveAgentStatus("active")).toBe("idle");
    expect(resolveEffectiveAgentStatus("idle", true)).toBe("running");
    expect(resolveEffectiveAgentStatus("paused", true)).toBe("paused");
    expect(resolveEffectiveAgentStatus("error", true)).toBe("error");
    expect(resolveEffectiveAgentStatus("terminated", true)).toBe("terminated");
    expect(agentStatusLabel("pending_approval")).toBe("Awaiting approval");
    expect(agentStatusLabel("queued")).toBe("Queued");
  });

  it("uses live run state to distinguish running, queued, and stale idle agents", () => {
    expect(resolveEffectiveAgentStatus("idle", "running")).toBe("running");
    expect(resolveEffectiveAgentStatus("idle", "queued")).toBe("queued");
    expect(resolveEffectiveAgentStatus("running", "queued")).toBe("queued");
    expect(resolveEffectiveAgentStatus("running", "none")).toBe("idle");
    expect(resolveEffectiveAgentStatus("active", "none")).toBe("idle");
    expect(resolveEffectiveAgentStatus("paused", "running")).toBe("paused");
    expect(resolveEffectiveAgentStatus("terminated", "running")).toBe("terminated");
    expect(resolveEffectiveAgentStatus("error", "queued")).toBe("error");
  });

  it("renders token-backed dot colors and motion classes", async () => {
    await act(async () => {
      root.render(
        <>
          <AgentStatusDot status="running" />
          <AgentStatusDot status="error" />
          <AgentStatusDot status="pending_approval" />
        </>,
      );
    });
    const dots = [...container.querySelectorAll<HTMLElement>('[data-slot="agent-status-dot"]')];
    expect(dots).toHaveLength(3);
    expect(dots[0].className).toContain("hb-pulse");
    expect(dots[0].style.getPropertyValue("--sc")).toBe("var(--status-agent-running)");
    expect(dots[1].className).toContain("hb-blink");
    expect(dots[1].style.getPropertyValue("--sc")).toBe("var(--status-agent-error)");
    expect(dots[2].style.getPropertyValue("--sc")).toBe("var(--status-agent-paused)");
  });

  it("shows status dots and labels for every agent in AgentConversationSidebar", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <AgentConversationSidebar
            agents={sampleAgents}
            previews={{ "a-idle": "Working…" }}
          />
        </MemoryRouter>,
      );
    });
    const rows = [...container.querySelectorAll<HTMLAnchorElement>("a.agent-contact-row")];
    expect(rows).toHaveLength(6);

    // Running agent
    expect(rows[0].querySelector('[data-slot="agent-status-dot"]')?.getAttribute("data-status")).toBe("running");
    expect(rows[0].textContent).toContain("Running");
    expect(rows[0].textContent).toContain("Engineer");

    // Idle agent with active conversation preview -> promoted to running
    expect(rows[1].querySelector('[data-slot="agent-status-dot"]')?.getAttribute("data-status")).toBe("running");
    expect(rows[1].textContent).toContain("Running");

    // Paused, Error, Awaiting approval, Terminated
    expect(rows[2].querySelector('[data-slot="agent-status-dot"]')?.getAttribute("data-status")).toBe("paused");
    expect(rows[2].textContent).toContain("Paused");
    expect(rows[3].querySelector('[data-slot="agent-status-dot"]')?.getAttribute("data-status")).toBe("error");
    expect(rows[3].textContent).toContain("Error");
    expect(rows[4].querySelector('[data-slot="agent-status-dot"]')?.getAttribute("data-status")).toBe("pending_approval");
    expect(rows[4].textContent).toContain("Awaiting approval");
    expect(rows[5].querySelector('[data-slot="agent-status-dot"]')?.getAttribute("data-status")).toBe("terminated");
    expect(rows[5].textContent).toContain("Terminated");
  });

  it("shows honest task/chat/queued labels and 1-click task jump links when live runs are loaded", async () => {
    const taskRun = {
      id: "run-task-1",
      status: "running",
      agentId: "a-idle",
      agentName: "Ben",
      issueId: "issue-42",
      startedAt: "2026-01-01T00:00:00Z",
    } as LiveRunForIssue;
    const queuedRun = {
      id: "run-queued-1",
      status: "queued",
      agentId: "a-pending",
      agentName: "Eve",
      issueId: "issue-43",
      startedAt: null,
    } as LiveRunForIssue;

    const activeRunsByAgent = new Map<string, AgentActiveRunSummary>([
      [
        "a-idle",
        {
          kind: "running",
          location: "task",
          run: taskRun,
          href: "/issues/issue-42",
          locationLabel: "Running in task",
          actionLabel: "Jump to task",
        },
      ],
      [
        "a-pending",
        {
          kind: "queued",
          location: "task",
          run: queuedRun,
          href: "/issues/issue-43",
          locationLabel: "Queued in task",
          actionLabel: "Open task",
        },
      ],
    ]);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <AgentConversationSidebar
            agents={sampleAgents}
            activeRunsByAgent={activeRunsByAgent}
            liveRunsLoaded
          />
        </MemoryRouter>,
      );
    });

    const rows = [...container.querySelectorAll<HTMLAnchorElement>("a.agent-contact-row")];
    // Stale DB "running" agent with no live run -> shown honestly as Idle
    expect(rows[0].querySelector('[data-slot="agent-status-dot"]')?.getAttribute("data-status")).toBe("idle");
    expect(rows[0].textContent).toContain("Idle");
    expect(container.querySelector('[data-testid="agent-sidebar-jump-a-running"]')).toBeNull();

    // Agent running in a task -> shows "Running in task" + 1-click jump button
    expect(rows[1].querySelector('[data-slot="agent-status-dot"]')?.getAttribute("data-status")).toBe("running");
    expect(rows[1].textContent).toContain("Running in task");
    const taskJump = container.querySelector<HTMLAnchorElement>('[data-testid="agent-sidebar-jump-a-idle"]');
    expect(taskJump).not.toBeNull();
    expect(taskJump?.getAttribute("href")).toBe("/issues/issue-42");
    expect(taskJump?.textContent).toContain("Jump to task");

    // Agent queued in a task -> shows "Queued in task" (queued dot, not running) + "Open task"
    expect(rows[4].querySelector('[data-slot="agent-status-dot"]')?.getAttribute("data-status")).toBe("queued");
    expect(rows[4].textContent).toContain("Queued in task");
    const queuedJump = container.querySelector<HTMLAnchorElement>('[data-testid="agent-sidebar-jump-a-pending"]');
    expect(queuedJump?.getAttribute("href")).toBe("/issues/issue-43");
    expect(queuedJump?.textContent).toContain("Open task");
  });
});
