// fork 31erGER: Company Vault filesystem service (Obsidian-compatible .md & .canvas storage).
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  classifyVaultFileType,
  isAgentForbiddenVaultPath,
  isGitProtectedVaultPath,
  isHiddenVaultSegment,
  normalizeVaultRelativePath,
  parseCanvasDocument,
  parseVaultFrontmatter,
  stringifyCanvasDocument,
  type CanvasDocument,
  type VaultBacklink,
  type VaultDocument,
  type VaultIndexResponse,
  type VaultSearchMatch,
  type VaultTreeNode,
} from "@paperclipai/shared";
import { resolveCompanyVaultDir } from "../home-paths.js";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";

export type VaultActorRole = "board" | "agent";

const MAX_READABLE_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 100;
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function assertWithinVaultRealpath(vaultRoot: string, absPath: string): Promise<void> {
  const realRoot = await fs.realpath(vaultRoot);
  let probe = absPath;
  while (true) {
    if (await exists(probe)) {
      const realProbe = await fs.realpath(probe);
      if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) {
        throw forbidden("Vault path resolves outside the company vault.");
      }
      return;
    }
    const parent = path.dirname(probe);
    if (parent === probe) return;
    probe = parent;
  }
}

async function resolveSafeVaultPath(
  vaultRoot: string,
  rawRelPath: string,
  actor: VaultActorRole,
  mode: "read" | "write",
): Promise<{ relPath: string; absPath: string }> {
  const relPath = normalizeVaultRelativePath(rawRelPath);
  if (!relPath) {
    throw unprocessable("Invalid vault path.");
  }
  if (isGitProtectedVaultPath(relPath)) {
    throw forbidden("Git metadata inside the vault is reserved for board version control.");
  }
  if (actor === "agent" && mode === "write" && isAgentForbiddenVaultPath(relPath)) {
    throw forbidden("Agents cannot modify git or Obsidian configuration files in the vault.");
  }
  if (actor === "agent" && isAgentForbiddenVaultPath(relPath)) {
    throw forbidden("Agents cannot access git or Obsidian configuration files in the vault.");
  }
  const absPath = path.resolve(vaultRoot, relPath);
  if (absPath !== vaultRoot && !absPath.startsWith(vaultRoot + path.sep)) {
    throw forbidden("Vault path escapes the company vault.");
  }
  await assertWithinVaultRealpath(vaultRoot, absPath);
  return { relPath, absPath };
}

async function fileIsBoardOnly(absPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile() || stat.size > MAX_READABLE_BYTES) return false;
    const raw = await fs.readFile(absPath, "utf8");
    return parseVaultFrontmatter(raw).boardOnly;
  } catch {
    return false;
  }
}

async function directoryContainsBoardOnly(absDir: string): Promise<boolean> {
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    if (isHiddenVaultSegment(entry.name)) continue;
    const child = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (await directoryContainsBoardOnly(child)) return true;
    } else if (entry.isFile()) {
      if (await fileIsBoardOnly(child)) return true;
    }
  }
  return false;
}

async function assertAgentCanMutate(absPath: string, actor: VaultActorRole): Promise<void> {
  if (actor !== "agent") return;
  if (!(await exists(absPath))) return;
  const stat = await fs.stat(absPath);
  if (stat.isFile() && (await fileIsBoardOnly(absPath))) {
    throw forbidden("This vault file is protected for board edits only (editable_by: board).");
  }
  if (stat.isDirectory() && (await directoryContainsBoardOnly(absPath))) {
    throw forbidden("This folder contains board-only protected vault files.");
  }
}

