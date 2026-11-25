// fork 31erGER: Interactive Obsidian JSON Canvas 1.0 spatial whiteboard editor.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Code2,
  ExternalLink,
  FileText,
  FolderKanban,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
  Save,
  StickyNote,
  Trash2,
} from "lucide-react";
import {
  parseCanvasDocument,
  stringifyCanvasDocument,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSide,
  type VaultDocument,
} from "@paperclipai/shared";
import { vaultApi } from "@/api/vault";
import { queryKeys } from "@/lib/queryKeys";
import { MarkdownBody } from "@/components/MarkdownBody";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const CANVAS_COLOR_OPTIONS: Array<{ id: string; label: string; cssVar: string }> = [
  { id: "1", label: "Red", cssVar: "--status-task-blocked" },
  { id: "2", label: "Orange", cssVar: "--status-task-todo" },
  { id: "3", label: "Amber", cssVar: "--status-agent-paused" },
  { id: "4", label: "Green", cssVar: "--status-task-done" },
  { id: "5", label: "Blue", cssVar: "--status-task-in_progress" },
  { id: "6", label: "Violet", cssVar: "--status-task-in_review" },
];

const CANVAS_COLOR_VAR_BY_ID = new Map(
  CANVAS_COLOR_OPTIONS.map((option) => [option.id, option.cssVar]),
);

function resolveNodeColorVar(color?: string): string | undefined {
  if (!color) return undefined;
  return CANVAS_COLOR_VAR_BY_ID.get(color);
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function anchorPoint(node: CanvasNode, side: CanvasSide): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: node.x + node.width / 2, y: node.y };
    case "right":
      return { x: node.x + node.width, y: node.y + node.height / 2 };
    case "bottom":
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case "left":
      return { x: node.x, y: node.y + node.height / 2 };
  }
}

function autoSideBetween(from: CanvasNode, to: CanvasNode): {
  fromSide: CanvasSide;
  toSide: CanvasSide;
} {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { fromSide: "right", toSide: "left" }
      : { fromSide: "left", toSide: "right" };
  }
  return dy >= 0
    ? { fromSide: "bottom", toSide: "top" }
    : { fromSide: "top", toSide: "bottom" };
}

function controlOffset(side: CanvasSide, dist: number): { dx: number; dy: number } {
  switch (side) {
    case "top":
      return { dx: 0, dy: -dist };
    case "right":
      return { dx: dist, dy: 0 };
    case "bottom":
      return { dx: 0, dy: dist };
    case "left":
      return { dx: -dist, dy: 0 };
  }
}

function bezierEdgePath(
  from: { x: number; y: number },
  fromSide: CanvasSide,
  to: { x: number; y: number },
  toSide: CanvasSide,
): { d: string; midX: number; midY: number } {
  const dist = Math.max(48, Math.min(180, Math.hypot(to.x - from.x, to.y - from.y) * 0.45));
  const c1 = controlOffset(fromSide, dist);
  const c2 = controlOffset(toSide, dist);
  const cx1 = from.x + c1.dx;
  const cy1 = from.y + c1.dy;
  const cx2 = to.x + c2.dx;
  const cy2 = to.y + c2.dy;
  const d = `M ${from.x} ${from.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${to.x} ${to.y}`;
  // Cubic Bezier midpoint at t = 0.5
  const midX = 0.125 * from.x + 0.375 * cx1 + 0.375 * cx2 + 0.125 * to.x;
  const midY = 0.125 * from.y + 0.375 * cy1 + 0.375 * cy2 + 0.125 * to.y;
  return { d, midX, midY };
}

function FileCardPreview({
  companyId,
  filePath,
}: {
  companyId: string;
  filePath: string;
}) {
  const query = useQuery({
    queryKey: queryKeys.vault.file(companyId, filePath),
    queryFn: () => vaultApi.readFile(companyId, filePath),
    enabled: Boolean(companyId && filePath),
    retry: false,
  });

  if (query.isPending) {
    return <p className="text-xs text-muted-foreground">Loading note…</p>;
  }
  if (query.isError || !query.data) {
    return (
      <p className="text-xs text-muted-foreground">
        File not found in vault: <span className="font-mono">{filePath}</span>
      </p>
    );
  }
  const body = query.data.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").slice(0, 1200);
  return (
    <div className="pointer-events-none text-xs">
      <MarkdownBody>{body}</MarkdownBody>
    </div>
  );
}

