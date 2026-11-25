// fork 31erGER: live local-adapter steering (Pi RPC) and express queue promotion.
import { and, desc, eq, sql } from "drizzle-orm";
import { agents, heartbeatRuns, type Db } from "@paperclipai/db";
import {
  canSteerPiRun,
  steerPiRun,
  type PiSteerResult,
} from "@paperclipai/adapter-pi-local/server";

export function canSteerLocalRun(runId: string | null | undefined): boolean {
  return canSteerPiRun(runId);
}

export async function steerLocalRun(
  runId: string,
  message: string,
): Promise<PiSteerResult> {
  return steerPiRun(runId, message);
}

/**
 * Returns true if `actorAgentId` is a company executive/coordinator (CEO or
 * root agent with no manager) or an ancestor in `targetAgentId`'s reporting chain.
 */
export async function isManagerOrExecutiveSteerer(
  db: Pick<Db, "select">,
  companyId: string,
  actorAgentId: string,
  targetAgentId: string,
): Promise<boolean> {
  if (actorAgentId === targetAgentId) return false;

  const [actorAgent] = await db
    .select({ id: agents.id, role: agents.role, reportsTo: agents.reportsTo })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.id, actorAgentId)))
    .limit(1);
  if (!actorAgent) return false;
  if (actorAgent.role === "ceo" || actorAgent.reportsTo === null) return true;

  let currentId: string | null = targetAgentId;
  const visited = new Set<string>();
  for (let depth = 0; depth < 12 && currentId; depth += 1) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const [row] = await db
      .select({ reportsTo: agents.reportsTo })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, currentId)))
      .limit(1);
    if (!row?.reportsTo) break;
    if (row.reportsTo === actorAgentId) return true;
    currentId = row.reportsTo;
  }
  return false;
}

export async function trySteerActiveLocalRunFromAgentComment(
  db: Pick<Db, "select">,
  input: {
    companyId: string;
    issueIdentifier?: string | null;
    assigneeAgentId: string;
    actorAgentId: string;
    actorAgentName?: string | null;
    activeRunId: string | null | undefined;
    commentBody: string;
    explicitSteer?: boolean;
  },
): Promise<{ steered: boolean; disposition?: string; error?: string }> {
  if (!input.activeRunId || !canSteerLocalRun(input.activeRunId)) {
    return { steered: false };
  }
  if (input.actorAgentId === input.assigneeAgentId) {
    return { steered: false };
  }
  const allowed =
    input.explicitSteer === true ||
    (await isManagerOrExecutiveSteerer(
      db,
      input.companyId,
      input.actorAgentId,
      input.assigneeAgentId,
    ));
  if (!allowed) {
    return { steered: false };
  }

  const trimmed = input.commentBody.trim();
  if (!trimmed) return { steered: false };

  const sender = input.actorAgentName?.trim() || "Manager";
  const scope = input.issueIdentifier ? ` on ${input.issueIdentifier}` : "";
  const formatted = `[Live steering from ${sender}${scope}]:\n${trimmed}`;
  const result = await steerLocalRun(input.activeRunId, formatted);
  return {
    steered: result.ok,
    disposition: result.disposition,
    error: result.error,
  };
}

/**
 * Promote a queued heartbeat run to express priority (`contextSnapshot.prioritySlot = true`)
 * so it immediately qualifies for the +1 reserved express slot and jumps to Tier 0 in
 * cross-agent queue dispatch.
 */
export async function promoteQueuedIssueRunToExpressSlot(
  db: Pick<Db, "select" | "update">,
  input: {
    companyId: string;
    issueId: string;
    agentId?: string | null;
    runId?: string | null;
  },
): Promise<{ id: string; agentId: string } | null> {
  const [target] = await db
    .select({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId })
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.companyId, input.companyId),
        eq(heartbeatRuns.status, "queued"),
        input.runId ? eq(heartbeatRuns.id, input.runId) : undefined,
        input.agentId ? eq(heartbeatRuns.agentId, input.agentId) : undefined,
        sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${input.issueId}`,
      ),
    )
    .orderBy(desc(heartbeatRuns.createdAt))
    .limit(1);
  if (!target) return null;

  const [updated] = await db
    .update(heartbeatRuns)
    .set({
      contextSnapshot: sql`coalesce(${heartbeatRuns.contextSnapshot}, '{}'::jsonb) || '{"prioritySlot": true}'::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(heartbeatRuns.id, target.id),
        eq(heartbeatRuns.companyId, input.companyId),
        eq(heartbeatRuns.status, "queued"),
      ),
    )
    .returning({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId });

  return updated ?? null;
}