function starterOverviewCanvas(): CanvasDocument {
  return {
    nodes: [
      {
        id: "group-firm",
        type: "group",
        label: "Firm Knowledge",
        x: -40,
        y: -40,
        width: 780,
        height: 460,
        color: "5",
      },
      {
        id: "node-welcome",
        type: "text",
        text: "# Company Vault\n\nShared knowledge base and whiteboard across all projects and agents.\n\n- Open this folder directly in **Obsidian**.\n- Agents read & update notes autonomously.\n- Version control (`git`) is managed exclusively by the board.",
        x: 0,
        y: 0,
        width: 320,
        height: 190,
        color: "4",
      },
      {
        id: "node-board",
        type: "file",
        file: "BOARD.md",
        x: 380,
        y: 0,
        width: 320,
        height: 170,
        color: "3",
      },
      {
        id: "node-company",
        type: "file",
        file: "COMPANY.md",
        x: 0,
        y: 230,
        width: 320,
        height: 160,
        color: "5",
      },
      {
        id: "node-projects",
        type: "file",
        file: "projects/README.md",
        x: 380,
        y: 230,
        width: 320,
        height: 160,
        color: "6",
      },
    ],
    edges: [
      {
        id: "edge-welcome-board",
        fromNode: "node-welcome",
        fromSide: "right",
        toNode: "node-board",
        toSide: "left",
        label: "Board preferences",
      },
      {
        id: "edge-welcome-company",
        fromNode: "node-welcome",
        fromSide: "bottom",
        toNode: "node-company",
        toSide: "top",
      },
      {
        id: "edge-company-projects",
        fromNode: "node-company",
        fromSide: "right",
        toNode: "node-projects",
        toSide: "left",
        label: "Projects",
      },
    ],
  };
}

export async function ensureCompanyVault(
  companyId: string,
  companyName?: string,
): Promise<string> {
  const vaultRoot = resolveCompanyVaultDir(companyId);
  await fs.mkdir(vaultRoot, { recursive: true });

  const entries = await fs.readdir(vaultRoot);
  const meaningful = entries.filter(
    (name) => !isHiddenVaultSegment(name) && name !== ".gitignore",
  );
  if (meaningful.length > 0) {
    return vaultRoot;
  }

  const label = companyName?.trim() || "Company";
  await fs.mkdir(path.join(vaultRoot, "projects"), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, "decisions"), { recursive: true });

  const starterFiles: Record<string, string> = {
    "INDEX.md": [
      "---",
      "tags: [index, vault]",
      "---",
      "",
      `# ${label} Vault`,
      "",
      "This folder is the shared company knowledge base and whiteboard across all agents and projects.",
      "It is Obsidian-compatible (plain Markdown `.md` and JSON Canvas `.canvas` files).",
      "",
      "## Key Files",
      "- [[BOARD]] — Information about the board (operator), preferences, and priorities.",
      "- [[COMPANY]] — Firm overview, shared conventions, tools, and active initiatives.",
      "- [[projects/README]] — Cross-project summaries, architecture, and links.",
      "- [[decisions/README]] — Durable firm-wide architectural and business decisions.",
      "- `Overview.canvas` — Visual whiteboard connecting key notes.",
      "",
      "## Rules for Agents",
      "1. **Read autonomously**: Check relevant notes here before starting cross-project work or asking the board questions that may already be answered.",
      "2. **Write & update autonomously**: Record durable facts, conventions, project summaries, and decisions you learn. Update existing notes instead of creating duplicates. Keep ephemeral task logs out of the vault.",
      "3. **Respect board-only locks**: Do not edit files with `editable_by: board` in YAML frontmatter.",
      "4. **Never run `git` in this vault**: Version control for the vault is reserved exclusively for the board.",
      "",
    ].join("\n"),
    "BOARD.md": [
      "---",
      "editable_by: board",
      "tags: [board, preferences]",
      "---",
      "",
      "# Board Profile & Preferences",
      "",
      "Information about you (the board) that every agent across the company should know.",
      "",
      "## Communication Style",
      "- Concise, actionable updates.",
      "",
      "## Priorities & Principles",
      "- Add your current company priorities and decision-making principles here.",
      "",
      "## Notes for Agents",
      "- This file is protected (`editable_by: board`) so agents can read it without overwriting your personal notes. Toggle the lock in the Vault UI at any time.",
      "",
    ].join("\n"),
    "COMPANY.md": [
      "---",
      "tags: [company, overview]",
      "---",
      "",
      `# ${label} — Company Overview`,
      "",
      "Shared context relevant across all teams and projects.",
      "",
      "## Mission & Focus",
      "- Summarize what the firm builds and current strategic focus.",
      "",
      "## Shared Conventions & Tools",
      "- Document shared engineering, design, or operational standards here.",
      "",
    ].join("\n"),
    "projects/README.md": [
      "---",
      "tags: [projects]",
      "---",
      "",
      "# Projects Directory",
      "",
      "Add one note per project in this folder (e.g. `projects/my-app.md`) covering its goal, stack, key paths, and cross-project dependencies.",
      "",
    ].join("\n"),
    "decisions/README.md": [
      "---",
      "tags: [decisions]",
      "---",
      "",
      "# Firm-Wide Decisions",
      "",
      "Record durable architectural, product, and operational decisions here so every agent stays aligned.",
      "",
    ].join("\n"),
    "Overview.canvas": stringifyCanvasDocument(starterOverviewCanvas()),
  };

  for (const [relPath, content] of Object.entries(starterFiles)) {
    const abs = path.join(vaultRoot, relPath);
    if (!(await exists(abs))) {
      await fs.writeFile(abs, content, "utf8");
    }
  }

  const gitignorePath = path.join(vaultRoot, ".gitignore");
  if (!(await exists(gitignorePath))) {
    await fs.writeFile(
      gitignorePath,
      [
        "# Obsidian volatile workspace state",
        ".obsidian/workspace.json",
        ".obsidian/workspace-mobile.json",
        ".DS_Store",
        "Thumbs.db",
        "",
      ].join("\n"),
      "utf8",
    );
  }

  return vaultRoot;
}