type InteractionState =
  | null
  | {
      kind: "pan";
      startClientX: number;
      startClientY: number;
      originPanX: number;
      originPanY: number;
    }
  | {
      kind: "drag-node";
      nodeId: string;
      startClientX: number;
      startClientY: number;
      originX: number;
      originY: number;
    }
  | {
      kind: "resize-node";
      nodeId: string;
      startClientX: number;
      startClientY: number;
      originW: number;
      originH: number;
    }
  | {
      kind: "connect";
      fromNode: string;
      fromSide: CanvasSide;
      cursorX: number;
      cursorY: number;
    };

export interface VaultCanvasEditorProps {
  companyId: string;
  document: VaultDocument;
  markdownFiles: string[];
  saving: boolean;
  conflictMessage: string | null;
  saveError: string | null;
  onSave: (content: string, forceOverwrite?: boolean) => Promise<void>;
  onReload: () => void;
  onOpenFile: (path: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function VaultCanvasEditor({
  companyId,
  document,
  markdownFiles,
  saving,
  conflictMessage,
  saveError,
  onSave,
  onReload,
  onOpenFile,
  onDirtyChange,
}: VaultCanvasEditorProps) {
  const initialParsed = useMemo(() => {
    try {
      return { doc: parseCanvasDocument(document.content), parseError: null as string | null };
    } catch (err) {
      return {
        doc: { nodes: [], edges: [] } as CanvasDocument,
        parseError: err instanceof Error ? err.message : "Invalid JSON Canvas file",
      };
    }
  }, [document.content]);

  const [canvas, setCanvas] = useState<CanvasDocument>(initialParsed.doc);
  const [rawJsonMode, setRawJsonMode] = useState(Boolean(initialParsed.parseError));
  const [rawJsonDraft, setRawJsonDraft] = useState(document.content);
  const [jsonError, setJsonError] = useState<string | null>(initialParsed.parseError);

  const [pan, setPan] = useState({ x: 120, y: 100 });
  const [zoom, setZoom] = useState(1);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [interaction, setInteraction] = useState<InteractionState>(null);

  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCanvas(initialParsed.doc);
    setRawJsonDraft(document.content);
    setJsonError(initialParsed.parseError);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setEditingNodeId(null);
  }, [document.path, document.hash, document.content, initialParsed]);

