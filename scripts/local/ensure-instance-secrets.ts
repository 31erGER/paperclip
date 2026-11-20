// Create the instance secrets that `paperclipai onboard` would create
// (fork 31erGER, local harness). The local start script skips the interactive
// onboarding, and without PAPERCLIP_AGENT_JWT_SECRET the server cannot mint
// the per-run bearer token (PAPERCLIP_API_KEY) for local agents: every agent
// call to the Paperclip API then fails with "Unauthorized", for example
// hiring another agent, although the agent's permissions allow it.
//
// Idempotent: existing values in the environment or the instance .env stay.
// Run from the repository root:
//   node cli/node_modules/tsx/dist/cli.mjs scripts/local/ensure-instance-secrets.ts
import path from "node:path";
import { ensureAgentJwtSecret, ensureToolActionSigningSecret } from "../../cli/src/config/env.ts";
import { resolvePaperclipEnvPath } from "../../server/src/paths.ts";

// The server reads <instance>/.env; the CLI helpers derive the same file from
// the config path next to it.
const envFilePath = resolvePaperclipEnvPath();
const configPath = path.join(path.dirname(envFilePath), "config.json");

const jwt = ensureAgentJwtSecret(configPath);
const toolAction = ensureToolActionSigningSecret(configPath);

const created = [
  ...(jwt.created ? ["PAPERCLIP_AGENT_JWT_SECRET"] : []),
  ...(toolAction.created ? ["PAPERCLIP_TOOL_ACTION_SIGNING_SECRET"] : []),
];
if (created.length > 0) {
  console.log(`[paperclip-local] created ${created.join(" and ")} in ${envFilePath}`);
}
