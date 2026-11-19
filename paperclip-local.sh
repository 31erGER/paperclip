#!/usr/bin/env bash
# Paperclip local harness (fork 31erGER): run Paperclip on one Linux host
# without containers, Docker, Rust or a C compiler. See README-LOCAL.md.
#
#   ./paperclip-local.sh setup        check Node/pnpm, install dependencies, write settings
#   ./paperclip-local.sh start        start in the foreground (systemd uses this)
#   ./paperclip-local.sh background   start detached; log in ~/.paperclip/local-harness.log
#   ./paperclip-local.sh dev          start with file watching (for changes to Paperclip)
#   ./paperclip-local.sh status       show health and deployment profile
#   ./paperclip-local.sh stop         shut Paperclip down, including its embedded database
#   ./paperclip-local.sh reset        factory reset: all companies, agents, tasks and logs
#                                     [--yes] skip the question  [--delete] no backup
#   ./paperclip-local.sh update       check | merge  changes from the original repository
#   ./paperclip-local.sh check        focused tests + typechecks for the fork's code
#
# Settings come from the environment or from an env file (first one found):
#   $PAPERCLIP_LOCAL_ENV_FILE, ~/.config/paperclip-local/env, <repo>/.env.local-harness
#
#   PAPERCLIP_DEPLOYMENT_PROFILE  standard | local | local_only   (default: local_only)
#   HOST                          bind address (default 127.0.0.1; use an SSH tunnel for remote access)
#   PORT                          HTTP port (default 3100)
#
# Data (embedded database, backups, agent homes) lives in
# ${PAPERCLIP_HOME:-~/.paperclip}/instances/${PAPERCLIP_INSTANCE_ID:-default},
# not in the checkout: every clone on this account shares it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"
SERVICE_NAME="paperclip-local"

log() { echo "[paperclip-local] $*"; }