  const serializedCanvas = useMemo(
    () => (rawJsonMode ? rawJsonDraft : stringifyCanvasDocument(canvas)),
    [canvas, rawJsonDraft, rawJsonMode],
  );
  const isDirty = serializedCanvas.trim() !== document.content.trim();

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const handleSave = useCallback(
    async (forceOverwrite = false) => {
      if (saving || (!isDirty && !forceOverwrite)) return;
      if (rawJsonMode) {
        try {
          const parsed = parseCanvasDocument(rawJsonDraft);
          setJsonError(null);
          setCanvas(parsed);
        } catch (err) {
          setJsonError(err instanceof Error ? err.message : "Invalid JSON Canvas");
          return;
        }
      }
      await onSave(serializedCanvas, forceOverwrite);
    },
    [isDirty, onSave, rawJsonDraft, rawJsonMode, saving, serializedCanvas],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave(false);
        return;
      }
      if (rawJsonMode || editingNodeId) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedNodeId) {
          event.preventDefault();
          setCanvas((prev) => ({
            nodes: prev.nodes.filter((n) => n.id !== selectedNodeId),
            edges: prev.edges.filter(
              (e) => e.fromNode !== selectedNodeId && e.toNode !== selectedNodeId,
            ),
          }));
          setSelectedNodeId(null);
        } else if (selectedEdgeId) {
          event.preventDefault();
          setCanvas((prev) => ({
            ...prev,
            edges: prev.edges.filter((e) => e.id !== selectedEdgeId),
          }));
          setSelectedEdgeId(null);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingNodeId, handleSave, rawJsonMode, selectedEdgeId, selectedNodeId]);

  const fitToView = useCallback(() => {
    const el = viewportRef.current;
    if (!el || canvas.nodes.length === 0) {
      setPan({ x: 80, y: 80 });
      setZoom(1);
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of canvas.nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    }
    const contentW = Math.max(200, maxX - minX);
    const contentH = Math.max(200, maxY - minY);
    const pad = 64;
    const scaleX = (el.clientWidth - pad * 2) / contentW;
    const scaleY = (el.clientHeight - pad * 2) / contentH;
    const nextZoom = Math.max(0.25, Math.min(1.25, Math.min(scaleX, scaleY)));
    const nextPanX = (el.clientWidth - contentW * nextZoom) / 2 - minX * nextZoom;
    const nextPanY = (el.clientHeight - contentH * nextZoom) / 2 - minY * nextZoom;
    setZoom(nextZoom);
    setPan({ x: Math.round(nextPanX), y: Math.round(nextPanY) });
  }, [canvas.nodes]);

  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan.x, pan.y, zoom],
  );

  function centerWorldCoords(): { x: number; y: number } {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 80, y: 80 };
    return {
      x: Math.round((rect.width / 2 - pan.x) / zoom),
      y: Math.round((rect.height / 2 - pan.y) / zoom),
    };
  }

  function addTextCard() {
    const center = centerWorldCoords();
    const id = makeId("text");
    const node: CanvasNode = {
      id,
      type: "text",
      text: "## New Card\n\nDouble-click to edit Markdown.",
      x: center.x - 140,
      y: center.y - 80,
      width: 280,
      height: 160,
    };
    setCanvas((prev) => ({ ...prev, nodes: [...prev.nodes, node] }));
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setEditingNodeId(id);
  }

  function addFileCard(filePath?: string) {
    const chosen = filePath ?? markdownFiles[0] ?? "COMPANY.md";
    const center = centerWorldCoords();
    const id = makeId("file");
    const node: CanvasNode = {
      id,
      type: "file",
      file: chosen,
      x: center.x - 150,
      y: center.y - 90,
      width: 300,
      height: 180,
      color: "5",
    };
    setCanvas((prev) => ({ ...prev, nodes: [...prev.nodes, node] }));
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  }

  function addGroupFrame() {
    const center = centerWorldCoords();
    const id = makeId("group");
    const node: CanvasNode = {
      id,
      type: "group",
      label: "Group",
      x: center.x - 240,
      y: center.y - 160,
      width: 480,
      height: 320,
    };
    setCanvas((prev) => ({ ...prev, nodes: [node, ...prev.nodes] }));
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  }

  function updateNode(nodeId: string, updater: (node: CanvasNode) => CanvasNode) {
    setCanvas((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node) => (node.id === nodeId ? updater(node) : node)),
    }));
  }

  function updateEdge(edgeId: string, updater: (edge: CanvasEdge) => CanvasEdge) {
    setCanvas((prev) => ({
      ...prev,
      edges: prev.edges.map((edge) => (edge.id === edgeId ? updater(edge) : edge)),
    }));
  }

  function deleteSelected() {
    if (selectedNodeId) {
      setCanvas((prev) => ({
        nodes: prev.nodes.filter((n) => n.id !== selectedNodeId),
        edges: prev.edges.filter(
          (e) => e.fromNode !== selectedNodeId && e.toNode !== selectedNodeId,
        ),
      }));
      setSelectedNodeId(null);
    } else if (selectedEdgeId) {
      setCanvas((prev) => ({
        ...prev,
        edges: prev.edges.filter((e) => e.id !== selectedEdgeId),
      }));
      setSelectedEdgeId(null);
    }
  }

  function handleViewportPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setEditingNodeId(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteraction({
      kind: "pan",
      startClientX: event.clientX,
      startClientY: event.clientY,
      originPanX: pan.x,
      originPanY: pan.y,
    });
  }

  function handleViewportPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!interaction) return;
    if (interaction.kind === "pan") {
      setPan({
        x: Math.round(interaction.originPanX + (event.clientX - interaction.startClientX)),
        y: Math.round(interaction.originPanY + (event.clientY - interaction.startClientY)),
      });
    } else if (interaction.kind === "drag-node") {
      const dx = (event.clientX - interaction.startClientX) / zoom;
      const dy = (event.clientY - interaction.startClientY) / zoom;
      updateNode(interaction.nodeId, (node) => ({
        ...node,
        x: Math.round(interaction.originX + dx),
        y: Math.round(interaction.originY + dy),
      }));
    } else if (interaction.kind === "resize-node") {
      const dx = (event.clientX - interaction.startClientX) / zoom;
      const dy = (event.clientY - interaction.startClientY) / zoom;
      updateNode(interaction.nodeId, (node) => ({
        ...node,
        width: Math.max(160, Math.round(interaction.originW + dx)),
        height: Math.max(96, Math.round(interaction.originH + dy)),
      }));
    } else if (interaction.kind === "connect") {
      const pt = clientToWorld(event.clientX, event.clientY);
      setInteraction({ ...interaction, cursorX: pt.x, cursorY: pt.y });
    }
  }

  function handleViewportPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!interaction) return;
    if (interaction.kind === "connect") {
      const worldPt = clientToWorld(event.clientX, event.clientY);
      const targetNode = [...canvas.nodes]
        .reverse()
        .find(
          (node) =>
            node.id !== interaction.fromNode &&
            worldPt.x >= node.x &&
            worldPt.x <= node.x + node.width &&
            worldPt.y >= node.y &&
            worldPt.y <= node.y + node.height,
        );
      if (targetNode) {
        const fromNode = canvas.nodes.find((n) => n.id === interaction.fromNode);
        const auto = fromNode
          ? autoSideBetween(fromNode, targetNode)
          : { fromSide: interaction.fromSide, toSide: "left" as CanvasSide };
        const newEdge: CanvasEdge = {
          id: makeId("edge"),
          fromNode: interaction.fromNode,
          fromSide: interaction.fromSide,
          toNode: targetNode.id,
          toSide: auto.toSide,
          toEnd: "arrow",
        };
        setCanvas((prev) => ({ ...prev, edges: [...prev.edges, newEdge] }));
        setSelectedEdgeId(newEdge.id);
        setSelectedNodeId(null);
      }
    }
    setInteraction(null);
  }

  function toggleRawJsonMode() {
    if (!rawJsonMode) {
      setRawJsonDraft(stringifyCanvasDocument(canvas));
      setJsonError(null);
      setRawJsonMode(true);
    } else {
      try {
        const parsed = parseCanvasDocument(rawJsonDraft);
        setCanvas(parsed);
        setJsonError(null);
        setRawJsonMode(false);
      } catch (err) {
        setJsonError(err instanceof Error ? err.message : "Invalid JSON Canvas");
      }
    }
  }

  const nodeMap = useMemo(
    () => new Map(canvas.nodes.map((node) => [node.id, node])),
    [canvas.nodes],
  );
  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) ?? null : null;
  const selectedEdge = selectedEdgeId
    ? canvas.edges.find((edge) => edge.id === selectedEdgeId) ?? null
    : null;

  // Render groups first so they sit cleanly behind cards
  const orderedNodes = useMemo(() => {
    const groups = canvas.nodes.filter((n) => n.type === "group");
    const cards = canvas.nodes.filter((n) => n.type !== "group");
    return [...groups, ...cards];
  }, [canvas.nodes]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Top toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-sm font-medium text-foreground">
            {document.path}
          </span>
          {isDirty && (
            <Badge variant="outline" className="shrink-0 text-xs">
              Unsaved
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {!rawJsonMode && (
            <>
              <Button type="button" variant="outline" size="xs" onClick={addTextCard} className="gap-1">
                <StickyNote className="size-3.5" />
                <span>Text card</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => addFileCard()}
                className="gap-1"
              >
                <FileText className="size-3.5" />
                <span>Note card</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={addGroupFrame}
                className="gap-1"
              >
                <FolderKanban className="size-3.5" />
                <span>Group</span>
              </Button>

              <div className="mx-1 h-4 w-px bg-border" aria-hidden />

              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Zoom out"
                onClick={() => setZoom((z) => Math.max(0.25, Number((z - 0.1).toFixed(2))))}
              >
                <Minus className="size-3.5" />
              </Button>
              <span className="w-10 text-center font-mono text-xs text-muted-foreground">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Zoom in"
                onClick={() => setZoom((z) => Math.min(2, Number((z + 0.1).toFixed(2))))}
              >
                <Plus className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                title="Fit whiteboard to screen"
                aria-label="Fit whiteboard to screen"
                onClick={fitToView}
              >
                <Maximize2 className="size-3.5" />
              </Button>
            </>
          )}

          <Button
            type="button"
            variant={rawJsonMode ? "secondary" : "ghost"}
            size="xs"
            onClick={toggleRawJsonMode}
            className="gap-1"
          >
            <Code2 className="size-3.5" />
            <span>{rawJsonMode ? "Visual" : "JSON"}</span>
          </Button>

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

      {/* Inspector strip when a node or edge is selected */}
      {!rawJsonMode && (selectedNode || selectedEdge) && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-1.5 text-xs">
          {selectedNode && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium capitalize text-muted-foreground">
                {selectedNode.type}
              </span>
              <div className="flex items-center gap-1" role="group" aria-label="Card color">
                <button
                  type="button"
                  title="Default color"
                  onClick={() => updateNode(selectedNode.id, (n) => ({ ...n, color: undefined }))}
                  className={cn(
                    "size-4 rounded-full border border-border bg-card",
                    !selectedNode.color && "ring-2 ring-ring",
                  )}
                />
                {CANVAS_COLOR_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    title={option.label}
                    onClick={() => updateNode(selectedNode.id, (n) => ({ ...n, color: option.id }))}
                    className={cn(
                      "status-fill size-4 rounded-full",
                      selectedNode.color === option.id && "ring-2 ring-ring ring-offset-1 ring-offset-background",
                    )}
                    style={{ "--sc": `var(${option.cssVar})` } as CSSProperties}
                  />
                ))}
              </div>

              {selectedNode.type === "file" && (
                <>
                  <select
                    aria-label="Linked vault note"
                    value={selectedNode.file}
                    onChange={(event) =>
                      updateNode(selectedNode.id, (n) =>
                        n.type === "file" ? { ...n, file: event.target.value } : n,
                      )
                    }
                    className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  >
                    {!markdownFiles.includes(selectedNode.file) && (
                      <option value={selectedNode.file}>{selectedNode.file}</option>
                    )}
                    {markdownFiles.map((path) => (
                      <option key={path} value={path}>
                        {path}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => onOpenFile(selectedNode.file)}
                    className="gap-1"
                  >
                    <ExternalLink className="size-3" />
                    <span>Open note</span>
                  </Button>
                </>
              )}

              {selectedNode.type === "group" && (
                <Input
                  aria-label="Group label"
                  value={selectedNode.label ?? ""}
                  onChange={(event) =>
                    updateNode(selectedNode.id, (n) =>
                      n.type === "group" ? { ...n, label: event.target.value } : n,
                    )
                  }
                  placeholder="Group title"
                  className="h-7 w-44 text-xs"
                />
              )}
            </div>
          )}

          {selectedEdge && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-muted-foreground">Connection label</span>
              <Input
                aria-label="Connection label"
                value={selectedEdge.label ?? ""}
                onChange={(event) =>
                  updateEdge(selectedEdge.id, (edge) => ({
                    ...edge,
                    label: event.target.value || undefined,
                  }))
                }
                placeholder="Optional arrow label…"
                className="h-7 w-52 text-xs"
              />
            </div>
          )}

          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={deleteSelected}
            className="gap-1 text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
            <span>Delete</span>
          </Button>
        </div>
      )}

      {/* Conflict / error banners */}
      {conflictMessage && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/60 px-4 py-2 text-xs"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-(--status-agent-paused)" />
            <span>{conflictMessage}</span>
          </span>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="xs" onClick={onReload} className="gap-1">
              <RefreshCw className="size-3" />
              <span>Reload</span>
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
      {(jsonError || saveError) && !conflictMessage && (
        <div
          role="alert"
          className="shrink-0 border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive"
        >
          {jsonError ?? saveError}
        </div>
      )}

      {/* Main workspace: Raw JSON editor OR interactive 2D spatial board */}
      {rawJsonMode ? (
        <textarea
          aria-label={`Edit raw canvas JSON for ${document.path}`}
          value={rawJsonDraft}
          onChange={(event) => setRawJsonDraft(event.target.value)}
          spellCheck={false}
          className="h-full min-h-0 w-full flex-1 resize-none bg-background p-4 font-mono text-sm text-foreground focus:outline-none"
        />
      ) : (
        <div
          ref={viewportRef}
          onPointerDown={handleViewportPointerDown}
          onPointerMove={handleViewportPointerMove}
          onPointerUp={handleViewportPointerUp}
          onWheel={(event) => {
            if (event.ctrlKey || event.metaKey || event.target === viewportRef.current) {
              event.preventDefault();
              const delta = event.deltaY < 0 ? 0.08 : -0.08;
              setZoom((z) => Math.max(0.25, Math.min(2, Number((z + delta).toFixed(2)))));
            }
          }}
          className={cn(
            "relative min-h-0 flex-1 overflow-hidden select-none bg-muted/20",
            interaction?.kind === "pan" ? "cursor-grabbing" : "cursor-grab",
          )}
          style={{
            backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
            backgroundSize: `${Math.round(24 * zoom)}px ${Math.round(24 * zoom)}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
        >
          {/* Transformed world layer */}
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          >
            {/* SVG Edges Layer */}
            <svg
              aria-label="Canvas connections"
              className="pointer-events-none absolute left-0 top-0 overflow-visible"
              width={1}
              height={1}
            >
              <defs>
                <marker
                  id="vault-canvas-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="currentColor" />
                </marker>
              </defs>

              {canvas.edges.map((edge) => {
                const fromNode = nodeMap.get(edge.fromNode);
                const toNode = nodeMap.get(edge.toNode);
                if (!fromNode || !toNode) return null;
                const fallbackSides = autoSideBetween(fromNode, toNode);
                const fromSide = edge.fromSide ?? fallbackSides.fromSide;
                const toSide = edge.toSide ?? fallbackSides.toSide;
                const fromPt = anchorPoint(fromNode, fromSide);
                const toPt = anchorPoint(toNode, toSide);
                const { d, midX, midY } = bezierEdgePath(fromPt, fromSide, toPt, toSide);
                const isSelected = selectedEdgeId === edge.id;
                const edgeColorVar = resolveNodeColorVar(edge.color);
                return (
                  <g
                    key={edge.id}
                    className={cn(
                      "pointer-events-auto cursor-pointer",
                      isSelected ? "text-primary" : "text-muted-foreground",
                    )}
                    style={edgeColorVar ? { color: `var(${edgeColorVar})` } : undefined}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setSelectedEdgeId(edge.id);
                      setSelectedNodeId(null);
                    }}
                  >
                    {/* Wide transparent hit area */}
                    <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
                    <path
                      d={d}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={isSelected ? 2.5 : 1.75}
                      markerEnd={edge.toEnd === "none" ? undefined : "url(#vault-canvas-arrow)"}
                      markerStart={edge.fromEnd === "arrow" ? "url(#vault-canvas-arrow)" : undefined}
                    />
                    {edge.label && (
                      <foreignObject
                        x={midX - 80}
                        y={midY - 14}
                        width={160}
                        height={28}
                        className="overflow-visible"
                      >
                        <div className="flex items-center justify-center">
                          <span
                            className={cn(
                              "rounded-md border border-border bg-card px-2 py-0.5 text-xs text-foreground shadow-sm",
                              isSelected && "border-primary",
                            )}
                          >
                            {edge.label}
                          </span>
                        </div>
                      </foreignObject>
                    )}
                  </g>
                );
              })}

              {/* Live edge-connection preview */}
              {interaction?.kind === "connect" &&
                (() => {
                  const fromNode = nodeMap.get(interaction.fromNode);
                  if (!fromNode) return null;
                  const fromPt = anchorPoint(fromNode, interaction.fromSide);
                  const { d } = bezierEdgePath(
                    fromPt,
                    interaction.fromSide,
                    { x: interaction.cursorX, y: interaction.cursorY },
                    "left",
                  );
                  return (
                    <path
                      d={d}
                      fill="none"
                      stroke="var(--primary)"
                      strokeWidth={2}
                      strokeDasharray="6 4"
                    />
                  );
                })()}
            </svg>

            {/* Nodes Layer */}
            {orderedNodes.map((node) => {
              const isSelected = selectedNodeId === node.id;
              const isEditing = editingNodeId === node.id;
              const accentVar = resolveNodeColorVar(node.color);
              const isGroup = node.type === "group";

              return (
                <div
                  key={node.id}
                  data-canvas-node={node.id}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelectedNodeId(node.id);
                    setSelectedEdgeId(null);
                    if (isEditing) return;
                    if (event.button !== 0) return;
                    viewportRef.current?.setPointerCapture(event.pointerId);
                    setInteraction({
                      kind: "drag-node",
                      nodeId: node.id,
                      startClientX: event.clientX,
                      startClientY: event.clientY,
                      originX: node.x,
                      originY: node.y,
                    });
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (node.type === "text") {
                      setEditingNodeId(node.id);
                    } else if (node.type === "file") {
                      onOpenFile(node.file);
                    }
                  }}
                  className={cn(
                    "group/canvas-node absolute flex flex-col rounded-lg border transition-shadow",
                    isGroup
                      ? "bg-muted/35 border-dashed border-border"
                      : "bg-card border-border shadow-sm",
                    isSelected && "ring-2 ring-ring shadow-md",
                  )}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: node.width,
                    height: node.height,
                    borderColor: accentVar ? `var(${accentVar})` : undefined,
                  }}
                >
                  {/* Group header */}
                  {isGroup && (
                    <div className="flex shrink-0 items-center justify-between px-3 py-1.5">
                      <span className="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {node.label || "Group"}
                      </span>
                    </div>
                  )}

                  {/* Text card */}
                  {node.type === "text" && (
                    <div className="min-h-0 flex-1 overflow-auto p-3">
                      {isEditing ? (
                        <textarea
                          autoFocus
                          aria-label="Edit card text"
                          value={node.text}
                          onPointerDown={(event) => event.stopPropagation()}
                          onChange={(event) =>
                            updateNode(node.id, (n) =>
                              n.type === "text" ? { ...n, text: event.target.value } : n,
                            )
                          }
                          onBlur={() => setEditingNodeId(null)}
                          className="h-full w-full resize-none bg-transparent font-mono text-xs leading-relaxed text-foreground focus:outline-none"
                        />
                      ) : (
                        <div className="text-xs">
                          <MarkdownBody>{node.text || "_Double-click to write…_"}</MarkdownBody>
                        </div>
                      )}
                    </div>
                  )}

                  {/* File card */}
                  {node.type === "file" && (
                    <>
                      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
                        <span className="flex min-w-0 items-center gap-1.5 font-mono text-xs font-medium text-foreground">
                          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{node.file}</span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          title={`Open ${node.file}`}
                          aria-label={`Open ${node.file}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenFile(node.file);
                          }}
                        >
                          <ExternalLink className="size-3" />
                        </Button>
                      </div>
                      <div className="scrollbar-auto-hide min-h-0 flex-1 overflow-y-auto p-3">
                        <FileCardPreview companyId={companyId} filePath={node.file} />
                      </div>
                    </>
                  )}

                  {/* Link card */}
                  {node.type === "link" && (
                    <div className="flex h-full flex-col justify-between p-3 text-xs">
                      <span className="font-medium text-foreground">External Link</span>
                      <a
                        href={node.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onPointerDown={(event) => event.stopPropagation()}
                        className="truncate text-primary underline underline-offset-2"
                      >
                        {node.url}
                      </a>
                    </div>
                  )}

                  {/* 4-side connection handles */}
                  {(["top", "right", "bottom", "left"] as const).map((side) => {
                    const posClass =
                      side === "top"
                        ? "-top-1.5 left-1/2 -translate-x-1/2"
                        : side === "right"
                          ? "-right-1.5 top-1/2 -translate-y-1/2"
                          : side === "bottom"
                            ? "-bottom-1.5 left-1/2 -translate-x-1/2"
                            : "-left-1.5 top-1/2 -translate-y-1/2";
                    return (
                      <button
                        key={side}
                        type="button"
                        aria-label={`Connect from ${side}`}
                        title="Drag to connect to another card"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          viewportRef.current?.setPointerCapture(event.pointerId);
                          const pt = clientToWorld(event.clientX, event.clientY);
                          setInteraction({
                            kind: "connect",
                            fromNode: node.id,
                            fromSide: side,
                            cursorX: pt.x,
                            cursorY: pt.y,
                          });
                        }}
                        className={cn(
                          "absolute size-3 rounded-full border border-primary bg-background opacity-0 transition-opacity hover:scale-125 group-hover/canvas-node:opacity-100",
                          isSelected && "opacity-100",
                          posClass,
                        )}
                      />
                    );
                  })}

                  {/* Bottom-right resize handle */}
                  <div
                    role="separator"
                    aria-label="Resize card"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      viewportRef.current?.setPointerCapture(event.pointerId);
                      setInteraction({
                        kind: "resize-node",
                        nodeId: node.id,
                        startClientX: event.clientX,
                        startClientY: event.clientY,
                        originW: node.width,
                        originH: node.height,
                      });
                    }}
                    className="absolute bottom-0 right-0 size-3.5 cursor-nwse-resize opacity-0 transition-opacity group-hover/canvas-node:opacity-100"
                  />
                </div>
              );
            })}
          </div>

          {/* Subtle bottom-left helper hint */}
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-border bg-background/90 px-2.5 py-1 text-xs text-muted-foreground">
            Drag background to pan · Drag card handles to connect · Double-click text cards to edit
          </div>
        </div>
      )}
    </div>
  );
}
