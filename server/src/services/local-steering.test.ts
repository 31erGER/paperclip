// fork 31erGER: tests for live local Pi steering authorization and delivery.
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import { createPiRpcSession } from "@paperclipai/adapter-pi-local/server";
import {
  canSteerLocalRun,
  trySteerActiveLocalRunFromAgentComment,
} from "./local-steering.js";

function fakeAgentDb(
  rowsById: Record<string, { id: string; role: string; reportsTo: string | null }>,
) {
  const queue = Object.values(rowsById);
  let callIndex = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            const row = queue[callIndex++];
            return Promise.resolve(row ? [row] : []);
          },
        }),
      }),
    }),
  } as unknown as Pick<Db, "select">;
}

describe("local steering bridge", () => {
  it("steers an active Pi RPC worker when the CEO posts a comment on its task", async () => {
    const runId = "local-steer-run-1";
    const stdin = new PassThrough();
    const written: string[] = [];
    stdin.on("data", (chunk) => written.push(chunk.toString("utf8")));

    const session = createPiRpcSession(runId, "Build report");
    session.attachStdin(stdin);
    expect(canSteerLocalRun(runId)).toBe(true);

    const db = fakeAgentDb({
      ceo: { id: "agent-ceo", role: "ceo", reportsTo: null },
    });

    const result = await trySteerActiveLocalRunFromAgentComment(db, {
      companyId: "co-1",
      issueIdentifier: "ENG-42",
      assigneeAgentId: "agent-worker",
      actorAgentId: "agent-ceo",
      actorAgentName: "CEO",
      activeRunId: runId,
      commentBody: "Use Q4 actuals from the Vault instead of estimates.",
    });

    const lines = written.join("").trim().split("\n");
    expect(lines.length).toBe(2);
    const cmd = JSON.parse(lines[1]!);
    expect(cmd.type).toBe("steer");
    expect(cmd.message).toContain("[Live steering from CEO on ENG-42]:");
    expect(cmd.message).toContain("Use Q4 actuals from the Vault");
    expect(result).toEqual({ steered: true, disposition: "queued", error: undefined });
    session.dispose();
  });

  it("does not auto-steer when a non-manager peer comments without explicit steer: true", async () => {
    const runId = "local-steer-run-2";
    const stdin = new PassThrough();
    const session = createPiRpcSession(runId, "Build report");
    session.attachStdin(stdin);

    const db = fakeAgentDb({
      peer: { id: "agent-peer", role: "engineer", reportsTo: "agent-ceo" },
      worker: { id: "agent-worker", role: "engineer", reportsTo: "agent-ceo" },
      ceo: { id: "agent-ceo", role: "ceo", reportsTo: null },
    });

    const result = await trySteerActiveLocalRunFromAgentComment(db, {
      companyId: "co-1",
      issueIdentifier: "ENG-43",
      assigneeAgentId: "agent-worker",
      actorAgentId: "agent-peer",
      actorAgentName: "Peer",
      activeRunId: runId,
      commentBody: "FYI note",
    });

    expect(result).toEqual({ steered: false });
    session.dispose();
  });
});
