# Local harness mode (fork 31erGER)

Goal: run Paperclip on a single Linux (or WSL) host without containers, as a
meta harness that manages agents for several companies and projects. Each
project is a host folder, like a Claude Code project. The primary models are
local (llama.cpp / LM Studio, OpenAI-compatible) driven by the `pi_local`
adapter.

Approach: a switchable mode with isolated changes. Cloud, sandbox and Runner
code stays in the tree but is disabled and hidden, so upstream merges keep
working. New behavior lives in small, separate modules so a local coding agent
(Pi with a 32k-context model) can work on it without reading the 5000-line
heartbeat files.

## Profiles

Selected by the operator with `PAPERCLIP_DEPLOYMENT_PROFILE` (environment,
read at start; exposed to the board through `/api/health`):

| Profile | Effect |
| --- | --- |
| `standard` (default) | Upstream behavior. |
| `local` | Legacy runner only (agents spawn the CLI on the host), Local environment only, managed-sandbox/k8s/low-trust policies off, Runner/sandbox UI hidden. Cloud models still allowed. |
| `local_only` | Everything from `local`, plus: price and cost metrics hidden (Costs page, cost columns, budget money values), model concurrency defaults to 1. Intended for local models only. |

## Work items

1. **Runner selection** — `agentRunnerAvailability` returns legacy-only when the
   profile is not `standard`; `enableNativeRunner` reads as false. Covers the
   Linux x64/glibc case where upstream otherwise defaults new agents to
   Paperclip Runner.
2. **Price metrics** — one UI helper `useShowCostMetrics()`; Costs route,
   sidebar links and cost cells check it. Server keeps recording cost events
   (run log), only presentation changes.
3. **Project folder** — `NewProjectDialog` gets a required "Local folder" field
   in local profiles; the server validates that the absolute path exists and is
   a directory before saving a `local_path` workspace.
4. **Model queue** — `general.maxConcurrentAgentRuns` (null = unlimited,
   `local_only` default 1). Enforced instance-wide in a new
   `server/src/services/heartbeat/instance-run-slots.ts`; `queue.ts` only asks
   it for free slots and, when a run settles, promotes the oldest queued run of
   any agent. Per-agent `maxConcurrentRuns` stays as an additional cap.
   Surfaced in Instance settings → General.
5. **Start without containers** — `scripts/local/paperclip-local.sh`
   (`install | build | start | dev | status`), embedded PGlite, optional
   systemd user unit in `scripts/local/paperclip-local.service`.
6. **Agent-friendly terminal workflow** — `AGENTS.local.md` (short entry point
   for Pi), `doc/local/README.md` (module map of the fork-specific code),
   `pnpm local:check` running only the fork's focused tests and typechecks.

## Status — 2026-11-19

Items 1–6 are implemented on branch `local-harness`. The operator guide is
`doc/local/README.md`; the agent entry point is `AGENTS.local.md`. Not done
yet: the agent configuration form still lists "Paperclip Runner" (disabled,
Legacy is the default; the server rejects it in local profiles), and a live
run with Pi against a local model server has not been performed.

## Verification

- Focused Vitest for each module above, plus `pnpm -r typecheck`.
- Live: start via the script in WSL, create a company and a project with a
  folder, hire a Pi agent against a local endpoint, queue two tasks, confirm
  only one model run is active at a time and no cost UI is visible.
