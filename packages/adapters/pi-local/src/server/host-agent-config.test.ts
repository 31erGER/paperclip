import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hostPiConfigLinkEnabled, linkHostPiAgentConfig, resolveHostPiAgentDir } from "./host-agent-config.js";
import { preparePiRuntimeConfig } from "./runtime-config.js";

const cleanup = new Set<string>();
afterEach(async () => {
  for (const dir of cleanup) await fs.rm(dir, { recursive: true, force: true });
  cleanup.clear();
});

async function makeHostDir() {
  const hostDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-host-agent-"));
  cleanup.add(hostDir);
  await fs.mkdir(path.join(hostDir, "extensions"));
  await fs.writeFile(path.join(hostDir, "extensions", "notify.ts"), "export default () => {};\n");
  await fs.mkdir(path.join(hostDir, "sessions"));
  await fs.mkdir(path.join(hostDir, "skills"));
  await fs.mkdir(path.join(hostDir, "bin"));
  await fs.writeFile(path.join(hostDir, "settings.json"), '{"theme":"dark"}\n');
  await fs.writeFile(path.join(hostDir, "auth.json"), '{"anthropic":"personal-login"}\n');
  await fs.writeFile(path.join(hostDir, "models.json"), '{"providers":{"mine":{}}}\n');
  await fs.writeFile(path.join(hostDir, "AGENTS.md"), "personal instructions\n");
  return hostDir;
}

const PROVIDERS = JSON.stringify({ paperclip: { baseUrl: "http://localhost:1234/v1", api: "openai-completions", apiKey: "local-no-auth", models: [{ id: "m" }] } });

describe("host Pi configuration", () => {
  it("is on for the local deployment profiles and follows the explicit switch", () => {
    expect(hostPiConfigLinkEnabled({})).toBe(false);
    expect(hostPiConfigLinkEnabled({ PAPERCLIP_DEPLOYMENT_PROFILE: "standard" })).toBe(false);
    expect(hostPiConfigLinkEnabled({ PAPERCLIP_DEPLOYMENT_PROFILE: "local" })).toBe(true);
    expect(hostPiConfigLinkEnabled({ PAPERCLIP_DEPLOYMENT_PROFILE: "local-only" })).toBe(true);
    expect(hostPiConfigLinkEnabled({ PAPERCLIP_DEPLOYMENT_PROFILE: "local_only", PAPERCLIP_PI_HOST_CONFIG: "0" })).toBe(false);
    expect(hostPiConfigLinkEnabled({ PAPERCLIP_PI_HOST_CONFIG: "true" })).toBe(true);
  });

  it("resolves the operator's Pi directory", () => {
    expect(resolveHostPiAgentDir({})).toBe(path.join(os.homedir(), ".pi", "agent"));
    expect(resolveHostPiAgentDir({ PI_CODING_AGENT_DIR: "/srv/pi-agent" })).toBe("/srv/pi-agent");
  });

  it("links extensions, settings and tools but never credentials, models, sessions, skills or personal instructions", async () => {
    const hostDir = await makeHostDir();
    const managedDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-managed-agent-"));
    cleanup.add(managedDir);
    await fs.writeFile(path.join(managedDir, "models.json"), '{"providers":{"paperclip":{}}}\n');

    const linked = await linkHostPiAgentConfig(managedDir, hostDir);
    expect(linked).toEqual(["bin", "extensions", "settings.json"]);
    expect((await fs.readdir(managedDir)).sort()).toEqual(["bin", "extensions", "models.json", "settings.json"]);
    expect(await fs.readFile(path.join(managedDir, "extensions", "notify.ts"), "utf8")).toContain("export default");
    // The managed models.json stays the managed one.
    expect(await fs.readFile(path.join(managedDir, "models.json"), "utf8")).toContain("paperclip");
  });

  it("does nothing without a host directory or when both directories are the same", async () => {
    const managedDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-managed-agent-"));
    cleanup.add(managedDir);
    expect(await linkHostPiAgentConfig(managedDir, path.join(managedDir, "missing"))).toEqual([]);
    expect(await linkHostPiAgentConfig(managedDir, managedDir)).toEqual([]);
  });

  it("adds the host configuration to the managed run directory and keeps host files on cleanup", async () => {
    const hostDir = await makeHostDir();
    const prepared = await preparePiRuntimeConfig({ env: { PAPERCLIP_PI_PROVIDERS: PROVIDERS }, linkHostConfig: true, hostAgentDir: hostDir });
    const agentDir = prepared.env.PI_CODING_AGENT_DIR!;
    cleanup.add(agentDir);
    expect(agentDir).not.toBe(hostDir);
    expect((await fs.readdir(agentDir)).sort()).toEqual(["bin", "extensions", "models.json", "settings.json"]);
    expect(JSON.parse(await fs.readFile(path.join(agentDir, "models.json"), "utf8")).providers.paperclip.baseUrl).toBe("http://localhost:1234/v1");
    expect(prepared.notes.join("\n")).toContain("Linked the host Pi configuration");

    await prepared.cleanup();
    await expect(fs.stat(agentDir)).rejects.toThrow();
    // Cleanup removed the links only.
    expect(await fs.readFile(path.join(hostDir, "extensions", "notify.ts"), "utf8")).toContain("export default");
    expect(await fs.readFile(path.join(hostDir, "settings.json"), "utf8")).toContain("dark");
    expect(await fs.readFile(path.join(hostDir, "auth.json"), "utf8")).toContain("personal-login");
  });

  it("keeps the upstream behavior when linking is off", async () => {
    const hostDir = await makeHostDir();
    const prepared = await preparePiRuntimeConfig({ env: { PAPERCLIP_PI_PROVIDERS: PROVIDERS }, linkHostConfig: false, hostAgentDir: hostDir });
    cleanup.add(prepared.env.PI_CODING_AGENT_DIR!);
    expect(await fs.readdir(prepared.env.PI_CODING_AGENT_DIR!)).toEqual(["models.json"]);
  });
});
