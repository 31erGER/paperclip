import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url"; // fork 31erGER

export const DEFAULT_PAPERCLIP_INSTANCE_ID = "default";
export const PAPERCLIP_CONFIG_BASENAME = "config.json";
export const PAPERCLIP_ENV_FILENAME = ".env";

const PATH_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/;

export function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

export function resolvePaperclipHomeDir(homeOverride?: string): string {
  const raw = homeOverride?.trim() || process.env.PAPERCLIP_HOME?.trim();
  if (raw) return path.resolve(expandHomePrefix(raw));
  return path.resolve(os.homedir(), ".paperclip");
}

export function resolvePaperclipInstanceId(instanceIdOverride?: string): string {
  const raw = instanceIdOverride?.trim() || process.env.PAPERCLIP_INSTANCE_ID?.trim() || DEFAULT_PAPERCLIP_INSTANCE_ID;
  if (!PATH_SEGMENT_RE.test(raw)) {
    throw new Error(`Invalid PAPERCLIP_INSTANCE_ID '${raw}'.`);
  }
  return raw;
}

export function resolvePaperclipInstanceRoot(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePaperclipHomeDir(input.homeDir), "instances", resolvePaperclipInstanceId(input.instanceId));
}

export function resolvePaperclipInstanceConfigPath(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePaperclipInstanceRoot(input), PAPERCLIP_CONFIG_BASENAME);
}

export function resolvePaperclipConfigPathForInstance(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return resolvePaperclipInstanceConfigPath(input);
}

export function resolvePaperclipEnvPathForConfig(configPath: string): string {
  return path.resolve(path.dirname(configPath), PAPERCLIP_ENV_FILENAME);
}

export function resolveDefaultEmbeddedPostgresDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePaperclipInstanceRoot(input), "db");
}

export function resolveDefaultLogsDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePaperclipInstanceRoot(input), "logs");
}

export function resolveDefaultSecretsKeyFilePath(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePaperclipInstanceRoot(input), "secrets", "master.key");
}

export function resolveDefaultStorageDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePaperclipInstanceRoot(input), "data", "storage");
}

export function resolveDefaultBackupDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePaperclipInstanceRoot(input), "data", "backups");
}

export function resolveHomeAwarePath(value: string): string {
  return path.resolve(expandHomePrefix(value));
}

// fork 31erGER: company-scoped Obsidian-compatible Vault folder.
// Defaults to <paperclip-repo>/vaults/<companyId> (override via PAPERCLIP_VAULT_ROOT).
const REPO_VAULTS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "vaults",
);

export function resolveCompanyVaultDir(
  companyId: string,
  input: { homeDir?: string; instanceId?: string } = {},
): string {
  const trimmed = companyId.trim();
  if (!trimmed || !PATH_SEGMENT_RE.test(trimmed)) {
    throw new Error(`Invalid company id for vault path '${companyId}'.`);
  }
  const explicitRoot = process.env.PAPERCLIP_VAULT_ROOT?.trim();
  if (explicitRoot) {
    return path.resolve(expandHomePrefix(explicitRoot), trimmed);
  }
  const instanceId = resolvePaperclipInstanceId(input.instanceId);
  if (input.homeDir) {
    if (instanceId === DEFAULT_PAPERCLIP_INSTANCE_ID) {
      return path.resolve(resolvePaperclipHomeDir(input.homeDir), "vaults", trimmed);
    }
    return path.resolve(resolvePaperclipInstanceRoot(input), "vaults", trimmed);
  }
  if (instanceId === DEFAULT_PAPERCLIP_INSTANCE_ID) {
    return path.resolve(REPO_VAULTS_ROOT, trimmed);
  }
  return path.resolve(resolvePaperclipInstanceRoot(input), "vaults", trimmed);
}
