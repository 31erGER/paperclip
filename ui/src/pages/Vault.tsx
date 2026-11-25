// fork 31erGER: Company Vault page combining File Browser, Markdown Editor, and Obsidian Canvas whiteboard.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, PanelLeft } from "lucide-react";
import { stringifyCanvasDocument, type VaultTreeNode } from "@paperclipai/shared";
import { ApiError } from "@/api/client";
import { vaultApi } from "@/api/vault";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { useToastActions } from "@/context/ToastContext";
import { queryKeys } from "@/lib/queryKeys";
import { useSearchParams } from "@/lib/router";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorState, useQueryView } from "@/components/QueryView";
import { Button } from "@/components/ui/button";
import { VaultFileTree } from "@/components/vault/VaultFileTree";
import { VaultMarkdownEditor } from "@/components/vault/VaultMarkdownEditor";
import { VaultCanvasEditor } from "@/components/vault/VaultCanvasEditor";

function flattenFilePaths(nodes: VaultTreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === "file") {
      out.push(node.path);
    } else if (node.children) {
      flattenFilePaths(node.children, out);
    }
  }
  return out;
}

function defaultVaultFile(filePaths: string[]): string | null {
  if (filePaths.includes("INDEX.md")) return "INDEX.md";
  if (filePaths.includes("Overview.canvas")) return "Overview.canvas";
  return filePaths[0] ?? null;
}

