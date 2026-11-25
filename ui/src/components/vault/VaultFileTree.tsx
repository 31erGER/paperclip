// fork 31erGER: File browser, search, and Obsidian path panel for the Company Vault.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  File,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutDashboard,
  Lock,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { VaultInfo, VaultTreeNode } from "@paperclipai/shared";
import { vaultApi } from "@/api/vault";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface VaultFileTreeProps {
  companyId: string;
  info?: VaultInfo;
  tree: VaultTreeNode[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onCreateFile: (path: string, kind: "markdown" | "canvas") => Promise<void>;
  onCreateFolder: (path: string) => Promise<void>;
  onRenameEntry: (fromPath: string, toPath: string) => Promise<void>;
  onDeleteEntry: (path: string) => Promise<void>;
  onRefresh: () => void;
  refreshing?: boolean;
}

type ModalState =
  | null
  | { kind: "new-note" | "new-canvas" | "new-folder"; prefix: string }
  | { kind: "rename"; node: VaultTreeNode }
  | { kind: "delete"; node: VaultTreeNode };

function collectFolderPaths(nodes: VaultTreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === "folder") {
      out.push(node.path);
      if (node.children) collectFolderPaths(node.children, out);
    }
  }
  return out;
}

function fileIconFor(node: VaultTreeNode) {
  if (node.fileType === "canvas") {
    return <LayoutDashboard className="size-4 shrink-0 text-primary" aria-hidden />;
  }
  if (node.fileType === "markdown") {
    return <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
  }
  return <File className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

export function VaultFileTree({
  companyId,
  info,
  tree,
  selectedPath,
  onSelectFile,
  onCreateFile,
  onCreateFolder,
  onRenameEntry,
  onDeleteEntry,
  onRefresh,
  refreshing = false,
}: VaultFileTreeProps) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["projects", "decisions"]));
  const [modal, setModal] = useState<ModalState>(null);
  const [draftName, setDraftName] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);

  const allFolders = useMemo(() => collectFolderPaths(tree), [tree]);
  useEffect(() => {
    if (!selectedPath || !selectedPath.includes("/")) return;
    const parts = selectedPath.split("/").slice(0, -1);
    setExpanded((prev) => {
      const next = new Set(prev);
      let acc = "";
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part;
        next.add(acc);
      }
      return next;
    });
  }, [selectedPath]);

  const trimmedQuery = search.trim();
  const searchQuery = useQuery({
    queryKey: queryKeys.vault.search(companyId, trimmedQuery),
    queryFn: () => vaultApi.search(companyId, trimmedQuery),
    enabled: Boolean(companyId && trimmedQuery.length > 0),
  });

  function openModal(next: NonNullable<ModalState>) {
    setModalError(null);
    if (next.kind === "rename") {
      setDraftName(next.node.path);
    } else if (next.kind === "new-note") {
      setDraftName(next.prefix ? `${next.prefix}/` : "");
    } else if (next.kind === "new-canvas") {
      setDraftName(next.prefix ? `${next.prefix}/` : "");
    } else if (next.kind === "new-folder") {
      setDraftName(next.prefix ? `${next.prefix}/` : "");
    } else {
      setDraftName("");
    }
    setModal(next);
  }

  async function handleModalSubmit() {
    if (!modal || submitting) return;
    setModalError(null);
    setSubmitting(true);
    try {
      if (modal.kind === "delete") {
        await onDeleteEntry(modal.node.path);
        setModal(null);
        return;
      }
      const trimmed = draftName.trim().replace(/^\/+|\/+$/g, "");
      if (!trimmed) {
        setModalError("Please enter a path.");
        return;
      }
      if (modal.kind === "new-note") {
        const finalPath = /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
        await onCreateFile(finalPath, "markdown");
      } else if (modal.kind === "new-canvas") {
        const finalPath = trimmed.toLowerCase().endsWith(".canvas")
          ? trimmed
          : `${trimmed}.canvas`;
        await onCreateFile(finalPath, "canvas");
      } else if (modal.kind === "new-folder") {
        await onCreateFolder(trimmed);
        setExpanded((prev) => new Set(prev).add(trimmed));
      } else if (modal.kind === "rename") {
        if (trimmed !== modal.node.path) {
          await onRenameEntry(modal.node.path, trimmed);
        }
      }
      setModal(null);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleFolder(folderPath: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }

  async function copyVaultPath() {
    if (!info?.vaultPath) return;
    try {
      await navigator.clipboard.writeText(info.vaultPath);
      setCopiedPath(true);
      window.setTimeout(() => setCopiedPath(false), 1800);
    } catch {
      // clipboard unavailable
    }
  }

  function renderNodes(nodes: VaultTreeNode[], depth: number) {
    return nodes.map((node) => {
      const isFolder = node.kind === "folder";
      const isOpen = isFolder && expanded.has(node.path);
      const isSelected = !isFolder && selectedPath === node.path;

      return (
        <div key={node.path}>
          <div
            className={cn(
              "group/vault-row relative flex items-center gap-1 rounded-md pr-7 transition-colors",
              isSelected
                ? "bg-accent text-accent-foreground"
                : "text-foreground/85 hover:bg-accent/60",
            )}
            style={{ paddingLeft: `${depth * 14 + 6}px` }}
          >
            <button
              type="button"
              onClick={() => (isFolder ? toggleFolder(node.path) : onSelectFile(node.path))}
              className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={node.boardOnly ? `${node.path} (Board-only protected)` : node.path}
            >
              {isFolder ? (
                <>
                  {isOpen ? (
                    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  {isOpen ? (
                    <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                </>
              ) : (
                <>
                  <span className="w-3.5 shrink-0" aria-hidden />
                  {fileIconFor(node)}
                </>
              )}
              <span className="truncate font-medium">{node.name}</span>
              {node.boardOnly && (
                <Lock
                  className="ml-auto size-3 shrink-0 text-(--status-agent-paused)"
                  aria-label="Board-only protected"
                />
              )}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Actions for ${node.name}`}
                  className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/vault-row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {isFolder && (
                  <>
                    <DropdownMenuItem
                      onClick={() => openModal({ kind: "new-note", prefix: node.path })}
                    >
                      <FilePlus className="size-3.5" />
                      <span>New note here</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => openModal({ kind: "new-canvas", prefix: node.path })}
                    >
                      <LayoutDashboard className="size-3.5" />
                      <span>New canvas here</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => openModal({ kind: "new-folder", prefix: node.path })}
                    >
                      <FolderPlus className="size-3.5" />
                      <span>New subfolder</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={() => openModal({ kind: "rename", node })}>
                  <Pencil className="size-3.5" />
                  <span>Rename / move</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => openModal({ kind: "delete", node })}
                >
                  <Trash2 className="size-3.5" />
                  <span>Delete</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {isFolder && isOpen && node.children && node.children.length > 0 && (
            <div className="flex flex-col gap-0.5">{renderNodes(node.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  }

  return (
    <aside
      aria-label="Vault files"
      className="flex h-full min-h-0 flex-col border-r border-border bg-background"
    >
      <div className="flex shrink-0 items-center justify-between gap-1 border-b border-border px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Vault
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title="New Markdown note"
            aria-label="New Markdown note"
            onClick={() => openModal({ kind: "new-note", prefix: "" })}
          >
            <FilePlus className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title="New Canvas whiteboard"
            aria-label="New Canvas whiteboard"
            onClick={() => openModal({ kind: "new-canvas", prefix: "" })}
          >
            <LayoutDashboard className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title="New folder"
            aria-label="New folder"
            onClick={() => openModal({ kind: "new-folder", prefix: "" })}
          >
            <FolderPlus className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title="Refresh vault files"
            aria-label="Refresh vault files"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={cn("size-3.5", refreshing && "motion-safe:animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="shrink-0 px-2.5 py-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="Search vault"
            placeholder="Search notes & canvases…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSearch("");
            }}
            className="h-8 pl-8 pr-7 text-xs"
          />
          {search && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Clear vault search"
              onClick={() => setSearch("")}
              className="absolute right-1 top-1/2 -translate-y-1/2"
            >
              <X className="size-3" />
            </Button>
          )}
        </div>
      </div>

      <div className="scrollbar-auto-hide min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {trimmedQuery ? (
          <div className="flex flex-col gap-1">
            {searchQuery.isPending ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">Searching…</p>
            ) : searchQuery.data?.matches.length ? (
              searchQuery.data.matches.map((match, idx) => (
                <button
                  key={`${match.path}:${match.line}:${idx}`}
                  type="button"
                  onClick={() => onSelectFile(match.path)}
                  className={cn(
                    "flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/60",
                    selectedPath === match.path && "bg-accent text-accent-foreground",
                  )}
                >
                  <span className="flex items-center justify-between gap-2 text-xs font-medium">
                    <span className="truncate">{match.path}</span>
                    {match.line > 0 && (
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        L{match.line}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{match.snippet}</span>
                </button>
              ))
            ) : (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No matches for “{trimmedQuery}”.
              </p>
            )}
          </div>
        ) : tree.length > 0 ? (
          <nav aria-label="Vault directory tree" className="flex flex-col gap-0.5">
            {renderNodes(tree, 0)}
          </nav>
        ) : (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            Vault is empty. Create a note or canvas above.
          </p>
        )}
      </div>

      {info && (
        <div className="shrink-0 border-t border-border bg-muted/30 px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">Obsidian folder</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-6 gap-1 px-1.5 text-xs"
              onClick={copyVaultPath}
              title="Copy local folder path to open in Obsidian"
            >
              {copiedPath ? <Check className="size-3" /> : <Copy className="size-3" />}
              <span>{copiedPath ? "Copied" : "Copy"}</span>
            </Button>
          </div>
          <p
            className="mt-1 truncate font-mono text-xs text-muted-foreground"
            title={info.vaultPath}
          >
            {info.vaultPath}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {info.totalFiles} files · {allFolders.length} folders · Git reserved for board
          </p>
        </div>
      )}

      <Dialog open={modal !== null} onOpenChange={(open) => !open && setModal(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {modal?.kind === "new-note" && "Create Markdown note"}
              {modal?.kind === "new-canvas" && "Create Obsidian canvas"}
              {modal?.kind === "new-folder" && "Create folder"}
              {modal?.kind === "rename" && `Rename ${modal.node.name}`}
              {modal?.kind === "delete" && `Delete ${modal.node.name}?`}
            </DialogTitle>
          </DialogHeader>

          {modal?.kind === "delete" ? (
            <p className="text-sm text-muted-foreground">
              Permanently remove <span className="font-mono text-foreground">{modal.node.path}</span>
              {modal.node.kind === "folder" ? " and all files inside it" : ""} from the Vault on
              disk?
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <Input
                autoFocus
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleModalSubmit();
                  }
                }}
                placeholder={
                  modal?.kind === "new-canvas"
                    ? "projects/Architecture.canvas"
                    : modal?.kind === "new-folder"
                      ? "runbooks"
                      : "projects/my-project.md"
                }
              />
              <p className="text-xs text-muted-foreground">
                Use forward slashes for nested folders (e.g. <span className="font-mono">projects/foo.md</span>).
              </p>
            </div>
          )}

          {modalError && (
            <p role="alert" className="text-xs text-destructive">
              {modalError}
            </p>
          )}

          <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setModal(null)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={modal?.kind === "delete" ? "destructive" : "default"}
              onClick={() => void handleModalSubmit()}
              disabled={submitting}
            >
              {modal?.kind === "delete"
                ? "Delete"
                : modal?.kind === "rename"
                  ? "Save name"
                  : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