async function buildTree(
  vaultRoot: string,
  dirAbs: string,
  relPrefix: string,
  counters: { files: number; folders: number },
): Promise<VaultTreeNode[]> {
  const entries = await fs.readdir(dirAbs, { withFileTypes: true });
  const folders: VaultTreeNode[] = [];
  const files: VaultTreeNode[] = [];

  for (const entry of entries) {
    if (isHiddenVaultSegment(entry.name) || entry.name === ".gitignore") continue;
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const absPath = path.join(dirAbs, entry.name);

    if (entry.isDirectory()) {
      counters.folders += 1;
      const children = await buildTree(vaultRoot, absPath, relPath, counters);
      folders.push({
        path: relPath,
        name: entry.name,
        kind: "folder",
        children,
      });
    } else if (entry.isFile()) {
      counters.files += 1;
      const stat = await fs.stat(absPath);
      const fileType = classifyVaultFileType(relPath);
      let boardOnly = false;
      let tags: string[] | undefined;
      if (fileType === "markdown" && stat.size <= MAX_READABLE_BYTES) {
        try {
          const raw = await fs.readFile(absPath, "utf8");
          const fm = parseVaultFrontmatter(raw);
          boardOnly = fm.boardOnly;
          if (fm.tags.length > 0) tags = fm.tags;
        } catch {
          // ignore unreadable metadata
        }
      }
      files.push({
        path: relPath,
        name: entry.name,
        kind: "file",
        fileType,
        sizeBytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
        boardOnly,
        tags,
      });
    }
  }

  const byName = (a: VaultTreeNode, b: VaultTreeNode) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  folders.sort(byName);
  files.sort(byName);
  return [...folders, ...files];
}

async function collectAllFiles(
  dirAbs: string,
  relPrefix = "",
  out: Array<{ relPath: string; absPath: string; name: string }> = [],
): Promise<Array<{ relPath: string; absPath: string; name: string }>> {
  const entries = await fs.readdir(dirAbs, { withFileTypes: true });
  for (const entry of entries) {
    if (isHiddenVaultSegment(entry.name) || entry.name === ".gitignore") continue;
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const absPath = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      await collectAllFiles(absPath, relPath, out);
    } else if (entry.isFile()) {
      out.push({ relPath, absPath, name: entry.name });
    }
  }
  return out;
}

function stripMarkdownExt(value: string): string {
  return value.replace(/\.(md|markdown)$/i, "");
}

function wikilinkTargetsMatch(linkTarget: string, targetRelPath: string): boolean {
  const normalizedTarget = linkTarget.trim().replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  if (!normalizedTarget) return false;
  const fullLower = targetRelPath.toLowerCase();
  const fullNoExt = stripMarkdownExt(fullLower);
  const baseLower = path.posix.basename(fullLower);
  const baseNoExt = stripMarkdownExt(baseLower);
  return (
    normalizedTarget === fullLower ||
    normalizedTarget === fullNoExt ||
    normalizedTarget === baseLower ||
    normalizedTarget === baseNoExt
  );
}

