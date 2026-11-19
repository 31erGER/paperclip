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
 */
export async function assertInstanceRunSlotFree(
  tx: Pick<Db, "select" | "execute">,
  replacedRunIds: string[],
  profile: DeploymentProfile = resolveDeploymentProfile(),
): Promise<void> {
  const limit = await readInstanceRunLimit(tx, profile);
  if (limit === null) return;
  await tx.execute(sql`select pg_advisory_xact_lock(${INSTANCE_RUN_SLOT_LOCK_KEY})`);
  const [running] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(heartbeatRuns)
    .where(and(
      eq(heartbeatRuns.status, "running"),
      replacedRunIds.length > 0 ? notInArray(heartbeatRuns.id, replacedRunIds) : undefined,
    ));
  const count = Number(running?.count ?? 0);
  if (count >= limit) throw new InstanceRunSlotsFull(count, limit);
}
