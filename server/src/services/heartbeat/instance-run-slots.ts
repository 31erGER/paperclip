import { and, eq, notInArray, sql } from "drizzle-orm";
import { heartbeatRuns, instanceSettings, type Db } from "@paperclipai/db";
import { effectiveMaxConcurrentAgentRuns, type DeploymentProfile } from "@paperclipai/shared";
import { resolveDeploymentProfile } from "../../lib/deployment-profile.js";

/**
 * Instance-wide run slots (fork 31erGER, local harness).
 *
 * A single local model server (llama.cpp, LM Studio) answers badly when many
 * agents call it at once. `general.maxConcurrentAgentRuns` caps how many agent
 * runs execute at the same time across all companies; the rest stay queued.
 * The per-agent `maxConcurrentRuns` still applies on top of this limit.
 *
 * Ownership: `assertAgentRunSlotFree` (run-slot-admission.ts) calls
 * `assertInstanceRunSlotFree` inside every claim transaction. A full instance
 * throws `InstanceRunSlotsFull`, which the queue treats like full agent slots
 * (the run stays queued). `queue.ts` promotes queued runs of any agent when a
 * run settles (`startNextQueuedRunsAfterRunSettled`).
 */

/** Advisory lock key that serializes instance-wide slot checks ("pclp" + 1). */
const INSTANCE_RUN_SLOT_LOCK_KEY = 0x70636c70_01;

/**
 * Number of extra express/steering slots reserved above `maxConcurrentAgentRuns`
 * so direct board messages to the CEO/coordinator or explicitly promoted ("Send now")
 * messages can run in parallel (e.g. 1 worker task + 1 CEO/steering session on
 * LM Studio) without ever waiting hours behind a background task queue.
 */
export const EXPRESS_STEERING_EXTRA_SLOTS = 1;

export interface RunSlotPriorityInput {
  invocationSource?: string | null;
  triggerDetail?: string | null;
  contextSnapshot?: Record<string, unknown> | null;
  agentRole?: string | null;
  agentReportsTo?: string | null;
}

/**
 * Priority tier for cross-agent queue promotion (lower number = starts first):
 *   0 — Explicitly promoted by the board ("Send now" / interrupt / steer priority)
 *   1 — Board/user direct message to an executive / coordinator agent (CEO or root agent)
 *   2 — Any other board/user direct message (chat or comment)
 *   3 — Background work (agent-to-agent tasks, assignments, timers, continuations)
 */
export function runQueuePriorityTier(input: RunSlotPriorityInput): 0 | 1 | 2 | 3 {
  const ctx =
    input.contextSnapshot && typeof input.contextSnapshot === "object"
      ? input.contextSnapshot
      : {};
  const explicitPriority =
    ctx.prioritySlot === true ||
    ctx.steerPriority === true ||
    typeof ctx.queuedCommentInterruptId === "string" ||
    typeof ctx.interruptedRunId === "string";
  if (explicitPriority) return 0;

  const isBoardTriggered =
    input.invocationSource === "on_demand" ||
    input.triggerDetail === "manual" ||
    ctx.triggeredBy === "board" ||
    ctx.conversationChat === true;

  const isExecutiveCoordinator =
    input.agentRole === "ceo" || input.agentReportsTo === null;

  if (isBoardTriggered && isExecutiveCoordinator) return 1;
  if (isBoardTriggered) return 2;
  return 3;
}

/**
 * Returns true when a run may claim the reserved +1 express/steering slot
 * beyond `maxConcurrentAgentRuns` (Tier 0 promoted runs or Tier 1 executive
 * coordinator direct board messages).
 */
export function isExpressSlotEligible(input: RunSlotPriorityInput): boolean {
  const tier = runQueuePriorityTier(input);
  return tier === 0 || tier === 1;
}

type SettingsReader = Pick<Db, "select">;

/** Effective instance-wide limit, or null when unlimited. */
export async function readInstanceRunLimit(
  db: SettingsReader,
  profile: DeploymentProfile = resolveDeploymentProfile(),
): Promise<number | null> {
  const [row] = await db
    .select({ general: instanceSettings.general })
    .from(instanceSettings)
    .where(eq(instanceSettings.singletonKey, "default"))
    .limit(1);
  const configured = (row?.general as Record<string, unknown> | undefined)?.maxConcurrentAgentRuns;
  return effectiveMaxConcurrentAgentRuns(typeof configured === "number" ? configured : null, profile);
}

export class InstanceRunSlotsFull extends Error {
  constructor(readonly running: number, readonly limit: number) {
    super("This instance already runs as many agent runs at once as it allows.");
    this.name = "InstanceRunSlotsFull";
  }
}

/**
 * Throw `InstanceRunSlotsFull` when the instance-wide limit is reached.
 * Runs inside the claim transaction. The transaction-scoped advisory lock
 * serializes concurrent claims (also across processes) until commit, so two
 * agents cannot both take the last free slot.
 *
 * `replacedRunIds` are runs the claiming run supersedes (itself, the run it
 * retries); they do not count as occupying a slot.
 *
 * When `options.express` is true (fork 31erGER), the run may use the +1
 * reserved express/steering slot beyond `limit` so the board can always reach
 * the CEO/coordinator or immediately run a promoted message while a worker task runs.
 */
export async function assertInstanceRunSlotFree(
  tx: Pick<Db, "select" | "execute">,
  replacedRunIds: string[],
  profile: DeploymentProfile = resolveDeploymentProfile(),
  options: { express?: boolean } = {},
): Promise<void> {
  const limit = await readInstanceRunLimit(tx, profile);
  if (limit === null) return;
  const effectiveLimit = options.express ? limit + EXPRESS_STEERING_EXTRA_SLOTS : limit;
  await tx.execute(sql`select pg_advisory_xact_lock(${INSTANCE_RUN_SLOT_LOCK_KEY})`);
  const [running] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(heartbeatRuns)
    .where(and(
      eq(heartbeatRuns.status, "running"),
      replacedRunIds.length > 0 ? notInArray(heartbeatRuns.id, replacedRunIds) : undefined,
    ));
  const count = Number(running?.count ?? 0);
  if (count >= effectiveLimit) throw new InstanceRunSlotsFull(count, effectiveLimit);
}
