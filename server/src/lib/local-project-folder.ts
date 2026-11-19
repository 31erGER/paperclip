import { stat } from "node:fs/promises";
import path from "node:path";

/**
 * Validate a project folder on this host (fork 31erGER, local harness).
 *
 * Under a local deployment profile a project is a folder on the machine that
 * runs Paperclip, like a Claude Code project. Catch typos at save time
 * instead of at the first agent run: the path must be absolute and point to
 * an existing directory.
 *
 * Returns an error message, or null when the folder is usable.
 */
export async function checkLocalProjectFolder(cwd: string): Promise<string | null> {
  const trimmed = cwd.trim();
  if (!path.isAbsolute(trimmed)) {
    return `Project folder must be an absolute path on this host: ${trimmed}`;
  }
  try {
    const info = await stat(trimmed);
    if (!info.isDirectory()) return `Project folder is not a directory: ${trimmed}`;
    return null;
  } catch {
    return `Project folder does not exist on this host: ${trimmed}. Create it first (mkdir -p "${trimmed}").`;
  }
}