load_env_file() {
  local candidate
  for candidate in "${PAPERCLIP_LOCAL_ENV_FILE:-}" "$HOME/.config/paperclip-local/env" "$REPO_ROOT/.env.local-harness"; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      set -a
      # shellcheck disable=SC1090
      . "$candidate"
      set +a
      log "loaded settings from $candidate"
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

server_up() { curl -fsS "$(health_url)" >/dev/null 2>&1; }

instance_root() {
  local home="${PAPERCLIP_HOME:-$HOME/.paperclip}"
  home="${home/#\~/$HOME}"
  local id="${PAPERCLIP_INSTANCE_ID:-default}"
  if [[ ! "$id" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "[paperclip-local] invalid PAPERCLIP_INSTANCE_ID: $id" >&2
    exit 2
  fi
  echo "$home/instances/$id"
}

db_pids() { pgrep -f "postgres -D $(instance_root)/db" || true; }

service_active() {
  command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet "$SERVICE_NAME" 2>/dev/null
}

# Shut down an embedded database that outlived its server (crash, hard kill,
# or a dev-runner stop). SIGINT is PostgreSQL's "fast shutdown": it ends
# sessions and writes a checkpoint.
stop_leftover_db() {
  local pids
  pids="$(db_pids)"
  [[ -z "$pids" ]] && return 0
  log "stopping the embedded database (pid $pids) ..."
  # shellcheck disable=SC2086
  kill -INT $pids 2>/dev/null || true
  for _ in $(seq 1 30); do
    [[ -z "$(db_pids)" ]] && { log "embedded database stopped."; return 0; }
    sleep 1
  done
  echo "[paperclip-local] the embedded database did not stop (pid $(db_pids))." >&2
  return 1
}

stop_paperclip() {
  if service_active; then
    log "stopping the systemd user service $SERVICE_NAME ..."
    systemctl --user stop "$SERVICE_NAME"
  elif server_up || pgrep -f "[s]cripts/dev-runner.ts" >/dev/null; then
    load_node
    log "stopping the Paperclip server ..."
    pnpm --silent dev:stop || true
  fi
  for _ in $(seq 1 30); do
    server_up || break
    sleep 1
  done
  if server_up; then
    echo "[paperclip-local] Paperclip still answers on $(health_url). Stop the process that started it (Ctrl+C in its terminal)." >&2
    return 1
  fi
  stop_leftover_db
}

cmd="${1:-start}"
[[ $# -gt 0 ]] && shift
load_env_file
export_defaults

case "$cmd" in
  setup)
    load_node
    log "node $(node -v), pnpm $(pnpm -v)"
    # The lockfile may lag behind patch configuration on this fork; allow pnpm
    # to reconcile it instead of failing the install.
    pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile
    # The migration safety check compares with the original repository.
    if ! git remote get-url upstream >/dev/null 2>&1; then
      git remote add upstream https://github.com/paperclipai/paperclip.git
    fi
    git fetch --quiet upstream master || echo "[paperclip-local] could not fetch upstream; migration checks fall back to origin/master" >&2
    mkdir -p "$HOME/.config/paperclip-local"
    if [[ ! -f "$HOME/.config/paperclip-local/env" ]]; then
      cp "$REPO_ROOT/scripts/local/env.example" "$HOME/.config/paperclip-local/env"
      log "wrote default settings to ~/.config/paperclip-local/env"
    fi
    log "setup done. Start with: ./paperclip-local.sh start"
    ;;
  start)
    load_node
    if server_up; then log "already running on $(health_url)"; exit 0; fi
    # A database left over from a crash would block the new start.
    stop_leftover_db
    log "profile=$PAPERCLIP_DEPLOYMENT_PROFILE http://$HOST:$PORT"
    exec pnpm dev:once
    ;;
  background)
    # Detached start that survives closing the terminal (use systemd for boot).
    logfile="$HOME/.paperclip/local-harness.log"
    mkdir -p "$(dirname "$logfile")"
    setsid nohup "$0" start >"$logfile" 2>&1 < /dev/null &
    log "started in background; log: $logfile"
    ;;
  dev)
    load_node
    stop_leftover_db
    log "profile=$PAPERCLIP_DEPLOYMENT_PROFILE http://$HOST:$PORT (watch mode)"
    exec pnpm dev
    ;;
  status)
    load_node
    if body="$(curl -fsS "$(health_url)" 2>/dev/null)"; then
      echo "$body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s);console.log(`status=${h.status} profile=${h.deploymentProfile ?? "standard"} version=${h.version ?? "?"}`)})' 2>/dev/null || echo "$body"
    else
      log "not running ($(health_url) not reachable)"
      [[ -n "$(db_pids)" ]] && log "note: an embedded database is still running; ./paperclip-local.sh stop shuts it down."
      exit 1
    fi
    ;;
  stop)
    stop_paperclip
    log "Paperclip is stopped."
    ;;
  reset)
    assume_yes=false
    delete_permanently=false
    for arg in "$@"; do
      case "$arg" in
        --yes|-y) assume_yes=true ;;
        --delete) delete_permanently=true ;;
        *) echo "[paperclip-local] unknown reset option: $arg" >&2; exit 2 ;;
      esac
    done
    root="$(instance_root)"
    paperclip_home="$(dirname "$(dirname "$root")")"
    instance_id="$(basename "$root")"
    pi_sessions="$HOME/.pi/paperclips"

    if service_active || server_up; then
      echo "[paperclip-local] Paperclip is still running. Stop it first: ./paperclip-local.sh stop" >&2
      exit 1
    fi
    if [[ ! -d "$root" && ! -d "$pi_sessions" ]]; then
      log "nothing to reset: $root does not exist."
      exit 0
    fi

    log "factory reset removes:"
    [[ -d "$root" ]] && echo "  $root  ($(du -sh "$root" 2>/dev/null | cut -f1)) — database with all companies, agents, tasks, connections, secrets, logs, agent home folders"
    [[ -d "$pi_sessions" ]] && echo "  $pi_sessions  — Pi sessions started by Paperclip"
    log "kept: this checkout, ~/.config/paperclip-local/env, and your project folders."
    if $delete_permanently; then
      log "--delete: the data is deleted permanently, without a backup."
    else
      log "the data is moved to $paperclip_home/reset-backups/ (delete that folder later to free space)."
    fi
    if ! $assume_yes; then
      read -r -p "Type 'reset' to continue: " answer
      [[ "$answer" == "reset" ]] || { log "cancelled."; exit 1; }
    fi

    stop_leftover_db || { echo "[paperclip-local] nothing was removed." >&2; exit 1; }
    if $delete_permanently; then
      rm -rf -- "$root" "$pi_sessions"
      log "deleted."
    else
      backup="$paperclip_home/reset-backups/$instance_id-$(date +%Y%m%d-%H%M%S)"
      mkdir -p "$backup"
      if [[ -d "$root" ]]; then mv -- "$root" "$backup/instance"; fi
      if [[ -d "$pi_sessions" ]]; then mv -- "$pi_sessions" "$backup/pi-paperclips"; fi
      log "moved to $backup"
      log "undo (with Paperclip stopped): mv \"$backup/instance\" \"$root\""
    fi
    log "fresh state. Start again with: ./paperclip-local.sh start"
    ;;
  update)
    exec "$REPO_ROOT/scripts/local/update-from-upstream.sh" "${1:-check}"
    ;;
  check)
    load_node
    pnpm local:check
    ;;
  *)
    sed -n '2,25p' "$0"
    exit 2
    ;;
esac
