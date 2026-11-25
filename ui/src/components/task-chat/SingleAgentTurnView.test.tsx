// @vitest-environment jsdom
// fork 31erGER: tests for single-agent chat turn redesign (log dropdown,
// expandable Hermes/Pi-TUI thinking block, uncompressed action list).
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TranscriptEntry } from "@/adapters";
import { ThemeProvider } from "@/context/ThemeContext";
import {
  SingleAgentChatModeProvider,
  SingleAgentFileEditCard,
  SingleAgentLiveTurn,
  SingleAgentThinkingBlock,
  buildDiffAbstract,
  isWakePayloadText,
} from "./SingleAgentTurnView";
import { TaskChatRunnerActivityGroup } from "./TaskChatRunnerActivityGroup";
import { TaskChatThinking } from "./TaskChatThinking";
import type {
  TaskChatActivityPhaseItem,
  TaskChatItem,
  TaskChatThinkingItem,
} from "./task-chat-model";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function renderWithTheme(node: ReactNode) {
  act(() => {
    root.render(<ThemeProvider>{node}</ThemeProvider>);
  });
}

describe("isWakePayloadText", () => {
  it("recognizes Paperclip wake and resume prompts while ignoring normal replies", () => {
    expect(isWakePayloadText("## Paperclip Wake Payload\nAgent ID: a1")).toBe(true);
    expect(isWakePayloadText("## Paperclip Resume Delta\nNew comment from board")).toBe(true);
    expect(
      isWakePayloadText("You are agent a1 (Scout).\nContinue your Paperclip work."),
    ).toBe(true);
    expect(isWakePayloadText("I checked the repository and found two issues.")).toBe(false);
  });
});

describe("SingleAgentLiveTurn", () => {
  it("packs wake payload and system logs into a closed-by-default dropdown", () => {
    const rawEntries: TranscriptEntry[] = [
      { kind: "system", ts: "2026-11-24T20:00:00.000Z", text: "Pi session started (/tmp/work)" },
      {
        kind: "user",
        ts: "2026-11-24T20:00:01.000Z",
        text: "## Paperclip Wake Payload\n\nAgent ID: agent-1\nChat mode directive: answer concisely.",
      },
    ];
    const items: TaskChatItem[] = [
      {
        id: "run-1:think:0",
        kind: "thinking",
        lines: ["Checking vault notes", "Looking at Q4 portfolio allocation", "Ready to inspect files"],
        streaming: true,
      },
      {
        id: "run-1:tool:1",
        kind: "tool",
        name: "read",
        rawName: "read",
        status: "completed",
        target: "vaults/company/README.md",
        detail: "# Company Vault\nShared knowledge base.",
      },
      {
        id: "run-1:tool:2",
        kind: "tool",
        name: "bash",
        rawName: "bash",
        status: "in_progress",
        target: "git status --short",
      },
    ];

    renderWithTheme(
      <SingleAgentLiveTurn runId="run-1" items={items} rawEntries={rawEntries} />,
    );

    // Wake payload is hidden inside the collapsed dropdown by default.
    const dropdown = container.querySelector('[data-testid="single-agent-log-dropdown"]');
    expect(dropdown?.getAttribute("data-open")).toBe("false");
    expect(container.querySelector('[data-testid="single-agent-log-dropdown-body"]')).toBeNull();
    expect(container.textContent).not.toContain("## Paperclip Wake Payload");

    // Clicking the toggle opens the dropdown and reveals the wake payload & logs.
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="single-agent-log-dropdown-toggle"]',
    );
    expect(toggle).not.toBeNull();
    act(() => {
      toggle!.click();
    });
    expect(dropdown?.getAttribute("data-open")).toBe("true");
    const body = container.querySelector('[data-testid="single-agent-log-dropdown-body"]');
    expect(body?.textContent).toContain("## Paperclip Wake Payload");
    expect(body?.textContent).toContain("Pi session started");

    // Clicking again collapses it cleanly.
    act(() => {
      toggle!.click();
    });
    expect(dropdown?.getAttribute("data-open")).toBe("false");

    // Both tool actions are rendered uncompressed (not collapsed behind a 1-line ticker).
    const actionRows = container.querySelectorAll('[data-testid="single-agent-action-row"]');
    expect(actionRows).toHaveLength(2);
    expect(actionRows[0]?.textContent).toContain("vaults/company/README.md");
    expect(actionRows[1]?.textContent).toContain("$ git status --short");

    // Clicking the first tool action expands its detail drawer.
    const firstActionBtn = actionRows[0]?.querySelector("button");
    expect(firstActionBtn).not.toBeNull();
    act(() => {
      firstActionBtn!.click();
    });
    expect(container.querySelector('[data-testid="single-agent-action-detail"]')?.textContent).toContain(
      "# Company Vault",
    );
  });

  it("defensively folds legacy wake-payload messages into the dropdown", () => {
    const items: TaskChatItem[] = [
      {
        id: "run-legacy:msg:0",
        kind: "message",
        author: "agent",
        interstitial: true,
        text: "## Paperclip Wake Payload\n\nLegacy leaked user prompt.",
      },
      {
        id: "run-legacy:msg:1",
        kind: "message",
        author: "agent",
        interstitial: true,
        text: "Looking into your request now.",
      },
    ];

    renderWithTheme(<SingleAgentLiveTurn runId="run-legacy" items={items} rawEntries={[]} />);

    expect(container.textContent).toContain("Looking into your request now.");
    expect(container.textContent).not.toContain("Legacy leaked user prompt.");

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="single-agent-log-dropdown-toggle"]',
    );
    act(() => {
      toggle!.click();
    });
    expect(container.textContent).toContain("Legacy leaked user prompt.");
  });
});

