import type { TranscriptEntry } from "@paperclipai/adapter-utils";

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function extractTextContent(content: string | Array<{ type: string; text?: string; thinking?: string }>): { text: string; thinking: string } {
  if (typeof content === "string") return { text: content, thinking: "" };
  if (!Array.isArray(content)) return { text: "", thinking: "" };
  
  let text = "";
  let thinking = "";
  
  for (const c of content) {
    if (c.type === "text" && c.text) {
      text += c.text;
    }
    if (c.type === "thinking" && c.thinking) {
      thinking += c.thinking;
    }
  }
  
  return { text, thinking };
}

// Track pending tool calls for proper toolUseId matching
let pendingToolCalls = new Map<string, { toolName: string; args: unknown }>();

// fork 31erGER: extract diff transcript entries for Pi edit/write tool executions.
const MAX_DIFF_LINES = 300;
const EDIT_TOOL_NAMES = new Set(["edit", "edit_file", "str_replace", "str_replace_editor", "patch", "apply_patch"]);
const WRITE_TOOL_NAMES = new Set(["write", "write_file", "create_file"]);

function extractFilePathFromArgs(args: unknown): string {
  const rec = asRecord(args);
  if (!rec) return "";
  return (
    asString(rec.path) ||
    asString(rec.file_path) ||
    asString(rec.filePath) ||
    asString(rec.filename) ||
    ""
  );
}

function buildDiffEntriesFromLines(
  lines: Array<{ changeType: "add" | "remove" | "context" | "hunk"; text: string }>,
  filePath: string,
  toolUseId: string,
  ts: string,
  additions: number,
  deletions: number,
): TranscriptEntry[] {
  if (lines.length === 0) return [];
  const entries: TranscriptEntry[] = [];
  if (filePath) {
    entries.push({
      kind: "diff",
      ts,
      changeType: "file_header",
      text: filePath,
      toolUseId,
      additions,
      deletions,
    });
  }
  const truncated = lines.length > MAX_DIFF_LINES;
  const kept = truncated ? lines.slice(0, MAX_DIFF_LINES) : lines;
  for (const line of kept) {
    entries.push({
      kind: "diff",
      ts,
      changeType: line.changeType,
      text: line.text,
      toolUseId,
    });
  }
  if (truncated) {
    entries.push({
      kind: "diff",
      ts,
      changeType: "truncation",
      text: "Diff shortened for display.",
      toolUseId,
    });
  }
  return entries;
}

function parsePiDiffString(
  diffText: string,
  filePath: string,
  toolUseId: string,
  ts: string,
): TranscriptEntry[] {
  const rawLines = diffText.replace(/\r\n/g, "\n").split("\n");
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }
  const parsed: Array<{ changeType: "add" | "remove" | "context" | "hunk"; text: string }> = [];
  let additions = 0;
  let deletions = 0;

  for (const line of rawLines) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("@@")) {
      parsed.push({ changeType: "hunk", text: line });
      continue;
    }
    if (/^\s*\.\.\.\s*$/.test(line)) {
      parsed.push({ changeType: "hunk", text: "…" });
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
      parsed.push({ changeType: "add", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      deletions += 1;
      parsed.push({ changeType: "remove", text: line.slice(1) });
    } else if (line.startsWith(" ")) {
      parsed.push({ changeType: "context", text: line.slice(1) });
    } else {
      parsed.push({ changeType: "context", text: line });
    }
  }

  return buildDiffEntriesFromLines(parsed, filePath, toolUseId, ts, additions, deletions);
}

function buildDiffFromReplacementPairs(
  pairs: Array<{ oldText: string; newText: string }>,
  filePath: string,
  toolUseId: string,
  ts: string,
): TranscriptEntry[] {
  const parsed: Array<{ changeType: "add" | "remove" | "context" | "hunk"; text: string }> = [];
  let additions = 0;
  let deletions = 0;

  pairs.forEach((pair, pairIndex) => {
    if (pairIndex > 0) {
      parsed.push({ changeType: "hunk", text: "…" });
    }
    const oldLines = pair.oldText ? pair.oldText.replace(/\r\n/g, "\n").split("\n") : [];
    const newLines = pair.newText ? pair.newText.replace(/\r\n/g, "\n").split("\n") : [];

    // Trim shared prefix & suffix lines, keeping up to 2 context lines around the edit.
    let prefix = 0;
    while (
      prefix < oldLines.length &&
      prefix < newLines.length &&
      oldLines[prefix] === newLines[prefix]
    ) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < oldLines.length - prefix &&
      suffix < newLines.length - prefix &&
      oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
    ) {
      suffix += 1;
    }

    const leadingContext = oldLines.slice(Math.max(0, prefix - 2), prefix);
    const removed = oldLines.slice(prefix, oldLines.length - suffix);
    const added = newLines.slice(prefix, newLines.length - suffix);
    const trailingContext = oldLines.slice(oldLines.length - suffix, Math.min(oldLines.length, oldLines.length - suffix + 2));

    for (const line of leadingContext) parsed.push({ changeType: "context", text: line });
    for (const line of removed) {
      deletions += 1;
      parsed.push({ changeType: "remove", text: line });
    }
    for (const line of added) {
      additions += 1;
      parsed.push({ changeType: "add", text: line });
    }
    for (const line of trailingContext) parsed.push({ changeType: "context", text: line });
  });

  return buildDiffEntriesFromLines(parsed, filePath, toolUseId, ts, additions, deletions);
}

