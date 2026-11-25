// fork 31erGER: Markdown editor & live preview with [[wikilinks]], backlinks, and board-only lock.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Columns2,
  Eye,
  Link2,
  Lock,
  Pencil,
  RefreshCw,
  Save,
  Unlock,
} from "lucide-react";
import {
  parseVaultFrontmatter,
  toggleBoardOnlyFrontmatter,
  type VaultDocument,
} from "@paperclipai/shared";
import { MarkdownBody } from "@/components/MarkdownBody";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ViewMode = "edit" | "split" | "preview";

const WIKILINK_RENDER_RE = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
const VAULT_LINK_PREFIX = "vault-note://";

function stripFrontmatterForPreview(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function resolveWikilinkTarget(target: string, allFilePaths: string[]): string {
  const cleaned = target.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const lower = cleaned.toLowerCase();
  const exact = allFilePaths.find((p) => {
    const pLower = p.toLowerCase();
    const pNoExt = pLower.replace(/\.(md|markdown)$/i, "");
    const base = pLower.split("/").pop() ?? pLower;
    const baseNoExt = base.replace(/\.(md|markdown)$/i, "");
    return lower === pLower || lower === pNoExt || lower === base || lower === baseNoExt;
  });
  if (exact) return exact;
  return /\.[a-z0-9]+$/i.test(cleaned) ? cleaned : `${cleaned}.md`;
}

function preprocessWikilinks(markdown: string, allFilePaths: string[]): string {
  return markdown.replace(
    WIKILINK_RENDER_RE,
    (_full, rawTarget: string, heading?: string, alias?: string) => {
      const resolved = resolveWikilinkTarget(rawTarget, allFilePaths);
      const label = alias?.trim() || (heading ? `${rawTarget} › ${heading}` : rawTarget);
      return `[${label}](${VAULT_LINK_PREFIX}${encodeURIComponent(resolved)})`;
    },
  );
}

export interface VaultMarkdownEditorProps {
  document: VaultDocument;
  allFilePaths: string[];
  saving: boolean;
  conflictMessage: string | null;
  saveError: string | null;
  onSave: (content: string, forceOverwrite?: boolean) => Promise<void>;
  onReload: () => void;
  onOpenFile: (path: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function VaultMarkdownEditor({
  document,
  allFilePaths,
  saving,
  conflictMessage,
  saveError,
  onSave,
  onReload,
  onOpenFile,
  onDirtyChange,
}: VaultMarkdownEditorProps) {
  const [draft, setDraft] = useState(document.content);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [backlinksOpen, setBacklinksOpen] = useState(true);

  useEffect(() => {
    setDraft(document.content);
  }, [document.path, document.hash, document.content]);

  const isDirty = draft !== document.content;
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const frontmatter = useMemo(() => parseVaultFrontmatter(draft), [draft]);

  const handleSave = useCallback(
    async (forceOverwrite = false) => {
      if (saving || (!isDirty && !forceOverwrite)) return;
      await onSave(draft, forceOverwrite);
    },
    [draft, isDirty, onSave, saving],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  const previewMarkdown = useMemo(() => {
    const body = stripFrontmatterForPreview(draft);
    return preprocessWikilinks(body, allFilePaths);
  }, [draft, allFilePaths]);

  function handleToggleBoardOnly() {
    const next = toggleBoardOnlyFrontmatter(draft, !frontmatter.boardOnly);
    setDraft(next);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Header toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-mono text-sm font-medium text-foreground">
            {document.path}
          </span>
          {isDirty && (
            <Badge variant="outline" className="shrink-0 text-xs">
              Unsaved
            </Badge>
          )}
          {frontmatter.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="hidden shrink-0 text-xs sm:inline-flex">
              #{tag}
            </Badge>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {document.fileType === "markdown" && (
            <Button
              type="button"
              variant={frontmatter.boardOnly ? "secondary" : "ghost"}
              size="sm"
              onClick={handleToggleBoardOnly}
              title={
                frontmatter.boardOnly
                  ? "Board-only protected: agents can read, only you can edit. Click to unlock for agents."
                  : "Editable by agents and board. Click to lock for board-only edits."
              }
              className="gap-1.5 text-xs"
            >
              {frontmatter.boardOnly ? (
                <>
                  <Lock className="size-3.5 text-(--status-agent-paused)" />
                  <span>Board-only</span>
                </>
              ) : (
                <>
                  <Unlock className="size-3.5 text-muted-foreground" />
                  <span>Agents can edit</span>
                </>
              )}
            </Button>
          )}

          <div
            role="group"
            aria-label="Editor view mode"
            className="flex items-center rounded-md border border-border p-0.5"
          >
            <Button
              type="button"
              variant={viewMode === "edit" ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setViewMode("edit")}
              aria-pressed={viewMode === "edit"}
              className="gap-1"
            >
              <Pencil className="size-3" />
              <span className="hidden sm:inline">Edit</span>
            </Button>
            <Button
              type="button"
              variant={viewMode === "split" ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setViewMode("split")}
              aria-pressed={viewMode === "split"}
              className="gap-1"
            >
              <Columns2 className="size-3" />
              <span className="hidden sm:inline">Split</span>
            </Button>
            <Button
              type="button"
              variant={viewMode === "preview" ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setViewMode("preview")}
              aria-pressed={viewMode === "preview"}
              className="gap-1"
            >
              <Eye className="size-3" />
              <span className="hidden sm:inline">Preview</span>
            </Button>
          </div>

          <Button
            type="button"
            size="sm"
            onClick={() => void handleSave(false)}
            disabled={saving || !isDirty}
            className="gap-1.5"
          >
            <Save className="size-3.5" />
            <span>{saving ? "Saving…" : "Save"}</span>
          </Button>
        </div>
      </div>

      {/* Conflict or error banner */}
      {conflictMessage && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/60 px-4 py-2 text-xs"
        >
          <span className="flex items-center gap-2 text-foreground">
            <AlertTriangle className="size-4 shrink-0 text-(--status-agent-paused)" />
            <span>{conflictMessage}</span>
          </span>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="xs" onClick={onReload} className="gap-1">
              <RefreshCw className="size-3" />
              <span>Reload from disk</span>
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              onClick={() => void handleSave(true)}
            >
              Overwrite anyway
            </Button>
          </div>
        </div>
      )}

      {saveError && !conflictMessage && (
        <div
          role="alert"
          className="shrink-0 border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive"
        >
          {saveError}
        </div>
      )}

      {/* Editor + Preview panes */}
      <div
        className={cn(
          "grid min-h-0 flex-1",
          viewMode === "split" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1",
        )}
      >
        {(viewMode === "edit" || viewMode === "split") && (
          <div
            className={cn(
              "flex min-h-0 flex-col",
              viewMode === "split" && "border-b border-border lg:border-b-0 lg:border-r",
            )}
          >
            <textarea
              aria-label={`Edit ${document.path}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
              className="h-full min-h-0 w-full flex-1 resize-none bg-background p-4 font-mono text-sm leading-relaxed text-foreground focus:outline-none"
            />
          </div>
        )}

        {(viewMode === "preview" || viewMode === "split") && (
          <div
            className="scrollbar-auto-hide min-h-0 overflow-y-auto p-6"
            onClick={(event) => {
              const anchor = (event.target as HTMLElement | null)?.closest("a");
              const href = anchor?.getAttribute("href");
              if (href && href.startsWith(VAULT_LINK_PREFIX)) {
                event.preventDefault();
                const targetPath = decodeURIComponent(href.slice(VAULT_LINK_PREFIX.length));
                onOpenFile(targetPath);
              }
            }}
          >
            <div className="mx-auto max-w-3xl">
              <MarkdownBody>{previewMarkdown}</MarkdownBody>
            </div>
          </div>
        )}
      </div>

      {/* Backlinks footer */}
      <div className="shrink-0 border-t border-border bg-muted/20 px-4 py-2">
        <button
          type="button"
          onClick={() => setBacklinksOpen((open) => !open)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Link2 className="size-3.5" />
          <span>Backlinks ({document.backlinks.length})</span>
        </button>
        {backlinksOpen && document.backlinks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {document.backlinks.map((bl, idx) => (
              <button
                key={`${bl.sourcePath}:${bl.line}:${idx}`}
                type="button"
                onClick={() => onOpenFile(bl.sourcePath)}
                title={bl.snippet}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent"
              >
                <span className="font-mono">{bl.sourcePath}</span>
                {bl.line > 0 && (
                  <span className="text-muted-foreground">L{bl.line}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
