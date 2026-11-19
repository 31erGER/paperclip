import { describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import { instanceSettingsService } from "../services/instance-settings.js";

describe("effective sharing settings under the production privacy policy", () => {
  it.each(["allowed", "prompt"] as const)("returns local-only sharing for a stored %s choice without rewriting it", async preference => {
    const row = { id: "settings", singletonKey: "default", defaultEnvironmentId: null,
      general: { feedbackDataSharingPreference: preference }, experimental: {}, createdAt: new Date(), updatedAt: new Date() };
    const db = { select: () => ({ from: () => ({ where: async () => [row] }) }) } as unknown as Db;
    const service = instanceSettingsService(db, { runtimeEnv: {} });
    expect((await service.getGeneral()).feedbackDataSharingPreference).toBe("not_allowed");
    expect((await service.get()).general.feedbackDataSharingPreference).toBe("not_allowed");
    expect(row.general.feedbackDataSharingPreference).toBe(preference);
  });
});