function extractPiToolDiffEntries(
  toolName: string,
  args: unknown,
  result: unknown,
  isError: boolean,
  toolUseId: string,
  ts: string,
): TranscriptEntry[] {
  if (isError) return [];
  const normalizedName = toolName.trim().toLowerCase();
  const filePath = extractFilePathFromArgs(args);

  // 1. Prefer Pi's native edit tool diff payload (`result.details.diff`).
  const resultObj = asRecord(result);
  const detailsObj = resultObj ? asRecord(resultObj.details) : null;
  const nativeDiff = detailsObj ? asString(detailsObj.diff) : "";
  if (nativeDiff) {
    return parsePiDiffString(nativeDiff, filePath, toolUseId, ts);
  }

  // 2. Fallback for edit tools without `details.diff` (uses oldText/newText or edits[]).
  const argsObj = asRecord(args);
  if (argsObj && EDIT_TOOL_NAMES.has(normalizedName)) {
    const pairs: Array<{ oldText: string; newText: string }> = [];
    if (Array.isArray(argsObj.edits)) {
      for (const rawEdit of argsObj.edits) {
        const editRec = asRecord(rawEdit);
        if (!editRec) continue;
        const oldText = asString(editRec.oldText) || asString(editRec.old_string);
        const newText = asString(editRec.newText) || asString(editRec.new_string);
        if (oldText || newText) pairs.push({ oldText, newText });
      }
    } else {
      const oldText = asString(argsObj.oldText) || asString(argsObj.old_string);
      const newText = asString(argsObj.newText) || asString(argsObj.new_string);
      if (oldText || newText) pairs.push({ oldText, newText });
    }
    if (pairs.length > 0) {
      return buildDiffFromReplacementPairs(pairs, filePath, toolUseId, ts);
    }
  }

  // 3. Write/create tools: represent written file content as added diff lines.
  if (argsObj && WRITE_TOOL_NAMES.has(normalizedName)) {
    const content = typeof argsObj.content === "string" ? argsObj.content : null;
    if (content !== null) {
      const rawLines = content.replace(/\r\n/g, "\n").split("\n");
      if (rawLines.length > 1 && rawLines[rawLines.length - 1] === "") {
        rawLines.pop();
      }
      const parsed = rawLines.map((line) => ({ changeType: "add" as const, text: line }));
      return buildDiffEntriesFromLines(parsed, filePath, toolUseId, ts, parsed.length, 0);
    }
  }

  return [];
}

export function resetParserState(): void {
  pendingToolCalls.clear();
}

