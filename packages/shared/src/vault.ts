// fork 31erGER: shared contracts, validators, and helpers for the Company Vault
// (Obsidian-compatible .md notes and JSON Canvas 1.0 .canvas whiteboards).
import { z } from "zod";

export type VaultEntryKind = "file" | "folder";
export type VaultFileType = "markdown" | "canvas" | "text" | "other";

export interface VaultTreeNode {
  path: string;
  name: string;
  kind: VaultEntryKind;
  fileType?: VaultFileType;
  sizeBytes?: number;
  updatedAt?: string;
  boardOnly?: boolean;
  tags?: string[];
  children?: VaultTreeNode[];
}

export interface VaultBacklink {
  sourcePath: string;
  sourceName: string;
  line: number;
  snippet: string;
}

export interface VaultDocument {
  path: string;
  name: string;
  fileType: VaultFileType;
  content: string;
  hash: string;
  sizeBytes: number;
  updatedAt: string;
  boardOnly: boolean;
  tags: string[];
  backlinks: VaultBacklink[];
}

export interface VaultSearchMatch {
  path: string;
  name: string;
  fileType: VaultFileType;
  line: number;
  snippet: string;
}

export interface VaultInfo {
  companyId: string;
  vaultPath: string;
  gitAllowedForAgents: false;
  totalFiles: number;
  totalFolders: number;
}

export interface VaultIndexResponse {
  info: VaultInfo;
  tree: VaultTreeNode[];
}

// ---------------------------------------------------------------------------
// JSON Canvas 1.0 (Obsidian .canvas specification)
// ---------------------------------------------------------------------------

export const CANVAS_SIDES = ["top", "right", "bottom", "left"] as const;
export type CanvasSide = (typeof CANVAS_SIDES)[number];

export const CANVAS_ENDS = ["none", "arrow"] as const;
export type CanvasEnd = (typeof CANVAS_ENDS)[number];

const canvasNodeBaseSchema = z.object({
  id: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  color: z.string().optional(),
});

export const canvasTextNodeSchema = canvasNodeBaseSchema.extend({
  type: z.literal("text"),
  text: z.string(),
});

export const canvasFileNodeSchema = canvasNodeBaseSchema.extend({
  type: z.literal("file"),
  file: z.string().min(1),
  subpath: z.string().optional(),
});

export const canvasLinkNodeSchema = canvasNodeBaseSchema.extend({
  type: z.literal("link"),
  url: z.string().min(1),
});

export const canvasGroupNodeSchema = canvasNodeBaseSchema.extend({
  type: z.literal("group"),
  label: z.string().optional(),
  background: z.string().optional(),
  backgroundStyle: z.enum(["cover", "ratio", "repeat"]).optional(),
});

export const canvasNodeSchema = z.discriminatedUnion("type", [
  canvasTextNodeSchema,
  canvasFileNodeSchema,
  canvasLinkNodeSchema,
  canvasGroupNodeSchema,
]);

export const canvasEdgeSchema = z.object({
  id: z.string().min(1),
  fromNode: z.string().min(1),
  fromSide: z.enum(CANVAS_SIDES).optional(),
  fromEnd: z.enum(CANVAS_ENDS).optional(),
  toNode: z.string().min(1),
  toSide: z.enum(CANVAS_SIDES).optional(),
  toEnd: z.enum(CANVAS_ENDS).optional(),
  color: z.string().optional(),
  label: z.string().optional(),
});

export const canvasDocumentSchema = z.object({
  nodes: z.array(canvasNodeSchema).default([]),
  edges: z.array(canvasEdgeSchema).default([]),
});

export type CanvasTextNode = z.infer<typeof canvasTextNodeSchema>;
export type CanvasFileNode = z.infer<typeof canvasFileNodeSchema>;
export type CanvasLinkNode = z.infer<typeof canvasLinkNodeSchema>;
export type CanvasGroupNode = z.infer<typeof canvasGroupNodeSchema>;
export type CanvasNode = z.infer<typeof canvasNodeSchema>;
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;
export type CanvasDocument = z.infer<typeof canvasDocumentSchema>;

export function parseCanvasDocument(raw: string): CanvasDocument {
  if (!raw.trim()) return { nodes: [], edges: [] };
  const parsed: unknown = JSON.parse(raw);
  return canvasDocumentSchema.parse(parsed);
}

