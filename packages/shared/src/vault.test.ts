// fork 31erGER
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCompanyVaultDir } from "./home-paths.js";
import {
  classifyVaultFileType,
  isAgentForbiddenVaultPath,
  isGitProtectedVaultPath,
  normalizeVaultRelativePath,
  parseCanvasDocument,
  parseVaultFrontmatter,
  stringifyCanvasDocument,
  toggleBoardOnlyFrontmatter,
} from "./vault.js";

describe("shared vault helpers", () => {
  it("resolves company vault inside repo vaults/ by default and honors homeDir override", () => {
    const prevRoot = process.env.PAPERCLIP_VAULT_ROOT;
    delete process.env.PAPERCLIP_VAULT_ROOT;
    try {
      const defaultDir = resolveCompanyVaultDir("company_123");
      expect(defaultDir.endsWith(path.join("vaults", "company_123"))).toBe(true);
      const overrideDir = resolveCompanyVaultDir("company_123", {
        homeDir: "/tmp/test-paperclip-home",
        instanceId: "default",
      });
      expect(overrideDir).toBe(path.resolve("/tmp/test-paperclip-home", "vaults", "company_123"));
    } finally {
      if (prevRoot !== undefined) process.env.PAPERCLIP_VAULT_ROOT = prevRoot;
    }
  });

  it("rejects traversal, absolute paths, and git paths", () => {
    expect(normalizeVaultRelativePath("../secret.md")).toBeNull();
    expect(normalizeVaultRelativePath("/etc/passwd")).toBeNull();
    expect(normalizeVaultRelativePath("projects/alpha.md")).toBe("projects/alpha.md");
    expect(isGitProtectedVaultPath(".git/config")).toBe(true);
    expect(isGitProtectedVaultPath("sub/.git/HEAD")).toBe(true);
    expect(isGitProtectedVaultPath(".gitmodules")).toBe(true);
    expect(isGitProtectedVaultPath("COMPANY.md")).toBe(false);
    expect(isAgentForbiddenVaultPath(".obsidian/app.json")).toBe(true);
    expect(isAgentForbiddenVaultPath(".gitignore")).toBe(true);
    expect(isAgentForbiddenVaultPath("projects/notes.md")).toBe(false);
  });

  it("parses and toggles board-only frontmatter and tags", () => {
    const raw = "---\neditable_by: board\ntags: [board, priorities]\n---\n\n# Board\n";
    expect(parseVaultFrontmatter(raw)).toEqual({
      boardOnly: true,
      tags: ["board", "priorities"],
    });

    const unlocked = toggleBoardOnlyFrontmatter(raw, false);
    expect(parseVaultFrontmatter(unlocked).boardOnly).toBe(false);
    expect(parseVaultFrontmatter(unlocked).tags).toEqual(["board", "priorities"]);

    const plain = "# Hello\nBody";
    const locked = toggleBoardOnlyFrontmatter(plain, true);
    expect(parseVaultFrontmatter(locked).boardOnly).toBe(true);
    expect(locked).toContain("# Hello");
  });

  it("round-trips Obsidian JSON Canvas 1.0 documents", () => {
    const doc = parseCanvasDocument(
      JSON.stringify({
        nodes: [
          { id: "n1", type: "text", text: "Hello", x: 0, y: 0, width: 240, height: 120 },
          { id: "n2", type: "file", file: "BOARD.md", x: 300, y: 0, width: 280, height: 160 },
        ],
        edges: [
          { id: "e1", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left", label: "references" },
        ],
      }),
    );
    expect(doc.nodes).toHaveLength(2);
    expect(doc.edges).toHaveLength(1);
    expect(parseCanvasDocument(stringifyCanvasDocument(doc))).toEqual(doc);
    expect(classifyVaultFileType("Overview.canvas")).toBe("canvas");
    expect(classifyVaultFileType("BOARD.md")).toBe("markdown");
  });
});