export function Vault() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Vault" }]);
  }, [setBreadcrumbs]);

  const indexQuery = useQuery({
    queryKey: queryKeys.vault.index(selectedCompanyId ?? ""),
    queryFn: () => vaultApi.getIndex(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });
  const indexView = useQueryView(indexQuery);

  const allFilePaths = useMemo(
    () => flattenFilePaths(indexQuery.data?.tree ?? []),
    [indexQuery.data?.tree],
  );
  const markdownFiles = useMemo(
    () => allFilePaths.filter((p) => /\.(md|markdown)$/i.test(p)),
    [allFilePaths],
  );

  const requestedPath = searchParams.get("path");
  const selectedPath = requestedPath || defaultVaultFile(allFilePaths);

  const selectFile = useCallback(
    (nextPath: string) => {
      if (nextPath === selectedPath) return;
      if (isDirty && !window.confirm("You have unsaved changes. Discard them and open another file?")) {
        return;
      }
      setConflictMessage(null);
      setSaveError(null);
      setIsDirty(false);
      setSearchParams({ path: nextPath }, { replace: false });
    },
    [isDirty, selectedPath, setSearchParams],
  );

  const fileQuery = useQuery({
    queryKey: queryKeys.vault.file(selectedCompanyId ?? "", selectedPath ?? ""),
    queryFn: () => vaultApi.readFile(selectedCompanyId!, selectedPath!),
    enabled: Boolean(selectedCompanyId && selectedPath),
    retry: false,
  });
  const fileView = useQueryView(fileQuery);

  async function refreshAll() {
    if (!selectedCompanyId) return;
    setConflictMessage(null);
    setSaveError(null);
    await queryClient.invalidateQueries({ queryKey: ["vault", selectedCompanyId] });
  }

  async function handleSave(content: string, forceOverwrite = false) {
    if (!selectedCompanyId || !selectedPath) return;
    setSaving(true);
    setConflictMessage(null);
    setSaveError(null);
    try {
      const updated = await vaultApi.writeFile(selectedCompanyId, {
        path: selectedPath,
        content,
        expectedHash: forceOverwrite ? undefined : fileQuery.data?.hash,
      });
      queryClient.setQueryData(
        queryKeys.vault.file(selectedCompanyId, selectedPath),
        updated,
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.vault.index(selectedCompanyId),
      });
      setIsDirty(false);
      pushToast({ title: "Saved", body: selectedPath, tone: "success" });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictMessage(
          "This file changed on disk (via Obsidian or an agent) since you opened it.",
        );
      } else {
        setSaveError(err instanceof Error ? err.message : "Could not save vault file.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateFile(filePath: string, kind: "markdown" | "canvas") {
    if (!selectedCompanyId) return;
    const baseName = filePath.split("/").pop()?.replace(/\.(md|canvas)$/i, "") || "Untitled";
    const initialContent =
      kind === "canvas"
        ? stringifyCanvasDocument({
            nodes: [
              {
                id: "node-title",
                type: "text",
                text: `# ${baseName}\n\nDrag cards or add vault notes to map ideas.`,
                x: 0,
                y: 0,
                width: 300,
                height: 150,
                color: "5",
              },
            ],
            edges: [],
          })
        : `---\ntags: []\n---\n\n# ${baseName}\n\n`;
    const created = await vaultApi.writeFile(selectedCompanyId, {
      path: filePath,
      content: initialContent,
    });
    queryClient.setQueryData(
      queryKeys.vault.file(selectedCompanyId, created.path),
      created,
    );
    await queryClient.invalidateQueries({
      queryKey: queryKeys.vault.index(selectedCompanyId),
    });
    setIsDirty(false);
    setSearchParams({ path: created.path });
  }

  async function handleCreateFolder(folderPath: string) {
    if (!selectedCompanyId) return;
    await vaultApi.createFolder(selectedCompanyId, folderPath);
    await queryClient.invalidateQueries({
      queryKey: queryKeys.vault.index(selectedCompanyId),
    });
  }

  async function handleRenameEntry(fromPath: string, toPath: string) {
    if (!selectedCompanyId) return;
    await vaultApi.renameEntry(selectedCompanyId, fromPath, toPath);
    await queryClient.invalidateQueries({ queryKey: ["vault", selectedCompanyId] });
    if (selectedPath === fromPath) {
      setSearchParams({ path: toPath }, { replace: true });
    } else if (selectedPath && selectedPath.startsWith(`${fromPath}/`)) {
      setSearchParams(
        { path: `${toPath}${selectedPath.slice(fromPath.length)}` },
        { replace: true },
      );
    }
  }

  async function handleDeleteEntry(entryPath: string) {
    if (!selectedCompanyId) return;
    await vaultApi.deleteEntry(selectedCompanyId, entryPath);
    await queryClient.invalidateQueries({ queryKey: ["vault", selectedCompanyId] });
    if (selectedPath === entryPath || selectedPath?.startsWith(`${entryPath}/`)) {
      setIsDirty(false);
      setSearchParams({}, { replace: true });
    }
  }

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={BookOpen}
        message="Select a company to open its shared Vault."
      />
    );
  }

  if (indexView.kind === "error") {
    return (
      <QueryErrorState
        size="page"
        error={indexView.error}
        action="load the company Vault"
        onRetry={indexView.retry}
        retrying={indexView.isFetching}
      />
    );
  }

  return (
    <div className="flex h-(--sz-calc-29) min-h-0 -m-6 overflow-hidden bg-background">
      {sidebarOpen && (
        <div className="w-72 shrink-0 min-h-0">
          <VaultFileTree
            companyId={selectedCompanyId}
            info={indexQuery.data?.info}
            tree={indexQuery.data?.tree ?? []}
            selectedPath={selectedPath}
            onSelectFile={selectFile}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onRenameEntry={handleRenameEntry}
            onDeleteEntry={handleDeleteEntry}
            onRefresh={() => void refreshAll()}
            refreshing={indexQuery.isFetching}
          />
        </div>
      )}

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {!sidebarOpen && (
          <div className="absolute left-3 top-2.5 z-10">
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              title="Show vault files"
              aria-label="Show vault files"
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeft className="size-3.5" />
            </Button>
          </div>
        )}

        {!selectedPath ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              icon={BookOpen}
              message="Choose a note or canvas from the Vault, or create a new one."
            />
          </div>
        ) : fileView.kind === "loading" || fileView.kind === "reconnecting" ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
            Loading {selectedPath}…
          </div>
        ) : fileView.kind === "error" ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <QueryErrorState
              error={fileView.error}
              action={`open ${selectedPath}`}
              onRetry={fileView.retry}
              retrying={fileView.isFetching}
            />
          </div>
        ) : fileQuery.data?.fileType === "canvas" ? (
          <VaultCanvasEditor
            companyId={selectedCompanyId}
            document={fileQuery.data}
            markdownFiles={markdownFiles}
            saving={saving}
            conflictMessage={conflictMessage}
            saveError={saveError}
            onSave={handleSave}
            onReload={() => {
              setConflictMessage(null);
              void fileQuery.refetch();
            }}
            onOpenFile={selectFile}
            onDirtyChange={setIsDirty}
          />
        ) : fileQuery.data ? (
          <VaultMarkdownEditor
            document={fileQuery.data}
            allFilePaths={allFilePaths}
            saving={saving}
            conflictMessage={conflictMessage}
            saveError={saveError}
            onSave={handleSave}
            onReload={() => {
              setConflictMessage(null);
              void fileQuery.refetch();
            }}
            onOpenFile={selectFile}
            onDirtyChange={setIsDirty}
          />
        ) : null}
      </div>
    </div>
  );
}
