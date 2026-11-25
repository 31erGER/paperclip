// fork 31erGER: live mid-turn steering for local Pi runs via `pi --mode rpc`.
// Keeps stdin open for the duration of a local Pi run so board users and
// executive/manager agents (e.g. CEO) can send `{"type":"steer","message":...}`
// commands that Pi delivers right after its current tool call, before the next LLM call.

export interface PiSteerResult {
  ok: boolean;
  disposition?: string;
  error?: string;
}

export interface PiRpcSessionController {
  readonly runId: string;
  readonly isOpen: boolean;
  attachStdin(stdin: NodeJS.WritableStream): void;
  onStdoutLine(line: string): void;
  steer(message: string): Promise<PiSteerResult>;
  abort(): void;
  dispose(): void;
}

const activePiRpcSessions = new Map<string, PiRpcSessionController>();

export function piRpcSteeringEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.PAPERCLIP_PI_RPC_STEERING?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  return true;
}

export function canSteerPiRun(runId: string | null | undefined): boolean {
  if (!runId) return false;
  const session = activePiRpcSessions.get(runId);
  return Boolean(session && session.isOpen);
}

export async function steerPiRun(
  runId: string,
  message: string,
): Promise<PiSteerResult> {
  const session = activePiRpcSessions.get(runId);
  if (!session || !session.isOpen) {
    return { ok: false, error: "No active steerable Pi RPC session for this run" };
  }
  return session.steer(message);
}

export function abortPiRun(runId: string): boolean {
  const session = activePiRpcSessions.get(runId);
  if (!session || !session.isOpen) return false;
  session.abort();
  return true;
}

function safeJsonRecord(line: string): Record<string, unknown> | null {
  const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

const BLOCKING_EXTENSION_UI_METHODS = new Set(["select", "confirm", "input", "editor"]);

export function createPiRpcSession(
  runId: string,
  initialPrompt: string,
  options: {
    agentEndFallbackMs?: number;
  } = {},
): PiRpcSessionController {
  const agentEndFallbackMs = options.agentEndFallbackMs ?? 1500;

  let stdinStream: NodeJS.WritableStream | null = null;
  let closed = false;
  let seq = 0;
  let agentEndTimer: ReturnType<typeof setTimeout> | null = null;
  const earlyQueue: Array<{ id: string; payload: string }> = [];

  const clearAgentEndTimer = () => {
    if (agentEndTimer) {
      clearTimeout(agentEndTimer);
      agentEndTimer = null;
    }
  };

  const writeRecord = (record: Record<string, unknown>): boolean => {
    if (closed || !stdinStream) return false;
    const writable = stdinStream as NodeJS.WritableStream & { destroyed?: boolean; writableEnded?: boolean };
    if (writable.destroyed || writable.writableEnded) {
      closed = true;
      return false;
    }
    try {
      stdinStream.write(`${JSON.stringify(record)}\n`);
      return true;
    } catch {
      closed = true;
      return false;
    }
  };

  const closeStdin = () => {
    if (closed) return;
    closed = true;
    clearAgentEndTimer();
    if (activePiRpcSessions.get(runId) === controller) {
      activePiRpcSessions.delete(runId);
    }
    const writable = stdinStream as (NodeJS.WritableStream & { destroyed?: boolean; writableEnded?: boolean }) | null;
    if (writable && !writable.destroyed && !writable.writableEnded) {
      try {
        writable.end();
      } catch {
        // Ignore broken-pipe errors during orderly shutdown.
      }
    }
  };

  const controller: PiRpcSessionController = {
    runId,
    get isOpen() {
      return !closed;
    },

    attachStdin(stdin: NodeJS.WritableStream) {
      if (closed) return;
      stdinStream = stdin;
      activePiRpcSessions.set(runId, controller);
      writeRecord({
        id: "prompt-1",
        type: "prompt",
        message: initialPrompt,
      });
      while (earlyQueue.length > 0) {
        const next = earlyQueue.shift()!;
        writeRecord({ id: next.id, type: "steer", message: next.payload });
      }
    },

    onStdoutLine(line: string) {
      const parsed = safeJsonRecord(line);
      if (!parsed) return;
      const type = typeof parsed.type === "string" ? parsed.type : "";

      // Headless RPC mode cannot display interactive extension dialogs; cancel them
      // immediately so a host Pi extension never hangs the run waiting for a reply.
      if (type === "extension_ui_request") {
        const method = typeof parsed.method === "string" ? parsed.method : "";
        const id = typeof parsed.id === "string" ? parsed.id : "";
        if (id && BLOCKING_EXTENSION_UI_METHODS.has(method)) {
          writeRecord({ type: "extension_ui_response", id, cancelled: true });
        }
        return;
      }

      if (type === "response") {
        const id = typeof parsed.id === "string" ? parsed.id : "";
        const success = parsed.success === true;
        const data =
          typeof parsed.data === "object" && parsed.data !== null && !Array.isArray(parsed.data)
            ? (parsed.data as Record<string, unknown>)
            : null;
        const disposition = typeof data?.disposition === "string" ? data.disposition : undefined;

        if (id === "prompt-1") {
          // If the initial prompt failed or was synchronously handled by an extension,
          // Pi will not emit agent_settled, so close stdin to exit cleanly.
          if (!success || disposition === "handled") {
            closeStdin();
          }
        }
        return;
      }

      if (type === "agent_start" || type === "turn_start") {
        clearAgentEndTimer();
        return;
      }

      if (type === "agent_settled") {
        if (earlyQueue.length === 0) {
          closeStdin();
        }
        return;
      }

      if (type === "agent_end") {
        clearAgentEndTimer();
        // Pi 1.5+ emits `agent_settled` right after `agent_end` once retries/steering finish.
        // Keep a short fallback timer so older Pi versions without `agent_settled` also exit cleanly.
        agentEndTimer = setTimeout(() => {
          agentEndTimer = null;
          if (earlyQueue.length === 0) {
            closeStdin();
          }
        }, agentEndFallbackMs);
      }
    },

    steer(message: string): Promise<PiSteerResult> {
      if (closed) {
        return Promise.resolve({ ok: false, error: "Pi RPC session is already closed" });
      }
      clearAgentEndTimer();
      const id = `steer-${++seq}`;
      // Non-blocking stdin write: never await a stdout round-trip inside a DB
      // steering transaction, because stdout logging updates `heartbeat_runs`
      // and would deadlock on the transaction's row lock.
      if (!stdinStream) {
        earlyQueue.push({ id, payload: message });
        return Promise.resolve({ ok: true, disposition: "queued" });
      }
      const written = writeRecord({ id, type: "steer", message });
      if (!written) {
        return Promise.resolve({ ok: false, error: "Failed to write steer command to Pi stdin" });
      }
      return Promise.resolve({ ok: true, disposition: "queued" });
    },

    abort() {
      if (closed) return;
      writeRecord({ id: `abort-${++seq}`, type: "abort" });
      closeStdin();
    },

    dispose() {
      clearAgentEndTimer();
      closed = true;
      if (activePiRpcSessions.get(runId) === controller) {
        activePiRpcSessions.delete(runId);
      }
      earlyQueue.length = 0;
    },
  };

  return controller;
}
