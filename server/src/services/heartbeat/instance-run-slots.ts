import { eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns } from "@paperclipai/db";
import {
  effectiveMaxConcurrentAgentRuns,
  type DeploymentProfile,
  type InstanceGeneralSettings,
} from "@paperclipai/shared";

/**
 * Instance-wide run slots (fork 31erGER, local harness).
 *
 * A single local model server (llama.cpp, LM Studio) answers badly when many
 * agents call it at once. `general.maxConcurrentAgentRuns` caps how many agent
 * runs execute at the same time across all companies; the rest stay queued.
 * The per-agent `maxConcurrentRuns` still applies on top of this limit.
 *
 * Ownership: queue admission (`queue.ts`) asks this module for free slots
 * while holding the admission lock below, then claims at most that many runs.
 */
export interface InstanceRunSlotsDependencies {
  getGeneral: () => Promise<Pick<InstanceGeneralSettings, "maxConcurrentAgentRuns">>;
  deploymentProfile: DeploymentProfile;
}

export function createInstanceRunSlots(db: Db, deps: InstanceRunSlotsDependencies) {
  // Promise chain used as an in-process mutex. Paperclip runs one server
  // process per instance, so the slot check and the claim cannot race across
  // processes.
  let admissionTail: Promise<void> = Promise.resolve();

  /** Effective limit, or null when unlimited. */
  async function resolveLimit(): Promise<number | null> {
    const general = await deps.getGeneral();
    return effectiveMaxConcurrentAgentRuns(general.maxConcurrentAgentRuns, deps.deploymentProfile);
  }

  async function countRunningRuns(): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.status, "running"));
    return Number(row?.count ?? 0);
  }

  /**
   * Run `admit` with the number of free instance slots. Without a limit this
   * is `Infinity` and no lock is taken (upstream behavior). With a limit, the
   * slot count and everything `admit` claims happen under one lock, so two
   * agents cannot both take the last free slot.
   */
  async function withAdmission<T>(admit: (freeSlots: number) => Promise<T>): Promise<T> {
    const limit = await resolveLimit();
    if (limit === null) return admit(Number.POSITIVE_INFINITY);

    const previous = admissionTail;
    let release!: () => void;
    admissionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const running = await countRunningRuns();
      return await admit(Math.max(0, limit - running));
    } finally {
      release();
    }
  }

  return { resolveLimit, countRunningRuns, withAdmission };
}

export type InstanceRunSlots = ReturnType<typeof createInstanceRunSlots>;