describe("SingleAgentThinkingBlock", () => {
  it("expands and collapses both streaming and settled thinking blocks", () => {
    const thinking: TaskChatThinkingItem = {
      id: "run-1:think:0",
      kind: "thinking",
      lines: [
        "Step 1: inspect the vault files.",
        "Step 2: cross-check the latest market memo.",
        "Step 3: compare risk limits.",
        "Step 4: draft a concise answer.",
      ],
      streaming: false,
      summaryLabel: "Thought for 6s",
    };

    renderWithTheme(<SingleAgentThinkingBlock item={thinking} active={false} />);

    const block = container.querySelector('[data-testid="single-agent-thinking-block"]');
    expect(block?.getAttribute("data-open")).toBe("false");
    expect(block?.textContent).toContain("Thought for 6s");
    expect(container.querySelector('[data-testid="single-agent-thinking-preview"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="single-agent-thinking-body"]')).toBeNull();

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="single-agent-thinking-toggle"]',
    );
    act(() => {
      toggle!.click();
    });
    expect(block?.getAttribute("data-open")).toBe("true");
    const expandedBody = container.querySelector('[data-testid="single-agent-thinking-body"]');
    expect(expandedBody?.textContent).toContain("Step 1: inspect the vault files.");
    expect(expandedBody?.textContent).toContain("Step 4: draft a concise answer.");
  });
});

describe("SingleAgentChatModeProvider integration", () => {
  const phase: TaskChatActivityPhaseItem = {
    id: "run-9:phase:opening",
    kind: "activity_phase",
    summary: "Read 1 file, ran 1 command",
    active: false,
    interstitial: {
      id: "run-9:msg:0",
      kind: "message",
      author: "agent",
      interstitial: true,
      text: "## Paperclip Resume Delta\n\nTrigger: chat message",
    },
    items: [
      {
        id: "run-9:think:0",
        kind: "thinking",
        lines: ["Analyzing portfolio exposure across regions."],
        streaming: false,
      },
      {
        id: "run-9:tool:1",
        kind: "tool",
        name: "read",
        rawName: "read",
        status: "completed",
        target: "notes/exposure.md",
      },
      {
        id: "run-9:tool:2",
        kind: "tool",
        name: "bash",
        rawName: "bash",
        status: "completed",
        target: "python3 calc.py",
        exitCode: 0,
      },
    ],
  };

  it("renders uncompressed actions, expandable thinking, and collapsed wake dropdown when enabled", () => {
    renderWithTheme(
      <SingleAgentChatModeProvider enabled={true}>
        <TaskChatRunnerActivityGroup item={phase} />
        <TaskChatThinking
          item={{
            id: "standalone-think",
            kind: "thinking",
            lines: ["Standalone reasoning"],
            streaming: false,
          }}
        />
      </SingleAgentChatModeProvider>,
    );

    expect(container.querySelector('[data-testid="single-agent-activity-phase"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="single-agent-log-dropdown"]')?.getAttribute("data-open")).toBe(
      "false",
    );
    expect(container.textContent).not.toContain("Trigger: chat message");
    expect(container.querySelectorAll('[data-testid="single-agent-action-row"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-testid="single-agent-thinking-block"]')).toHaveLength(2);
  });

  it("preserves standard TaskChatRunnerActivityGroup when single-agent mode is disabled", () => {
    renderWithTheme(
      <SingleAgentChatModeProvider enabled={false}>
        <TaskChatRunnerActivityGroup item={phase} />
      </SingleAgentChatModeProvider>,
    );

    expect(container.querySelector('[data-testid="single-agent-activity-phase"]')).toBeNull();
    expect(container.querySelector('[data-testid="task-chat-activity-phase"]')).not.toBeNull();
  });
});