export function stringifyCanvasDocument(doc: CanvasDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Request validators
// ---------------------------------------------------------------------------

export const vaultWriteFileSchema = z.object({
  path: z.string().min(1).max(512),
  content: z.string().max(2 * 1024 * 1024),
  expectedHash: z.string().optional(),
});

export const vaultCreateFolderSchema = z.object({
  path: z.string().min(1).max(512),
});

export const vaultRenameSchema = z.object({
  fromPath: z.string().min(1).max(512),
  toPath: z.string().min(1).max(512),
});

export type VaultWriteFileInput = z.infer<typeof vaultWriteFileSchema>;
export type VaultCreateFolderInput = z.infer<typeof vaultCreateFolderSchema>;
export type VaultRenameInput = z.infer<typeof vaultRenameSchema>;

// ---------------------------------------------------------------------------
// Path safety & git-protection helpers
// ---------------------------------------------------------------------------

const GIT_FORBIDDEN_SEGMENTS = new Set([
  ".git",
  ".gitmodules",
  ".gitattributes",
]);

const AGENT_FORBIDDEN_SEGMENTS = new Set([
  ...GIT_FORBIDDEN_SEGMENTS,
  ".gitignore",
  ".obsidian",
]);

export function normalizeVaultRelativePath(rawPath: string): string | null {
  if (!rawPath || rawPath.includes("\0")) return null;
  const slashNormalized = rawPath.replace(/\\/g, "/").trim();
  if (!slashNormalized || slashNormalized.startsWith("/") || /^[a-zA-Z]:/.test(slashNormalized)) {
    return null;
  }
  const parts = slashNormalized.split("/").filter((part) => part.length > 0 && part !== ".");
  if (parts.length === 0) return null;
  for (const part of parts) {
    if (part === ".." || part.includes("\0")) return null;
  }
  return parts.join("/");
}

export function isGitProtectedVaultPath(relPath: string): boolean {
  const normalized = normalizeVaultRelativePath(relPath);
  if (!normalized) return true;
  return normalized.split("/").some((segment) => GIT_FORBIDDEN_SEGMENTS.has(segment.toLowerCase()));
}

export function isAgentForbiddenVaultPath(relPath: string): boolean {
  const normalized = normalizeVaultRelativePath(relPath);
  if (!normalized) return true;
  return normalized.split("/").some((segment) => AGENT_FORBIDDEN_SEGMENTS.has(segment.toLowerCase()));
}

export function isHiddenVaultSegment(segment: string): boolean {
  const lower = segment.toLowerCase();
  return lower === ".git" || lower === ".obsidian" || lower === ".ds_store" || lower === ".trash";
}

export function classifyVaultFileType(filePath: string): VaultFileType {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".canvas")) return "canvas";
  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".json") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".toml")
  ) {
    return "text";
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Frontmatter metadata (board-only locks & tags)
// ---------------------------------------------------------------------------

export interface VaultFrontmatter {
  boardOnly: boolean;
  tags: string[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function parseVaultFrontmatter(content: string): VaultFrontmatter {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return { boardOnly: false, tags: [] };
  const block = match[1];
  let boardOnly = false;
  const tags: string[] = [];

  const lines = block.split(/\r?\n/);
  let inTagsList = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (inTagsList) {
      if (line.startsWith("- ")) {
        const tag = line.slice(2).trim().replace(/^["']|["']$/g, "");
        if (tag) tags.push(tag);
        continue;
      }
      inTagsList = false;
    }

    const kv = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2].trim().replace(/^["']|["']$/g, "");

    if (key === "editable_by" && value.toLowerCase() === "board") {
      boardOnly = true;
    } else if (
      (key === "readonly_for_agents" || key === "locked" || key === "board_only") &&
      value.toLowerCase() === "true"
    ) {
      boardOnly = true;
    } else if (key === "tags") {
      if (!value) {
        inTagsList = true;
      } else if (value.startsWith("[") && value.endsWith("]")) {
        for (const item of value.slice(1, -1).split(",")) {
          const cleaned = item.trim().replace(/^["']|["']$/g, "");
          if (cleaned) tags.push(cleaned);
        }
      } else {
        for (const item of value.split(/[,\s]+/)) {
          const cleaned = item.trim().replace(/^#/, "");
          if (cleaned) tags.push(cleaned);
        }
      }
    }
  }

  return { boardOnly, tags: [...new Set(tags)] };
}

export function toggleBoardOnlyFrontmatter(content: string, boardOnly: boolean): string {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) {
    if (!boardOnly) return content;
    return `---\neditable_by: board\n---\n\n${content}`;
  }
  const fullMatch = match[0];
  const block = match[1];
  const rest = content.slice(fullMatch.length);
  const filteredLines = block
    .split(/\r?\n/)
    .filter((line) => !/^\s*(editable_by|readonly_for_agents|locked|board_only)\s*:/i.test(line));

  if (boardOnly) {
    filteredLines.unshift("editable_by: board");
  }

  const nonEmpty = filteredLines.some((line) => line.trim().length > 0);
  if (!nonEmpty) {
    return rest.replace(/^\r?\n/, "");
  }
  return `---\n${filteredLines.join("\n")}\n---\n${rest}`;
}
