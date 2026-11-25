# Local harness (fork 31erGER)

Deutsche Anleitungen: [Local Harness benutzen](ANLEITUNG-LOCAL-HARNESS.md) ·
[Original-Repository einmergen](ANLEITUNG-UPSTREAM-MERGE.md)

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
./paperclip-local.sh setup
./paperclip-local.sh start
```

Open http://127.0.0.1:3100. Settings live in `~/.config/paperclip-local/env`
(see `scripts/local/env.example`). Data lives in `~/.paperclip`, shared by
every clone on the account. `./paperclip-local.sh stop` shuts Paperclip down
(including its embedded database); `./paperclip-local.sh reset` returns to a
fresh state (data moved to `~/.paperclip/reset-backups/`, `--delete` to
remove it). Short German overview: `README-LOCAL.md`.

`start` also creates the instance secrets that `paperclipai onboard` would
create (`PAPERCLIP_AGENT_JWT_SECRET` in `~/.paperclip/instances/<id>/.env`).
Without them local agents get no `PAPERCLIP_API_KEY` and every agent API call,
such as hiring another agent, fails with "Unauthorized".

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

## Agent run queue & live steering

Settings → General → **Agent run queue** limits how many background agent runs
execute at the same time across all companies. Choose **1 at a time** when all
agents use one llama.cpp or LM Studio server so automated background tasks run
sequentially without flooding the local server.

- **Priority ordering**: When a slot frees up, promoted messages (Tier 0), board
  messages to the CEO/coordinator (Tier 1), and other board user messages
  (Tier 2) are always dispatched ahead of automated background tasks (Tier 3).
- **Reserved +1 express slot**: Direct board messages to the CEO/coordinator
  and explicitly promoted messages (clicking **Send** on a queued
  message bar or sending again on a queued chat) can use one reserved parallel
  express slot (`limit + 1`) so you never wait hours for a background worker to
  finish before talking to the coordinator.
- **Live Pi RPC steering (`pi --mode rpc`)**: Local Pi runs stay open over JSON
  RPC stdin (`PAPERCLIP_PI_RPC_STEERING=0` to disable). Board users can click
  **Steer** on queued messages to redirect an active Pi run right after its
  current tool call, and CEO/manager comments on an active subordinate's task
  steer that worker mid-turn automatically.

## Local models with Pi

1. Start an OpenAI-compatible server: LM Studio (`lms server start`,
   default `http://localhost:1234/v1`) or llama.cpp
   (`llama-server -m model.gguf --port 8080`, `http://localhost:8080/v1`).
   Use a model with reliable tool calling and at least 32k context.
2. Install Pi on the host: `npm install -g @earendil-works/pi-coding-agent@0.74.0`.
3. In Paperclip, the first-agent onboarding offers Pi and Hermes in local
   profiles: pick Pi, **Connect LM Studio** (default
   `http://localhost:1234/v1`, no key), save, choose the model, Connect.
   Later agents: Agents → Add agent → Pi with the **Local** model source.
   See `doc/connections/AI-CONNECTIONS.md` for the connection details.

## Pi extensions

Under the local profiles the managed Pi directory of each run links the
operator's own Pi setup from `~/.pi/agent` (extensions, packages,
`settings.json`, themes, prompts, tools). Never linked: `models.json`,
`auth.json`, `sessions`, `skills` and the global instruction files.
`PAPERCLIP_PI_HOST_CONFIG=0` turns it off.

## Company Vault (Obsidian-compatible knowledge & whiteboard)

Each company gets a shared **Vault** folder under `<paperclip-repo>/vaults/<companyId>`
(overrideable via
`PAPERCLIP_VAULT_ROOT`, ignored by Paperclip's `.gitignore` so you can manage your own
`git` repo per vault) containing plain Markdown (`.md`) notes and Obsidian JSON Canvas 1.0
(`.canvas`) whiteboards.

- **Open in Obsidian**: copy the folder path from the bottom of the Vault
  sidebar and open it directly as an Obsidian vault; edits stay in sync with
  Paperclip's UI (with conflict detection).
- **UI**: sidebar → **Vault** (`/vault`) provides a file browser, full-text
  search, split Markdown editor with `[[wikilinks]]` and backlinks, and an
  interactive pan/zoom `.canvas` whiteboard.
- **Autonomous agents**: every agent receives `PAPERCLIP_VAULT_DIR` and
  `PAPERCLIP_VAULT_API` plus built-in guidance to read and update durable
  cross-project knowledge autonomously.
- **Board-only protection & Git safety**: files with `editable_by: board`
  frontmatter (toggleable in the Vault UI; enabled by default on `BOARD.md`)
  are readable by agents but rejected (`403`) on agent writes. Agents are
  forbidden from running `git` inside the Vault or modifying `.git/`,
  `.gitignore`, or `.obsidian/`, leaving version control exclusively to the
  board.

## Single-agent chat turn view

Direct 1-on-1 agent chats (`/chats/:agentRef`) use a dedicated turn presentation:

- **Run context & log dropdown**: Paperclip wake payloads, resume deltas, and
  Pi lifecycle logs are tucked into a collapsed-by-default **Run context & log**
  dropdown instead of filling the chat screen while the agent thinks.
- **Expandable thinking blocks**: Reasoning renders as a framed, collapsible
  card (Hermes / Pi TUI style) with a multi-line live preview while streaming
  and a scrollable full reasoning drawer when expanded.
- **Uncompressed action list**: Tool calls render chronologically as individual
  rows with readable targets, status/exit badges, durations, diff counts, and
  click-to-expand output/diff drawers.
- **Claude Code / Pi TUI-style file edit cards**: File `edit` and `write` calls
  display the file path, `+N −M` diff badge, and a short inline tinted diff
  abstract directly in the stream; clicking the card or abstract unfolds the
  full scrollable diff.

## Remote access

Without sign-in (`local_trusted`), only processes on the Paperclip host get
board access; a browser on another machine sees "Board access required".
Use an SSH tunnel (`ssh -L 3100:127.0.0.1:3100 you@host`) or the
`authenticated` deployment mode.

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
fork keeps its changes in small modules (see `AGENTS.fork.md`) so most
updates merge cleanly. When a merge stops, resolve the listed files by hand or
ask a coding agent to do it with `AGENTS.fork.md` as guide. A backup branch
`backup/local-harness-<date>` is created before every merge.

Upstream moves fast (thousands of commits per month). Merge often, for
example weekly: small merges have small conflicts.

## Changing Paperclip with Pi from a terminal

Open a terminal in the checkout and start Pi there. Pi reads `AGENTS.md`,
which points to `AGENTS.fork.md`: a short map of the fork's modules, the
rules, and the fast check commands (`pnpm local:check`). Keep
`./paperclip-local.sh dev` running in a second terminal to see
changes live on http://127.0.0.1:3100.
