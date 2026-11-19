# AGENTS.fork.md — working on the local harness fork

Short guide for a coding agent (for example Pi with a local model) that
changes this fork from a terminal session. Read this instead of the long docs
listed in `AGENTS.md` unless the task really needs them.

## What this fork adds

Paperclip runs on one Linux host without containers. A project is a folder on
that host. Agents run as host processes. Operators pick a deployment profile
with `PAPERCLIP_DEPLOYMENT_PROFILE` = `standard | local | local_only`.

| Feature | Files (start here) |
| --- | --- |
| Profile definition, run-limit math | `packages/shared/src/deployment-profile.ts` |
| Server profile + settings overlay | `server/src/lib/deployment-profile.ts`, `server/src/services/instance-settings.ts` (search `deploymentProfile`) |
| Legacy runner only | `server/src/lib/agent-runner-platform.ts`, `server/src/services/agent-runner-selection.ts` (search `isLocalProfileActive`) |
| Instance-wide run queue | `server/src/services/heartbeat/instance-run-slots.ts`; hooked into the claim transaction by `heartbeat/run-slot-admission.ts`; cross-agent promotion in `heartbeat/queue.ts` (search `startNextQueuedRunsAfterRunSettled`) |
| Queue setting UI | `ui/src/components/AgentRunQueueSetting.tsx` |
| Hide price metrics | `ui/src/hooks/useDeploymentProfile.ts`, `ui/src/components/CostMetricsGate.tsx` (search `showCostMetrics`) |
| Local first-agent onboarding (Pi/Hermes + LM Studio) | `ui/src/components/OnboardingWizard.tsx` (search `LOCAL_MODEL_ONBOARDING_TYPES`, `isLocalSource`), `ui/src/components/onboarding/OnboardingLocalSetup.tsx` |
| Project folder | `ui/src/components/NewProjectDialog.tsx`, `server/src/lib/local-project-folder.ts`, `server/src/routes/projects.ts` (search `checkLocalProjectFolder`) |
| Start / stop / reset without containers | `paperclip-local.sh` (repository root), `scripts/local/paperclip-local.service`, `README-LOCAL.md` |
| Upstream updates | `scripts/local/update-from-upstream.sh` (check / merge); migration check base in `packages/db/scripts/migration-compatibility.ts` |
| Operator guide | `doc/local/README.md` |
| German guides (usage, upstream merge) | `doc/local/ANLEITUNG-LOCAL-HARNESS.md`, `doc/local/ANLEITUNG-UPSTREAM-MERGE.md` |

## Rules

1. Keep fork changes small and in the files above. Prefer a new small module
   plus a one-line hook over editing large upstream files. `heartbeat/queue.ts`
   and `heartbeat.ts` have thousands of lines: search, do not read them whole.
2. Do not edit generated files, lockfiles, or `doc/plans/` history.
3. Never weaken company scoping, approvals, or budget hard stops.
4. Mark fork-specific code with a short comment containing `fork 31erGER`.
5. UI: use existing tokens and components only (no hex colors, no raw px).

## Commands

```sh
./paperclip-local.sh dev      # run with file watching on :3100
./paperclip-local.sh status   # health + active profile
pnpm local:check                          # fork tests + shared typecheck (~20 s)
npx vitest run <path/to/file.test.ts>     # one test file
cd server && npx tsc --noEmit -p .        # server typecheck (slow, ~2 min)
cd ui && npx tsc --noEmit -p .            # ui typecheck (storybook catalog errors are known)
```

Do not run `pnpm build` or `pnpm test:run` for small changes: the full build
needs Rust and a C compiler for packages the local harness does not use.

## Finishing a change

1. Add or update a focused `*.test.ts` next to the changed module.
2. Run `pnpm local:check` and the test files you touched.
3. If behavior changed, update `doc/local/README.md`.
4. Summarize what changed and what you did not verify.
