import { describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import {
  assertInstanceRunSlotFree,
  InstanceRunSlotsFull,
  isExpressSlotEligible,
  readInstanceRunLimit,
  runQueuePriorityTier,
} from "./instance-run-slots.js";

/**
 * Minimal Db stand-in. The first select reads instance settings (with
 * `.limit()`), the second counts running runs (awaited after `.where()`).
 */
function fakeTx(general: Record<string, unknown>, running: number) {
  const executed: unknown[] = [];
  let selects = 0;
  const tx = {
    select: () => {
      selects += 1;
      const isSettings = selects === 1;
      return {
        from: () => ({
          where: () => {
            const rows = isSettings ? [{ general }] : [{ count: running }];
            const result = Promise.resolve(rows) as Promise<unknown[]> & { limit: () => Promise<unknown[]> };
            result.limit = () => Promise.resolve(rows);
            return result;
          },
        }),
      };
    },
    execute: async (query: unknown) => {
      executed.push(query);
      return [];
    },
  };
  return { tx: tx as unknown as Db, executed };
}

describe("instance run slots", () => {
  it("is unlimited in the standard profile without a setting", async () => {
    const { tx } = fakeTx({}, 50);
    expect(await readInstanceRunLimit(tx, "standard")).toBeNull();
  });

  it("defaults to one slot under local_only and honors the setting", async () => {
    expect(await readInstanceRunLimit(fakeTx({}, 0).tx, "local_only")).toBe(1);
    expect(await readInstanceRunLimit(fakeTx({ maxConcurrentAgentRuns: 3 }, 0).tx, "local")).toBe(3);
  });

  it("skips the lock entirely without a limit", async () => {
    const { tx, executed } = fakeTx({}, 99);
    await expect(assertInstanceRunSlotFree(tx, [], "standard")).resolves.toBeUndefined();
    expect(executed).toHaveLength(0);
  });

  it("admits while slots are free and takes the advisory lock", async () => {
    const { tx, executed } = fakeTx({ maxConcurrentAgentRuns: 2 }, 1);
    await expect(assertInstanceRunSlotFree(tx, ["run-a"], "local")).resolves.toBeUndefined();
    expect(executed).toHaveLength(1);
  });

  it("refuses when the instance is full", async () => {
    const { tx } = fakeTx({}, 1);
    await expect(assertInstanceRunSlotFree(tx, [], "local_only")).rejects.toBeInstanceOf(InstanceRunSlotsFull);
  });

  it("admits an express/steering run into the +1 reserved slot while 1 background run is active, and caps at limit + 1", async () => {
    const { tx: txWithOne } = fakeTx({}, 1);
    await expect(
      assertInstanceRunSlotFree(txWithOne, [], "local_only", { express: true }),
    ).resolves.toBeUndefined();

    const { tx: txWithTwo } = fakeTx({}, 2);
    await expect(
      assertInstanceRunSlotFree(txWithTwo, [], "local_only", { express: true }),
    ).rejects.toBeInstanceOf(InstanceRunSlotsFull);
  });

  it("ranks promoted > CEO board messages > other board messages > background agent tasks", () => {
    const promoted = runQueuePriorityTier({
      invocationSource: "automation",
      contextSnapshot: { prioritySlot: true },
      agentRole: "engineer",
      agentReportsTo: "ceo-1",
    });
    const ceoChat = runQueuePriorityTier({
      invocationSource: "on_demand",
      triggerDetail: "manual",
      contextSnapshot: { triggeredBy: "board", conversationChat: true },
      agentRole: "ceo",
      agentReportsTo: null,
    });
    const workerBoardChat = runQueuePriorityTier({
      invocationSource: "on_demand",
      triggerDetail: "manual",
      contextSnapshot: { triggeredBy: "board", conversationChat: true },
      agentRole: "engineer",
      agentReportsTo: "ceo-1",
    });
    const backgroundTask = runQueuePriorityTier({
      invocationSource: "assignment",
      triggerDetail: "system",
      contextSnapshot: { source: "issue.assigned" },
      agentRole: "engineer",
      agentReportsTo: "ceo-1",
    });

    expect(promoted).toBe(0);
    expect(ceoChat).toBe(1);
    expect(workerBoardChat).toBe(2);
    expect(backgroundTask).toBe(3);

    expect(isExpressSlotEligible({ contextSnapshot: { prioritySlot: true }, agentRole: "engineer", agentReportsTo: "ceo-1" })).toBe(true);
    expect(isExpressSlotEligible({ invocationSource: "on_demand", agentRole: "ceo", agentReportsTo: null })).toBe(true);
    expect(isExpressSlotEligible({ invocationSource: "on_demand", agentRole: "engineer", agentReportsTo: "ceo-1" })).toBe(false);
    expect(isExpressSlotEligible({ invocationSource: "assignment", agentRole: "ceo", agentReportsTo: null })).toBe(false);
  });
});
