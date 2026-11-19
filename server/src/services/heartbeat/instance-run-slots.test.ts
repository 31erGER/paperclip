import { describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import { createInstanceRunSlots } from "./instance-run-slots.js";

/** Minimal Db stand-in: counts rows in an in-memory "running" set. */
function fakeDb(running: { count: number }) {
  return {
    select: () => ({ from: () => ({ where: async () => [{ count: running.count }] }) }),
  } as unknown as Db;
}

describe("instance run slots", () => {
  it("is unlimited in the standard profile without a setting", async () => {
    const slots = createInstanceRunSlots(fakeDb({ count: 50 }), {
      getGeneral: async () => ({}),
      deploymentProfile: "standard",
    });
    expect(await slots.resolveLimit()).toBeNull();
    await expect(slots.withAdmission(async (free) => free)).resolves.toBe(Number.POSITIVE_INFINITY);
  });

  it("defaults to one slot under local_only", async () => {
    const running = { count: 0 };
    const slots = createInstanceRunSlots(fakeDb(running), {
      getGeneral: async () => ({}),
      deploymentProfile: "local_only",
    });
    await expect(slots.withAdmission(async (free) => free)).resolves.toBe(1);
    running.count = 1;
    await expect(slots.withAdmission(async (free) => free)).resolves.toBe(0);
  });

  it("uses the configured limit", async () => {
    const slots = createInstanceRunSlots(fakeDb({ count: 1 }), {
      getGeneral: async () => ({ maxConcurrentAgentRuns: 3 }),
      deploymentProfile: "local",
    });
    await expect(slots.withAdmission(async (free) => free)).resolves.toBe(2);
  });

  it("serializes admissions so the last slot is claimed once", async () => {
    const running = { count: 0 };
    const slots = createInstanceRunSlots(fakeDb(running), {
      getGeneral: async () => ({ maxConcurrentAgentRuns: 1 }),
      deploymentProfile: "local",
    });
    const claims: number[] = [];
    const admit = (id: number) => slots.withAdmission(async (free) => {
      if (free <= 0) return false;
      await new Promise((resolve) => setTimeout(resolve, 5));
      running.count += 1; // the claim marks the run as running
      claims.push(id);
      return true;
    });
    const results = await Promise.all([admit(1), admit(2), admit(3)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(claims).toEqual([1]);
  });

  it("releases the lock when admission throws", async () => {
    const slots = createInstanceRunSlots(fakeDb({ count: 0 }), {
      getGeneral: async () => ({ maxConcurrentAgentRuns: 1 }),
      deploymentProfile: "local",
    });
    await expect(slots.withAdmission(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(slots.withAdmission(async (free) => free)).resolves.toBe(1);
  });
});
