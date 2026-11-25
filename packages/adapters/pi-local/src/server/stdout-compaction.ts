import { performance } from "node:perf_hooks";
import { parseJson } from "@paperclipai/adapter-utils/server-utils";

/**
 * Stateful JSONL compaction for Pi `--mode json` stdout before it enters
 * the Paperclip run-log pipeline.
 *
 * Pi emits `message_update` events that repeat the FULL cumulative assistant
 * message on every streaming delta. Persisting each line makes run-log size
 * grow ~quadratically. In `compact` mode, stripping the cumulative copies
 * keeps growth linear without changing `parsePiJsonl` output or UI live typing.
 *
 * No truncation here: it would run before the server's secret redaction and
 * can split a secret across the cut boundary. The server re-caps after
 * redaction; oversized content is its responsibility.
 *
 * Tool update streams become throttled Paperclip progress events so the
 * stale-run watchdog's `lastOutputAt` stays fresh during long tools.
 */

const PI_STDOUT_LOG_MODES = ["raw", "compact"] as const;

export type PiStdoutLogMode = (typeof PI_STDOUT_LOG_MODES)[number];

const DEFAULT_PI_STDOUT_LOG_MODE: PiStdoutLogMode = "compact";

const PROGRESS_INTERVAL_MS = 5_000;

function isPiStdoutLogMode(value: string): value is PiStdoutLogMode {
  return PI_STDOUT_LOG_MODES.includes(value as PiStdoutLogMode);
}

export function resolvePiStdoutLogMode(config: Record<string, unknown>): PiStdoutLogMode {
  if (config.stdoutLogMode === undefined || config.stdoutLogMode === null) {
    return DEFAULT_PI_STDOUT_LOG_MODE;
  }
  if (typeof config.stdoutLogMode !== "string") return "raw";
  const normalized = config.stdoutLogMode.trim().toLowerCase();
  if (isPiStdoutLogMode(normalized)) {
    return normalized;
  }
  // Invalid explicit values fail safe to the lossless legacy stream rather
  // than silently enabling a lossy transformation.
  return "raw";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLineEvent(line: string): Record<string, unknown> | null {
  const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
  const event = parseJson(trimmed);
  return isRecord(event) ? event : null;
}

function slimAssistantMessageEvent(update: unknown): unknown {
  if (!isRecord(update)) return update;
  const { partial: _partial, ...rest } = update;
  return rest;
}

type Clock = () => number;

function createThrottle(intervalMs: number, now: Clock): () => boolean {
  let lastAt = Number.NEGATIVE_INFINITY;
  return () => {
    const current = now();
    if (current - lastAt < intervalMs) return false;
    lastAt = current;
    return true;
  };
}

function progressTick(allow: () => boolean, toolCallId?: unknown): string | null {
  if (!allow()) return null;
  // `paperclip_` prefix marks this as adapter metadata, not a Pi event.
  return JSON.stringify({
    type: "paperclip_progress",
    sourceEventType: "tool_execution_update",
    ...(typeof toolCallId === "string" ? { toolCallId } : {}),
  });
}

type PiStdoutCompactor = (line: string) => string | null;

interface PiStdoutCompactorOptions {
  now?: Clock;
}

function createCompactCompactor(now: Clock): PiStdoutCompactor {
  const allowToolTick = createThrottle(PROGRESS_INTERVAL_MS, now);
  return (line) => {
    const event = parseLineEvent(line);
    if (!event) return line;

    if (event.type === "tool_execution_update") {
      return progressTick(allowToolTick, event.toolCallId);
    }
    // fork 31erGER: drop high-frequency RPC UI widget/response/journal events so
    // host Pi extensions (e.g. per-second setWidget timers) cannot flood the run log
    // and evict real tool calls and commands from the UI tail buffer.
    if (
      event.type === "extension_ui_request" ||
      event.type === "extension_ui_response" ||
      event.type === "extension_error" ||
      event.type === "response" ||
      event.type === "entry_appended"
    ) {
      return null;
    }
    // Non-`message_update` events pass through untouched — including
    // `tool_execution_end`, whose `.result` can be tens of MiB (large
    // tool/bash output). Capping that is an intentional separate follow-up:
    // truncation here would run before the server's secret redaction and
    // could split a secret across the cut boundary. See #5699.
    if (event.type !== "message_update") return line;

    // fork 31erGER: drop no-op streaming framing events and per-token usage blobs
    // from message_update so long thinking runs stay compact in the run log.
    const updateType = isRecord(event.assistantMessageEvent) && typeof event.assistantMessageEvent.type === "string"
      ? event.assistantMessageEvent.type
      : "";
    if (
      updateType === "thinking_start" ||
      updateType === "text_start" ||
      updateType === "toolcall_start" ||
      updateType === "toolcall_delta" ||
      updateType === "toolcall_end"
    ) {
      return null;
    }

    const { message: _cumulativeMessage, usage: _perTokenUsage, ...rest } = event;
    return JSON.stringify({
      ...rest,
      ...(event.assistantMessageEvent !== undefined
        ? { assistantMessageEvent: slimAssistantMessageEvent(event.assistantMessageEvent) }
        : {}),
    });
  };
}

export function createPiStdoutCompactor(
  mode: PiStdoutLogMode,
  options: PiStdoutCompactorOptions = {},
): PiStdoutCompactor {
  const now = options.now ?? (() => performance.now());
  switch (mode) {
    case "raw":
      return (line) => line;
    case "compact":
      return createCompactCompactor(now);
  }
}
