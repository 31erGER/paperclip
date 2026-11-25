// fork 31erGER
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vaultService } from "./vault.js";

describe("vaultService", () => {
  let tmpRoot: string;
  let prevVaultRoot: string | undefined;
  const companyId = "comp-vault-test";
  const svc = vaultService();

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-vault-test-"));
    prevVaultRoot = process.env.PAPERCLIP_VAULT_ROOT;
    process.env.PAPERCLIP_VAULT_ROOT = tmpRoot;
  });

  afterEach(async () => {
    if (prevVaultRoot === undefined) delete process.env.PAPERCLIP_VAULT_ROOT;
    else process.env.PAPERCLIP_VAULT_ROOT = prevVaultRoot;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("scaffolds starter obsidian vault files and canvas on first access", async () => {
    const index = await svc.getIndex(companyId, "Acme");
    expect(index.info.gitAllowedForAgents).toBe(false);
    expect(index.info.vaultPath).toBe(path.join(tmpRoot, companyId));
    const names = index.tree.map((node) => node.name);
    expect(names).toContain("INDEX.md");
    expect(names).toContain("BOARD.md");
    expect(names).toContain("COMPANY.md");
    expect(names).toContain("Overview.canvas");
    expect(names).toContain("projects");
    expect(names).toContain("decisions");
    expect(names).not.toContain(".gitignore");

    const board = await svc.readFile(companyId, "BOARD.md", "agent");
    expect(board.boardOnly).toBe(true);
    expect(board.backlinks.some((b) => b.sourcePath === "INDEX.md")).toBe(true);
    expect(board.backlinks.some((b) => b.sourcePath === "Overview.canvas")).toBe(true);
  });

  it("allows agents to read/write normal notes but blocks board-only files and git/obsidian metadata", async () => {
    await svc.getIndex(companyId, "Acme");

    // Agent can create and edit normal notes
    const created = await svc.writeFile(
      companyId,
      { path: "projects/alpha.md", content: "# Alpha\n\nSee [[COMPANY]].\n" },
      "agent",
    );
    expect(created.created).toBe(true);
    expect(created.document.path).toBe("projects/alpha.md");

    // Agent cannot overwrite board-only BOARD.md
    await expect(
      svc.writeFile(companyId, { path: "BOARD.md", content: "hacked" }, "agent"),
    ).rejects.toMatchObject({ status: 403 });

    // Agent cannot rename or delete BOARD.md
    await expect(
      svc.renameEntry(companyId, "BOARD.md", "BOARD-copy.md", "agent"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(svc.deleteEntry(companyId, "BOARD.md", "agent")).rejects.toMatchObject({
      status: 403,
    });

    // Agent cannot lock files as board-only
    await expect(
      svc.writeFile(
        companyId,
        { path: "projects/locked.md", content: "---\neditable_by: board\n---\n# Locked\n" },
        "agent",
      ),
    ).rejects.toMatchObject({ status: 403 });

    // Board CAN edit BOARD.md
    const updatedBoard = await svc.writeFile(
      companyId,
      { path: "BOARD.md", content: "---\neditable_by: board\n---\n# Updated Board\n" },
      "board",
    );
    expect(updatedBoard.document.content).toContain("Updated Board");

    // Git & Obsidian paths are strictly blocked
    await expect(
      svc.writeFile(companyId, { path: ".git/config", content: "bad" }, "agent"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      svc.writeFile(companyId, { path: ".git/config", content: "bad" }, "board"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      svc.writeFile(companyId, { path: ".obsidian/app.json", content: "{}" }, "agent"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      svc.writeFile(companyId, { path: ".gitignore", content: "*" }, "agent"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      svc.readFile(companyId, "../escape.md", "agent"),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("enforces optimistic concurrency and validates canvas JSON", async () => {
    const initial = await svc.readFile(companyId, "COMPANY.md", "board");
    await svc.writeFile(
      companyId,
      { path: "COMPANY.md", content: "# Changed externally\n", expectedHash: initial.hash },
      "board",
    );
    await expect(
      svc.writeFile(
        companyId,
        { path: "COMPANY.md", content: "# Stale write\n", expectedHash: initial.hash },
        "board",
      ),
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      svc.writeFile(companyId, { path: "Broken.canvas", content: "{not json" }, "agent"),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("supports search, folder creation, rename, and deletion", async () => {
    await svc.createFolder(companyId, "runbooks", "agent");
    await svc.writeFile(
      companyId,
      { path: "runbooks/deploy.md", content: "# Deploy\nAlways run smoke tests before shipping.\n" },
      "agent",
    );
    const matches = await svc.search(companyId, "smoke tests", "agent");
    expect(matches.some((m) => m.path === "runbooks/deploy.md" && m.line === 2)).toBe(true);

    await svc.renameEntry(companyId, "runbooks/deploy.md", "runbooks/release.md", "agent");
    const doc = await svc.readFile(companyId, "runbooks/release.md", "agent");
    expect(doc.content).toContain("smoke tests");

    const deleted = await svc.deleteEntry(companyId, "runbooks", "agent");
    expect(deleted.kind).toBe("folder");
  });
});
