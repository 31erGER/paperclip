# Local harness (fork 31erGER)

Run Paperclip as a meta harness on one Linux machine: several companies,
several projects, many agents, all as plain host processes. No Docker, no
sandbox provider, no Rust toolchain, no C compiler.

## Install

Requirements: Linux x64 or arm64 (WSL2 works), git, curl, Node.js 24, pnpm 9.

```sh
git clone https://github.com/31erGER/paperclip.git ~/dev/paperclip-local
cd ~/dev/paperclip-local
git switch local-harness
# Node 24 via nvm, if missing:
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
. ~/.nvm/nvm.sh && nvm install 24
scripts/local/paperclip-local.sh setup
scripts/local/paperclip-local.sh start
```

Open http://127.0.0.1:3100. Settings live in `~/.config/paperclip-local/env`
(see `scripts/local/env.example`). Data lives in `~/.paperclip`.

Run as a service: see the header of `scripts/local/paperclip-local.service`.

## Deployment profiles

Set `PAPERCLIP_DEPLOYMENT_PROFILE` in the env file.

| Profile | What changes |
| --- | --- |
| `standard` | Upstream behavior. On Linux x64 this selects Paperclip Runner for new agents and needs Rust to build it. |
| `local` | Every agent runs through its Legacy host adapter (`pi_local`, `claude_local`, `codex_local`, ...). Paperclip Runner, managed sandboxes, Dot, Grok Bot and Muse are off. No Rust build at start. Project folders are checked when saved. |
| `local_only` (default of the start script) | `local`, plus price and cost metrics are hidden (Costs pages, spend cards, budget tabs, dollar values) and at most one agent run executes at a time unless you choose another limit. |

Token counts and run durations stay visible in every profile.

## Projects are folders

Create a project with **Add Project** and enter an absolute **Project folder**
on the host, for example `/home/you/projects/shop`. In local profiles the
folder is required and must already exist. Agents assigned to the project's
tasks run with that folder as their working directory, directly in place (no
copy, no worktree). The folder does not need to be a git repository.

## Agent run queue

Settings → General → **Agent run queue** limits how many agent runs execute at
the same time across all companies. Other runs stay queued and start in
arrival order when a run finishes. Choose **1 at a time** when all agents use
one llama.cpp or LM Studio server: parallel requests to one local server often
produce broken output. The per-agent "max concurrent runs" setting still
applies as well.

## Local models with Pi

1. Start an OpenAI-compatible server: LM Studio (`lms server start`,
   default `http://localhost:1234/v1`) or llama.cpp
   (`llama-server -m model.gguf --port 8080`, `http://localhost:8080/v1`).
   Use a model with reliable tool calling and at least 32k context.
2. Install Pi on the host: `npm install -g @earendil-works/pi-coding-agent@0.74.0`.
3. In Paperclip, add a local AI connection (Connections → local / LM Studio)
   with the server URL and the model id, then hire a Pi agent bound to it.
   See `doc/connections/AI-CONNECTIONS.md` for the connection details.

## Updating from the original repository

One clone is enough. It has two remotes: `origin` (this fork) and `upstream`
(paperclipai/paperclip). Git merges upstream changes into `local-harness`;
nobody needs to re-implement them.

```sh
scripts/local/update-from-upstream.sh check   # how far behind, which files would conflict
scripts/local/update-from-upstream.sh merge   # backup branch, merge, pnpm install, pnpm local:check
git push origin local-harness
```

Conflicts appear only where upstream changed the same lines as the fork. The
fork keeps its changes in small modules (see `AGENTS.local.md`) so most
updates merge cleanly. When a merge stops, resolve the listed files by hand or
ask a coding agent to do it with `AGENTS.local.md` as guide. A backup branch
`backup/local-harness-<date>` is created before every merge.

Upstream moves fast (thousands of commits per month). Merge often, for
example weekly: small merges have small conflicts.

## Changing Paperclip with Pi from a terminal

Open a terminal in the checkout and start Pi there. Pi reads `AGENTS.md`,
which points to `AGENTS.local.md`: a short map of the fork's modules, the
rules, and the fast check commands (`pnpm local:check`). Keep
`scripts/local/paperclip-local.sh dev` running in a second terminal to see
changes live on http://127.0.0.1:3100.
