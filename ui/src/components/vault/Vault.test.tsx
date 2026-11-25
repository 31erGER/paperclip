// @vitest-environment jsdom
// fork 31erGER
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringifyCanvasDocument, type VaultDocument } from "@paperclipai/shared";
import { VaultMarkdownEditor } from "./VaultMarkdownEditor";
import { VaultCanvasEditor } from "./VaultCanvasEditor";

vi.mock("@/components/MarkdownBody", () => ({
  MarkdownBody: ({ children }: { children: string }) => (
    <div data-testid="md-preview">{children}</div>
  ),
}));

vi.mock("@/api/vault", () => ({
  vaultApi: {
    readFile: vi.fn(async () => ({
      path: "BOARD.md",
      name: "BOARD.md",
      fileType: "markdown",
      content: "# Board\nPreferences",
      hash: "h1",
      sizeBytes: 20,
      updatedAt: new Date().toISOString(),
      boardOnly: true,
      tags: [],
      backlinks: [],
    })),
  },
}));

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

describe("Vault editors", () => {
  it("toggles board-only protection and renders backlinks in VaultMarkdownEditor", async () => {
    const onSave = vi.fn(async () => {});
    const onOpenFile = vi.fn();
    const doc: VaultDocument = {
      path: "COMPANY.md",
      name: "COMPANY.md",
      fileType: "markdown",
      content: "# Company\nSee [[BOARD]].\n",
      hash: "abc",
      sizeBytes: 24,
      updatedAt: new Date().toISOString(),
      boardOnly: false,
      tags: ["company"],
      backlinks: [{ sourcePath: "INDEX.md", sourceName: "INDEX.md", line: 10, snippet: "[[COMPANY]]" }],
    };

    await act(async () => {
      root.render(
        <VaultMarkdownEditor
          document={doc}
          allFilePaths={["INDEX.md", "BOARD.md", "COMPANY.md"]}
          saving={false}
          conflictMessage={null}
          saveError={null}
          onSave={onSave}
          onReload={vi.fn()}
          onOpenFile={onOpenFile}
        />,
      );
    });

    expect(container.textContent).toContain("Backlinks (1)");
    const lockBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Agents can edit"),
    )!;
    expect(lockBtn).toBeTruthy();
    await act(async () => lockBtn.click());
    expect(container.textContent).toContain("Board-only");

    const saveBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.trim() === "Save",
    )!;
    await act(async () => saveBtn.click());
    expect(onSave).toHaveBeenCalledWith(expect.stringContaining("editable_by: board"), false);
  });

  it("renders JSON Canvas nodes and adds a new text card in VaultCanvasEditor", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onSave = vi.fn(async () => {});
    const doc: VaultDocument = {
      path: "Overview.canvas",
      name: "Overview.canvas",
      fileType: "canvas",
      content: stringifyCanvasDocument({
        nodes: [
          { id: "n1", type: "text", text: "Hello", x: 0, y: 0, width: 240, height: 120 },
          { id: "n2", type: "file", file: "BOARD.md", x: 300, y: 0, width: 240, height: 140 },
        ],
        edges: [{ id: "e1", fromNode: "n1", toNode: "n2", label: "links" }],
      }),
      hash: "c1",
      sizeBytes: 200,
      updatedAt: new Date().toISOString(),
      boardOnly: false,
      tags: [],
      backlinks: [],
    };

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <VaultCanvasEditor
            companyId="comp-1"
            document={doc}
            markdownFiles={["BOARD.md", "COMPANY.md"]}
            saving={false}
            conflictMessage={null}
            saveError={null}
            onSave={onSave}
            onReload={vi.fn()}
            onOpenFile={vi.fn()}
          />
        </QueryClientProvider>,
      );
    });

    expect(container.querySelectorAll("[data-canvas-node]")).toHaveLength(2);
    const addTextBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Text card"),
    )!;
    await act(async () => addTextBtn.click());
    expect(container.querySelectorAll("[data-canvas-node]")).toHaveLength(3);
  });
});
