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
});