describe("SingleAgentFileEditCard", () => {
  it("shows a short inline diff abstract and unfolds the full diff on click (Pi TUI / Claude Code style)", () => {
    const lines = [
      { kind: "context" as const, text: " 1  import React from 'react';" },
      { kind: "context" as const, text: " 2  // unchanged header" },
      { kind: "context" as const, text: " 3  function compute() {" },
      { kind: "remove" as const, text: " 4    return 1;" },
      { kind: "add" as const, text: " 4    return 2;" },
      { kind: "add" as const, text: " 5    // added comment" },
      { kind: "context" as const, text: " 6  }" },
      { kind: "add" as const, text: " 7  export const extraA = true;" },
      { kind: "add" as const, text: " 8  export const extraB = true;" },
      { kind: "add" as const, text: " 9  export const extraC = true;" },
      { kind: "add" as const, text: "10  export const finalLine = 'done';" },
    ];

    const abstract = buildDiffAbstract(lines, 6);
    expect(abstract.preview).toHaveLength(6);
    expect(abstract.preview[0]?.text).toContain("function compute()");
    expect(abstract.hiddenCount).toBe(5);

    renderWithTheme(
      <SingleAgentFileEditCard
        active={false}
        item={{
          id: "run-edit:tool:1",
          kind: "tool",
          name: "Edit",
          rawName: "edit",
          status: "completed",
          target: "src/math.ts",
          diff: {
            path: "src/math.ts",
            added: 6,
            removed: 1,
            lines,
          },
        }}
      />,
    );

    const card = container.querySelector('[data-testid="single-agent-file-edit"]');
    expect(card?.getAttribute("data-open")).toBe("false");
    expect(card?.textContent).toContain("Edited");
    expect(card?.textContent).toContain("src/math.ts");
    expect(card?.textContent).toContain("+6");
    expect(card?.textContent).toContain("−1");

    // Collapsed state renders the short abstract centered on the first change, NOT the final hidden line.
    const abstractBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="single-agent-file-edit-abstract"]',
    );
    expect(abstractBtn).not.toBeNull();
    expect(abstractBtn?.textContent).toContain("return 2;");
    expect(abstractBtn?.textContent).not.toContain("finalLine");
    expect(container.querySelector('[data-testid="single-agent-file-edit-more"]')?.textContent).toContain(
      "5 more lines",
    );

    // Clicking the abstract unfolds the full diff immediately.
    act(() => {
      abstractBtn!.click();
    });
    expect(card?.getAttribute("data-open")).toBe("true");
    const full = container.querySelector('[data-testid="single-agent-file-edit-full"]');
    expect(full?.textContent).toContain("import React from 'react';");
    expect(full?.textContent).toContain("finalLine");

    // Clicking the header folds it back down to the compact abstract.
    const headerToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="single-agent-file-edit-toggle"]',
    );
    act(() => {
      headerToggle!.click();
    });
    expect(card?.getAttribute("data-open")).toBe("false");
    expect(container.querySelector('[data-testid="single-agent-file-edit-abstract"]')).not.toBeNull();
  });
});