async function findBacklinks(vaultRoot: string, targetRelPath: string): Promise<VaultBacklink[]> {
  const allFiles = await collectAllFiles(vaultRoot);
  const backlinks: VaultBacklink[] = [];

  for (const file of allFiles) {
    if (file.relPath === targetRelPath) continue;
    const fileType = classifyVaultFileType(file.relPath);
    if (fileType !== "markdown" && fileType !== "canvas") continue;
    try {
      const stat = await fs.stat(file.absPath);
      if (stat.size > MAX_READABLE_BYTES) continue;
      const content = await fs.readFile(file.absPath, "utf8");

      if (fileType === "markdown") {
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          WIKILINK_RE.lastIndex = 0;
          let match: RegExpExecArray | null;
          let matchedLine = false;
          while ((match = WIKILINK_RE.exec(lines[i])) !== null) {
            if (wikilinkTargetsMatch(match[1], targetRelPath)) {
              matchedLine = true;
              break;
            }
          }
          if (matchedLine) {
            backlinks.push({
              sourcePath: file.relPath,
              sourceName: file.name,
              line: i + 1,
              snippet: lines[i].trim().slice(0, 160),
            });
          }
        }
      } else if (fileType === "canvas") {
        try {
          const canvas = parseCanvasDocument(content);
          const matchingNode = canvas.nodes.find(
            (node) => node.type === "file" && wikilinkTargetsMatch(node.file, targetRelPath),
          );
          if (matchingNode) {
            backlinks.push({
              sourcePath: file.relPath,
              sourceName: file.name,
              line: 1,
              snippet: `Embedded on canvas (${file.name})`,
            });
          }
        } catch {
          // ignore malformed canvas while computing backlinks
        }
      }
    } catch {
      // ignore unreadable file
    }
  }

  return backlinks;
}

