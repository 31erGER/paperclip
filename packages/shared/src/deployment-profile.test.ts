import { describe, expect, it } from "vitest";
import {
  LOCAL_ONLY_DEFAULT_MAX_CONCURRENT_AGENT_RUNS,
  MAX_CONCURRENT_AGENT_RUNS_LIMIT,
  effectiveMaxConcurrentAgentRuns,
  hidesCostMetrics,
  isLocalDeploymentProfile,
  parseDeploymentProfile,
} from "./deployment-profile.js";
import { instanceGeneralSettingsSchema } from "./validators/instance.js";

describe("deployment profile", () => {
  it("parses known profiles and falls back to standard", () => {
    expect(parseDeploymentProfile("local")).toBe("local");
    expect(parseDeploymentProfile(" LOCAL-ONLY ")).toBe("local_only");
    expect(parseDeploymentProfile("cloud")).toBe("standard");
    expect(parseDeploymentProfile(undefined)).toBe("standard");
  });

  it("classifies local profiles and cost visibility", () => {
    expect(isLocalDeploymentProfile("standard")).toBe(false);
    expect(isLocalDeploymentProfile("local")).toBe(true);
    expect(isLocalDeploymentProfile("local_only")).toBe(true);
    expect(hidesCostMetrics("local")).toBe(false);
    expect(hidesCostMetrics("local_only")).toBe(true);
  });

  it("resolves the instance-wide run limit", () => {
    expect(effectiveMaxConcurrentAgentRuns(undefined, "standard")).toBeNull();
    expect(effectiveMaxConcurrentAgentRuns(null, "local")).toBeNull();
    expect(effectiveMaxConcurrentAgentRuns(null, "local_only")).toBe(LOCAL_ONLY_DEFAULT_MAX_CONCURRENT_AGENT_RUNS);
    expect(effectiveMaxConcurrentAgentRuns(3, "standard")).toBe(3);
    expect(effectiveMaxConcurrentAgentRuns(4, "local_only")).toBe(4);
    expect(effectiveMaxConcurrentAgentRuns(1000, "local")).toBe(MAX_CONCURRENT_AGENT_RUNS_LIMIT);
    expect(effectiveMaxConcurrentAgentRuns(0, "local_only")).toBe(1);
  });

  it("validates the general setting", () => {
    expect(instanceGeneralSettingsSchema.safeParse({ maxConcurrentAgentRuns: 2 }).success).toBe(true);
    expect(instanceGeneralSettingsSchema.safeParse({ maxConcurrentAgentRuns: null }).success).toBe(true);
    expect(instanceGeneralSettingsSchema.safeParse({ maxConcurrentAgentRuns: 0 }).success).toBe(false);
    expect(instanceGeneralSettingsSchema.safeParse({ maxConcurrentAgentRuns: 1.5 }).success).toBe(false);
  });
});
