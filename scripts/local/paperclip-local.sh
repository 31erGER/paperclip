#!/usr/bin/env bash
# Paperclip local harness (fork 31erGER): run Paperclip on one Linux host
# without containers, Docker, Rust or a C compiler.
#
#   scripts/local/paperclip-local.sh setup    check Node/pnpm, install dependencies
#   scripts/local/paperclip-local.sh start    start in the foreground (systemd uses this)
#   scripts/local/paperclip-local.sh background  start detached; log in ~/.paperclip/local-harness.log
#   scripts/local/paperclip-local.sh dev      start with file watching (for changes to Paperclip)
#   scripts/local/paperclip-local.sh status   show health and deployment profile
#   scripts/local/paperclip-local.sh stop     stop a server started by this checkout
#   scripts/local/paperclip-local.sh check    focused tests + typechecks for the fork's code
#
# Settings come from the environment or from an env file (first one found):
#   $PAPERCLIP_LOCAL_ENV_FILE, ~/.config/paperclip-local/env, <repo>/.env.local-harness
#
#   PAPERCLIP_DEPLOYMENT_PROFILE  standard | local | local_only   (default: local_only)
#   HOST                          bind address (default 127.0.0.1; 0.0.0.0 for LAN access)
#   PORT                          HTTP port (default 3100)
#
# Data (embedded database, backups, agent homes) lives in ~/.paperclip.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

load_env_file() {
  local candidate
  for candidate in "${PAPERCLIP_LOCAL_ENV_FILE:-}" "$HOME/.config/paperclip-local/env" "$REPO_ROOT/.env.local-harness"; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      set -a
      # shellcheck disable=SC1090
      . "$candidate"
      set +a
      echo "[paperclip-local] loaded settings from $candidate"
      return
    fi
  done
}

load_node() {
  if ! command -v node >/dev/null 2>&1 && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh" >/dev/null
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "[paperclip-local] Node.js 24 is required. Install it with nvm:" >&2
    echo "  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash" >&2
    echo "  . ~/.nvm/nvm.sh && nvm install 24" >&2
    exit 1
  fi
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if (( major < 24 )); then
    echo "[paperclip-local] Node.js $(node -v) found; version 24 or newer is required." >&2
    exit 1
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack prepare pnpm@9.15.4 --activate >/dev/null
  fi
}

export_defaults() {
  export PAPERCLIP_DEPLOYMENT_PROFILE="${PAPERCLIP_DEPLOYMENT_PROFILE:-local_only}"
  export HOST="${HOST:-127.0.0.1}"
  export PORT="${PORT:-3100}"
}

health_url() {
  local host="$HOST"
  [[ "$host" == "0.0.0.0" ]] && host="127.0.0.1"
  echo "http://$host:$PORT/api/health"
}

cmd="${1:-start}"
load_env_file
export_defaults

case "$cmd" in
  setup)
    load_node
    echo "[paperclip-local] node $(node -v), pnpm $(pnpm -v)"
    # The lockfile may lag behind patch configuration on this fork; allow pnpm
    # to reconcile it instead of failing the install.
    pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile
    mkdir -p "$HOME/.config/paperclip-local"
    if [[ ! -f "$HOME/.config/paperclip-local/env" ]]; then
      cp "$REPO_ROOT/scripts/local/env.example" "$HOME/.config/paperclip-local/env"
      echo "[paperclip-local] wrote default settings to ~/.config/paperclip-local/env"
    fi
    echo "[paperclip-local] setup done. Start with: scripts/local/paperclip-local.sh start"
    ;;
  start)
    load_node
    echo "[paperclip-local] profile=$PAPERCLIP_DEPLOYMENT_PROFILE http://$HOST:$PORT"
    exec pnpm dev:once
    ;;
  background)
    # Detached start that survives closing the terminal (use systemd for boot).
    log="$HOME/.paperclip/local-harness.log"
    mkdir -p "$(dirname "$log")"
    setsid nohup "$0" start >"$log" 2>&1 < /dev/null &
    echo "[paperclip-local] started in background; log: $log"
    ;;
  dev)
    load_node
    echo "[paperclip-local] profile=$PAPERCLIP_DEPLOYMENT_PROFILE http://$HOST:$PORT (watch mode)"
    exec pnpm dev
    ;;
  status)
    load_node
    if body="$(curl -fsS "$(health_url)" 2>/dev/null)"; then
      echo "$body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s);console.log(`status=${h.status} profile=${h.deploymentProfile ?? "standard"} version=${h.version ?? "?"}`)})' 2>/dev/null || echo "$body"
    else
      echo "[paperclip-local] not reachable at $(health_url)"
      exit 1
    fi
    ;;
  stop)
    load_node
    pnpm dev:stop
    ;;
  check)
    load_node
    pnpm local:check
    ;;
  *)
    sed -n '2,20p' "$0"
    exit 2
    ;;
esac