export function parsePiStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const parsed = asRecord(safeJsonParse(line));
  if (!parsed) {
    // Non-JSON line, treat as raw stdout
    const trimmed = line.trim();
    if (!trimmed) return [];
    return [{ kind: "stdout", ts, text: trimmed }];
  }

  const type = asString(parsed.type);

  // RPC protocol messages and adapter-generated progress metadata are
  // internal implementation details, not transcript entries.
  if (
    type === "response" ||
    type === "extension_ui_request" ||
    type === "extension_ui_response" ||
    type === "extension_error" ||
    type === "entry_appended" ||
    type === "paperclip_progress"
  ) {
    return [];
  }

  // Agent lifecycle
  if (type === "session") {
    // fork 31erGER: keep session header as a system log entry instead of raw JSON stdout.
    const cwd = asString(parsed.cwd);
    return [{ kind: "system", ts, text: cwd ? `Pi session started (${cwd})` : "Pi session started" }];
  }

  if (type === "agent_start") {
    return [{ kind: "system", ts, text: "🚀 Pi agent started" }];
  }

  if (type === "agent_settled") {
    return [];
  }

  if (type === "agent_end") {
    const entries: TranscriptEntry[] = [];

    // fork 31erGER: assistant text and thinking are already streamed via
    // message_update deltas; extract only final usage from agent_end.
    const messages = parsed.messages as Array<Record<string, unknown>> | undefined;
    if (messages && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === "assistant") {
        const usage = asRecord(lastMessage.usage);
        if (usage) {
          const inputTokens = (usage.inputTokens ?? usage.input ?? 0) as number;
          const outputTokens = (usage.outputTokens ?? usage.output ?? 0) as number;
          const cachedTokens = (usage.cacheRead ?? usage.cachedInputTokens ?? 0) as number;
          const costRecord = asRecord(usage.cost);
          const costUsd = (costRecord?.total ?? usage.costUsd ?? 0) as number;

          if (inputTokens > 0 || outputTokens > 0) {
            entries.push({
              kind: "result",
              ts,
              text: "Run completed",
              inputTokens,
              outputTokens,
              cachedTokens,
              costUsd,
              subtype: "end",
              isError: false,
              errors: [],
            });
          }
        }
      }
    }

    if (entries.length === 0) {
      entries.push({ kind: "system", ts, text: "✅ Pi agent finished" });
    }

    return entries;
  }

  // Turn lifecycle
  if (type === "turn_start") {
    return []; // Skip noisy lifecycle events
  }

  if (type === "turn_end") {
    // fork 31erGER: thinking, assistant text, and tool results are already
    // emitted by message_update and tool_execution_end; skip duplicate summaries.
    return [];
  }

  // Message streaming
  if (type === "message_start") {
    return [];
  }

  if (type === "message_update") {
    const assistantEvent = asRecord(parsed.assistantMessageEvent);
    if (assistantEvent) {
      const msgType = asString(assistantEvent.type);

      // Handle thinking deltas
      if (msgType === "thinking_delta") {
        const delta = asString(assistantEvent.delta);
        if (delta) {
          return [{ kind: "thinking", ts, text: delta, delta: true }];
        }
      }

      // Handle text deltas
      if (msgType === "text_delta") {
        const delta = asString(assistantEvent.delta);
        if (delta) {
          return [{ kind: "assistant", ts, text: delta, delta: true }];
        }
      }

      // fork 31erGER: mark streamed thinking block complete without duplicating text.
      if (msgType === "thinking_end") {
        if (asString(assistantEvent.content)) {
          return [{ kind: "thinking", ts, text: "", delta: true, lifecycle: "completed" }];
        }
      }

      // fork 31erGER: text_delta already streamed the assistant text.
      if (msgType === "text_end") {
        return [];
      }
    }
    return [];
  }

  if (type === "message_end") {
    const message = asRecord(parsed.message);
    if (message) {
      // fork 31erGER: respect message.role so user wake payloads stay out of
      // assistant chat bubbles and toolResult entries do not duplicate tool_execution_end.
      const role = asString(message.role);
      const content = message.content as string | Array<{ type: string; text?: string; thinking?: string }>;

      if (role === "user") {
        const { text } = extractTextContent(content);
        if (text.trim()) {
          return [{ kind: "user", ts, text }];
        }
        return [];
      }

      if (role === "system") {
        const { text } = extractTextContent(content);
        if (text.trim()) {
          return [{ kind: "system", ts, text }];
        }
        return [];
      }

      if (role === "assistant") {
        const errorMessage = asString(message.errorMessage);
        if (errorMessage) {
          return [{ kind: "stderr", ts, text: errorMessage }];
        }
        return [];
      }

      return [];
    }
    return [];
  }

  // Tool execution
  if (type === "tool_execution_start") {
    const toolCallId = asString(parsed.toolCallId, `tool-${Date.now()}`);
    const toolName = asString(parsed.toolName, "tool");
    const args = parsed.args;
    
    // Track this tool call for later matching
    pendingToolCalls.set(toolCallId, { toolName, args });
    
    return [{
      kind: "tool_call",
      ts,
      name: toolName,
      input: args,
      toolUseId: toolCallId,
    }];
  }

  if (type === "tool_execution_update") {
    return [];
  }

  if (type === "tool_execution_end") {
    const toolCallId = asString(parsed.toolCallId, `tool-${Date.now()}`);
    const toolName = asString(parsed.toolName, "tool");
    const result = parsed.result;
    const isError = parsed.isError === true;
    
    // Extract text from Pi's content array format
    let contentStr: string;
    if (typeof result === "string") {
      contentStr = result;
    } else if (Array.isArray(result)) {
      const extracted = extractTextContent(result as Array<{ type: string; text?: string }>);
      contentStr = extracted.text || JSON.stringify(result);
    } else if (result && typeof result === "object") {
      const resultObj = result as Record<string, unknown>;
      if (Array.isArray(resultObj.content)) {
        const extracted = extractTextContent(resultObj.content as Array<{ type: string; text?: string }>);
        contentStr = extracted.text || JSON.stringify(result);
      } else {
        contentStr = JSON.stringify(result);
      }
    } else {
      contentStr = String(result);
    }
    
    // fork 31erGER: read pending call args before cleanup so edit/write diff entries can be emitted.
    const pendingCall = pendingToolCalls.get(toolCallId);
    pendingToolCalls.delete(toolCallId);

    const diffEntries = extractPiToolDiffEntries(
      toolName,
      pendingCall?.args,
      result,
      isError,
      toolCallId,
      ts,
    );

    return [
      {
        kind: "tool_result",
        ts,
        toolUseId: toolCallId,
        toolName,
        content: contentStr,
        isError,
      },
      ...diffEntries,
    ];
  }

  // Fallback for unknown event types
  return [{ kind: "stdout", ts, text: line }];
}
