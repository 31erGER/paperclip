import { agents, heartbeatRuns, type Db } from "@paperclipai/db";
import { isUuidLike } from "@paperclipai/shared";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { maxConcurrentRunsSql } from "./timer-policy.js";
import {
  assertInstanceRunSlotFree,
  InstanceRunSlotsFull,
  isExpressSlotEligible,
} from "./instance-run-slots.js";

export class AgentRunSlotsFull extends Error {
  constructor(readonly agentId: string, readonly running: number, readonly limit: number) {
    super("The agent already runs as many runs at once as it allows.");
    this.name = "AgentRunSlotsFull";
  }
}

type ClaimingRun = Pick<
  typeof heartbeatRuns.$inferSelect,
  "id" | "companyId" | "agentId" | "retryOfRunId" | "contextSnapshot"
> & {
  invocationSource?: string | null;
  triggerDetail?: string | null;
};

export async function assertAgentRunSlotFree(tx: Pick<Db, "select" | "execute">, run: ClaimingRun) {
  const previousRunId = (run.contextSnapshot as Record<string, unknown> | null)?.previousRunId;
  const replaced = [run.id, run.retryOfRunId, typeof previousRunId === "string" ? previousRunId : null]
    .filter((id): id is string => typeof id === "string" && isUuidLike(id));
  const [running] = await tx.select({ count: sql<number>`count(*)::int` }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, run.companyId), eq(heartbeatRuns.agentId, run.agentId), eq(heartbeatRuns.status, "running"),
    notInArray(heartbeatRuns.id, replaced)));
  const [agent] = await tx
    .select({ limit: maxConcurrentRunsSql(), role: agents.role, reportsTo: agents.reportsTo })
    .from(agents)
    .where(and(eq(agents.id, run.agentId), eq(agents.companyId, run.companyId)));
  if (!agent) return;
  const count = Number(running?.count ?? 0);
  const limit = Number(agent.limit);
  if (count >= limit) throw new AgentRunSlotsFull(run.agentId, count, limit);
  // Fork 31erGER: instance-wide run limit with +1 reserved express slot for
  // direct board messages to CEO/coordinator or explicitly promoted ("Send now") runs.
  const express = isExpressSlotEligible({
    invocationSource: run.invocationSource,
    triggerDetail: run.triggerDetail,
    contextSnapshot: (run.contextSnapshot as Record<string, unknown> | null) ?? null,
    agentRole: agent.role,
    agentReportsTo: agent.reportsTo,
  });
  try {
    await assertInstanceRunSlotFree(tx, replaced, undefined, { express });
  } catch (error) {
    if (error instanceof InstanceRunSlotsFull) throw new AgentRunSlotsFull(run.agentId, error.running, error.limit);
    throw error;
  }
}
