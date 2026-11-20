import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Keep the operator's own Pi setup in Paperclip runs (fork 31erGER, local
 * harness).
 *
 * A managed connection makes Paperclip point PI_CODING_AGENT_DIR at a fresh
 * directory that holds only the managed models.json. That hides everything
 * else in the operator's Pi directory (~/.pi/agent): extensions, installed
 * packages, settings, themes, prompt templates and the downloaded helper
 * tools. On a single-user local host that isolation only costs features, so
 * the managed directory links those entries back in.
 *
 * Never linked:
 * - models.json: the managed connection must win.
 * - auth.json: the operator's personal provider logins stay out of agent runs.
 * - sessions: Paperclip passes its own session file.
 * - skills: Paperclip passes its skills directory explicitly.
 * - AGENTS.md / SYSTEM.md / APPEND_SYSTEM.md: personal global instructions
 *   must not change what a Paperclip agent is told.
 */
export const HOST_PI_CONFIG_EXCLUDED = new Set([
  "models.json",
  "auth.json",
  "sessions",
  "skills",
  "AGENTS.md",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
]);

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

/**
 * On by default under the local deployment profiles; `PAPERCLIP_PI_HOST_CONFIG`
 * forces it on or off. Read from the server process environment, never from a
 * run's environment, so an agent cannot switch it on for itself.
 */
export function hostPiConfigLinkEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = env.PAPERCLIP_PI_HOST_CONFIG?.trim().toLowerCase();
  if (explicit && TRUTHY.has(explicit)) return true;
  if (explicit && FALSY.has(explicit)) return false;
  const profile = env.PAPERCLIP_DEPLOYMENT_PROFILE?.trim().toLowerCase().replace(/-/g, "_");
  return profile === "local" || profile === "local_only";
}

/** The Pi directory of the user who runs Paperclip. */
export function resolveHostPiAgentDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PI_CODING_AGENT_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), ".pi", "agent");
}

/**
 * Symlink every entry of `hostDir` into `managedDir`, except the excluded
 * names and anything that already exists there. Returns the linked names.
 * Removing the managed directory later removes only the links.
 */
export async function linkHostPiAgentConfig(managedDir: string, hostDir: string): Promise<string[]> {
  if (path.resolve(managedDir) === path.resolve(hostDir)) return [];
  let entries: string[];
  try {
    entries = await fs.readdir(hostDir);
  } catch {
    // No Pi directory on this host: nothing to keep.
    return [];
  }
  const linked: string[] = [];
  for (const name of entries.sort()) {
    if (HOST_PI_CONFIG_EXCLUDED.has(name)) continue;
    const target = path.join(managedDir, name);
    try {
      await fs.symlink(path.join(hostDir, name), target);
      linked.push(name);
    } catch (err) {
      // An entry the managed config already provides stays as it is.
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  return linked;
}
