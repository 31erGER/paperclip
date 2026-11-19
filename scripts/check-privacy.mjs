#!/usr/bin/env node
// Verify the fork's actual privacy policy after an upstream merge. No install
// or external service is required; the selected tests use local fixtures.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const files = [
  "packages/shared/src/telemetry/privacy.test.ts",
  "packages/adapter-utils/src/diagnostic-env.test.ts",
  "packages/adapter-utils/src/acpx-engine/terminal-session-failure.test.ts",
  "packages/adapter-utils/src/server-utils-env.test.ts",
  "packages/adapters/claude-local/src/server/quota.privacy.test.ts",
  "packages/adapters/codex-local/src/server/quota.privacy.test.ts",
  "server/src/__tests__/privacy-config.test.ts",
  "server/src/__tests__/external-diagnostics-policy.test.ts",
  "server/src/__tests__/agent-observability-policy.test.ts",
  "server/src/__tests__/diagnostic-exports-policy.test.ts",
  "server/src/__tests__/feedback-policy.test.ts",
  "server/src/__tests__/instance-settings-privacy-policy.test.ts",
  "ui/src/lib/sentry.privacy.test.ts",
  "ui/src/components/Identity.privacy.test.tsx",
  "ui/src/components/ui/avatar.privacy.test.tsx",
  "ui/src/components/PassiveIcon.privacy.test.tsx",
  "ui/src/components/MarkdownBody.privacy.test.tsx",
  "cli/src/__tests__/telemetry.test.ts",
  "cli/src/__tests__/update-notice.test.ts",
];
const result = spawnSync(process.execPath, [vitest, "run", ...files, "--maxWorkers=1", "--no-file-parallelism"], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
if (result.error) {
  console.error("Privacy checks could not start:", result.error.message);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
