// fork 31erGER: tests for live Pi RPC steering session lifecycle.
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  canSteerPiRun,
  createPiRpcSession,
  piRpcSteeringEnabled,
  steerPiRun,
} from "./live-steering.js";

describe("Pi RPC live steering", () => {
  it("sends initial prompt, delivers mid-turn steer commands, and closes stdin on agent_settled", async () => {
    const runId = "pi-rpc-test-1";
    const stdin = new PassThrough();
    const written: string[] = [];
    let ended = false;
    stdin.on("data", (chunk) => written.push(chunk.toString("utf8")));
    stdin.on("end", () => {
      ended = true;
    });

    const session = createPiRpcSession(runId, "Initial task prompt", {
      agentEndFallbackMs: 50,
    });
    expect(canSteerPiRun(runId)).toBe(false);

    session.attachStdin(stdin);
    expect(canSteerPiRun(runId)).toBe(true);

    const firstCmd = JSON.parse(written.join("").trim());
    expect(firstCmd).toEqual({
      id: "prompt-1",
      type: "prompt",
      message: "Initial task prompt",
    });

    session.onStdoutLine(
      JSON.stringify({ id: "prompt-1", type: "response", command: "prompt", success: true, data: { disposition: "started" } }),
    );
    session.onStdoutLine(JSON.stringify({ type: "agent_start" }));

    // Deliver a live steer command while Pi is mid-turn — resolves immediately
    // without blocking on a stdout round-trip.
    const steerResult = await steerPiRun(runId, "[Steering from CEO]: Switch to PostgreSQL.");
    expect(steerResult).toEqual({ ok: true, disposition: "queued" });
    const lines = written.join("").trim().split("\n");
    const steerCmd = JSON.parse(lines[1]!);
    expect(steerCmd).toMatchObject({
      type: "steer",
      message: "[Steering from CEO]: Switch to PostgreSQL.",
    });
    expect(ended).toBe(false);

    // Blocking extension UI dialogs are auto-cancelled so headless runs never hang.
    session.onStdoutLine(
      JSON.stringify({ type: "extension_ui_request", id: "dlg-1", method: "confirm", title: "Proceed?" }),
    );
    const afterDlg = written.join("").trim().split("\n");
    expect(JSON.parse(afterDlg[2]!)).toEqual({
      type: "extension_ui_response",
      id: "dlg-1",
      cancelled: true,
    });

    // Orderly close once Pi emits agent_settled.
    session.onStdoutLine(JSON.stringify({ type: "agent_end", messages: [] }));
    session.onStdoutLine(JSON.stringify({ type: "agent_settled" }));
    expect(canSteerPiRun(runId)).toBe(false);
    expect(stdin.writableEnded).toBe(true);

    session.dispose();
  });

  it("respects PAPERCLIP_PI_RPC_STEERING=0 opt-out", () => {
    expect(piRpcSteeringEnabled({})).toBe(true);
    expect(piRpcSteeringEnabled({ PAPERCLIP_PI_RPC_STEERING: "0" })).toBe(false);
    expect(piRpcSteeringEnabled({ PAPERCLIP_PI_RPC_STEERING: "false" })).toBe(false);
  });
});