export function vaultService() {
  return {
    async getIndex(companyId: string, companyName?: string): Promise<VaultIndexResponse> {
      const vaultRoot = await ensureCompanyVault(companyId, companyName);
      const counters = { files: 0, folders: 0 };
      const tree = await buildTree(vaultRoot, vaultRoot, "", counters);
      return {
        info: {
          companyId,
          vaultPath: vaultRoot,
          gitAllowedForAgents: false,
          totalFiles: counters.files,
          totalFolders: counters.folders,
        },
        tree,
      };
    },

    async readFile(
      companyId: string,
      rawRelPath: string,
      actor: VaultActorRole,
      companyName?: string,
    ): Promise<VaultDocument> {
      const vaultRoot = await ensureCompanyVault(companyId, companyName);
      const { relPath, absPath } = await resolveSafeVaultPath(vaultRoot, rawRelPath, actor, "read");
      let stat;
      try {
        stat = await fs.stat(absPath);
      } catch {
        throw notFound(`Vault file not found: ${relPath}`);
      }
      if (!stat.isFile()) {
        throw unprocessable(`Vault path is not a file: ${relPath}`);
      }
      if (stat.size > MAX_READABLE_BYTES) {
        throw unprocessable("Vault file exceeds the 2 MB inline read limit.");
      }
      const content = await fs.readFile(absPath, "utf8");
      const fileType = classifyVaultFileType(relPath);
      const fm = fileType === "markdown" ? parseVaultFrontmatter(content) : { boardOnly: false, tags: [] };
      const backlinks = await findBacklinks(vaultRoot, relPath);
      return {
        path: relPath,
        name: path.posix.basename(relPath),
        fileType,
        content,
        hash: sha256(content),
        sizeBytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
        boardOnly: fm.boardOnly,
        tags: fm.tags,
        backlinks,
      };
    },

    async writeFile(
      companyId: string,
      input: { path: string; content: string; expectedHash?: string },
      actor: VaultActorRole,
      companyName?: string,
    ): Promise<{ document: VaultDocument; created: boolean }> {
      const vaultRoot = await ensureCompanyVault(companyId, companyName);
      const { relPath, absPath } = await resolveSafeVaultPath(vaultRoot, input.path, actor, "write");
      await assertAgentCanMutate(absPath, actor);

      const fileType = classifyVaultFileType(relPath);
      if (fileType === "canvas") {
        try {
          parseCanvasDocument(input.content);
        } catch (err) {
          throw unprocessable(
            `Invalid JSON Canvas format: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (actor === "agent" && fileType === "markdown" && parseVaultFrontmatter(input.content).boardOnly) {
        throw forbidden("Only the board can set board-only protection on vault files.");
      }

      const existed = await exists(absPath);
      if (existed) {
        const stat = await fs.stat(absPath);
        if (!stat.isFile()) {
          throw conflict(`A folder already exists at ${relPath}.`);
        }
        if (input.expectedHash) {
          const current = await fs.readFile(absPath, "utf8");
          const currentHash = sha256(current);
          if (currentHash !== input.expectedHash) {
            throw conflict("File was modified outside your editor. Reload or overwrite.", {
              currentHash,
            });
          }
        }
      }

      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await assertWithinVaultRealpath(vaultRoot, absPath);
      await fs.writeFile(absPath, input.content, "utf8");

      const document = await this.readFile(companyId, relPath, actor, companyName);
      return { document, created: !existed };
    },

    async createFolder(
      companyId: string,
      rawRelPath: string,
      actor: VaultActorRole,
      companyName?: string,
    ): Promise<{ path: string }> {
      const vaultRoot = await ensureCompanyVault(companyId, companyName);
      const { relPath, absPath } = await resolveSafeVaultPath(vaultRoot, rawRelPath, actor, "write");
      if (await exists(absPath)) {
        const stat = await fs.stat(absPath);
        if (!stat.isDirectory()) {
          throw conflict(`A file already exists at ${relPath}.`);
        }
      }
      await fs.mkdir(absPath, { recursive: true });
      return { path: relPath };
    },

    async renameEntry(
      companyId: string,
      fromRaw: string,
      toRaw: string,
      actor: VaultActorRole,
      companyName?: string,
    ): Promise<{ fromPath: string; toPath: string }> {
      const vaultRoot = await ensureCompanyVault(companyId, companyName);
      const from = await resolveSafeVaultPath(vaultRoot, fromRaw, actor, "write");
      const to = await resolveSafeVaultPath(vaultRoot, toRaw, actor, "write");
      if (!(await exists(from.absPath))) {
        throw notFound(`Vault entry not found: ${from.relPath}`);
      }
      await assertAgentCanMutate(from.absPath, actor);
      await assertAgentCanMutate(to.absPath, actor);
      if (await exists(to.absPath)) {
        throw conflict(`Target path already exists: ${to.relPath}`);
      }
      await fs.mkdir(path.dirname(to.absPath), { recursive: true });
      await fs.rename(from.absPath, to.absPath);
      return { fromPath: from.relPath, toPath: to.relPath };
    },

    async deleteEntry(
      companyId: string,
      rawRelPath: string,
      actor: VaultActorRole,
      companyName?: string,
    ): Promise<{ path: string; kind: "file" | "folder" }> {
      const vaultRoot = await ensureCompanyVault(companyId, companyName);
      const { relPath, absPath } = await resolveSafeVaultPath(vaultRoot, rawRelPath, actor, "write");
      if (!(await exists(absPath))) {
        throw notFound(`Vault entry not found: ${relPath}`);
      }
      await assertAgentCanMutate(absPath, actor);
      const stat = await fs.stat(absPath);
      if (stat.isDirectory()) {
        await fs.rm(absPath, { recursive: true, force: false });
        return { path: relPath, kind: "folder" };
      }
      await fs.unlink(absPath);
      return { path: relPath, kind: "file" };
    },

    async search(
      companyId: string,
      query: string,
      actor: VaultActorRole,
      companyName?: string,
    ): Promise<VaultSearchMatch[]> {
      const trimmed = query.trim();
      if (!trimmed) return [];
      const needle = trimmed.toLowerCase();
      const vaultRoot = await ensureCompanyVault(companyId, companyName);
      const allFiles = await collectAllFiles(vaultRoot);
      const matches: VaultSearchMatch[] = [];

      for (const file of allFiles) {
        if (matches.length >= MAX_SEARCH_RESULTS) break;
        if (actor === "agent" && isAgentForbiddenVaultPath(file.relPath)) continue;
        const fileType = classifyVaultFileType(file.relPath);

        if (file.relPath.toLowerCase().includes(needle)) {
          matches.push({
            path: file.relPath,
            name: file.name,
            fileType,
            line: 0,
            snippet: file.relPath,
          });
        }

        if (fileType === "other") continue;
        try {
          const stat = await fs.stat(file.absPath);
          if (stat.size > MAX_READABLE_BYTES) continue;
          const content = await fs.readFile(file.absPath, "utf8");
          const lines = content.split(/\r?\n/);
          let fileLineMatches = 0;
          for (let i = 0; i < lines.length; i += 1) {
            if (lines[i].toLowerCase().includes(needle)) {
              matches.push({
                path: file.relPath,
                name: file.name,
                fileType,
                line: i + 1,
                snippet: lines[i].trim().slice(0, 180),
              });
              fileLineMatches += 1;
              if (fileLineMatches >= 3 || matches.length >= MAX_SEARCH_RESULTS) break;
            }
          }
        } catch {
          // skip unreadable files
        }
      }

      return matches;
    },
  };
}
