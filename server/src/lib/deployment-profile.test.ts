import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { InstanceExperimentalSettings } from "@paperclipai/shared";
import { normalizeExperimentalSettings } from "../services/instance-settings.js";
import {
  applyDeploymentProfileExperimentalOverlay,
  isLocalProfileActive,
  resolveDeploymentProfile,
} from "./deployment-profile.js";
import { checkLocalProjectFolder } from "./local-project-folder.js";

function experimental(overrides: Partial<InstanceExperimentalSettings> = {}) {
  return { ...normalizeExperimentalSettings({}), ...overrides };
}

describe("deployment profile (server)", () => {
  it("reads PAPERCLIP_DEPLOYMENT_PROFILE", () => {
    expect(resolveDeploymentProfile({})).toBe("standard");
    expect(resolveDeploymentProfile({ PAPERCLIP_DEPLOYMENT_PROFILE: "local_only" })).toBe("local_only");
    expect(isLocalProfileActive({ PAPERCLIP_DEPLOYMENT_PROFILE: "local" })).toBe(true);
    expect(isLocalProfileActive({ PAPERCLIP_DEPLOYMENT_PROFILE: "standard" })).toBe(false);
  });

  it("forces runner, sandbox and hosted-agent flags off in local profiles", () => {
    const stored = experimental({ enableNativeRunner: true, enableManagedSandboxOnly: true, enableOpenAiDot: true, enableCases: true });
    const local = applyDeploymentProfileExperimentalOverlay(stored, "local");
    expect(local.enableNativeRunner).toBe(false);
    expect(local.enableManagedSandboxOnly).toBe(false);
    expect(local.enableOpenAiDot).toBe(false);
    // Unrelated flags keep their stored value.
    expect(local.enableCases).toBe(true);
  });

  it("leaves the standard profile untouched", () => {
    const stored = experimental({ enableNativeRunner: true });
    expect(applyDeploymentProfileExperimentalOverlay(stored, "standard")).toBe(stored);
  });
});

describe("checkLocalProjectFolder", () => {
  it("accepts an existing absolute directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "paperclip-folder-"));
    await expect(checkLocalProjectFolder(dir)).resolves.toBeNull();
  });

  it("rejects relative, missing and non-directory paths", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "paperclip-folder-"));
    const file = path.join(dir, "file.txt");
    await writeFile(file, "x");
    await expect(checkLocalProjectFolder("projects/demo")).resolves.toMatch(/absolute path/);
    await expect(checkLocalProjectFolder(path.join(dir, "missing"))).resolves.toMatch(/does not exist/);
    await expect(checkLocalProjectFolder(file)).resolves.toMatch(/not a directory/);
  });
});
