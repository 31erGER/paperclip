#!/usr/bin/env bash
# Bring changes from the original Paperclip repository into this fork
# (fork 31erGER, branch local-harness). See doc/local/README.md, "Updating".
#
#   scripts/local/update-from-upstream.sh check   fetch and predict conflicts; changes nothing
#   scripts/local/update-from-upstream.sh merge   back up, merge upstream, install, run fork checks
#
# Environment:
#   UPSTREAM_URL     default https://github.com/paperclipai/paperclip.git
#   UPSTREAM_BRANCH  default master
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/paperclipai/paperclip.git}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-master}"
UPSTREAM_REF="upstream/$UPSTREAM_BRANCH"

ensure_upstream() {
  if git remote get-url upstream >/dev/null 2>&1; then
    git remote set-url upstream "$UPSTREAM_URL"
  else
    git remote add upstream "$UPSTREAM_URL"
  fi
  echo "[update] fetching $UPSTREAM_URL ($UPSTREAM_BRANCH) ..."
  git fetch --quiet upstream "$UPSTREAM_BRANCH"
}

require_clean_tree() {
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "[update] uncommitted changes found. Commit or stash them first:" >&2
    git status --short --untracked-files=no >&2
    exit 1
  fi
}

report() {
  local behind ahead
  behind="$(git rev-list --count "HEAD..$UPSTREAM_REF")"
  ahead="$(git rev-list --count "$UPSTREAM_REF..HEAD")"
  echo "[update] upstream has $behind new commit(s); this branch has $ahead commit(s) of its own."
  if [[ "$behind" == "0" ]]; then
    echo "[update] already up to date."
    return 1
  fi
  # Predict conflicts without touching the working tree (git >= 2.38).
  local predicted
  if predicted="$(git merge-tree --write-tree --name-only --no-messages HEAD "$UPSTREAM_REF")"; then
    echo "[update] predicted: merges cleanly."
  else
    echo "[update] predicted conflicts in:"
    echo "$predicted" | tail -n +2 | sed 's/^/  /'
  fi
  return 0
}

cmd="${1:-check}"
case "$cmd" in
  check)
    ensure_upstream
    report || true
    ;;
  merge)
    require_clean_tree
    ensure_upstream
    report || exit 0
    branch="$(git rev-parse --abbrev-ref HEAD)"
    backup="backup/${branch}-$(date +%Y%m%d-%H%M%S)"
    git branch "$backup"
    echo "[update] backup branch: $backup (restore with: git reset --hard $backup)"
    if ! git merge --no-ff --no-edit -m "Merge upstream $UPSTREAM_BRANCH into $branch" "$UPSTREAM_REF"; then
      echo
      echo "[update] merge stopped with conflicts:"
      git diff --name-only --diff-filter=U | sed 's/^/  /'
      cat <<'EOF'

Next steps:
  - Resolve each file (keep upstream behavior, re-apply the fork change; fork
    code is marked "fork 31erGER" and listed in AGENTS.local.md), then
      git add <file> && git commit --no-edit
  - Or let a coding agent do it: "Resolve the merge conflicts listed by
    `git diff --name-only --diff-filter=U` following AGENTS.local.md, then run
    pnpm local:check."
  - Or give up for now:  git merge --abort
EOF
      exit 1
    fi
    echo "[update] merged. Installing dependencies and running fork checks ..."
    pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile
    pnpm local:check
    echo "[update] done. Restart Paperclip, then push: git push origin $branch"
    ;;
  *)
    sed -n '2,11p' "$0"
    exit 2
    ;;
esac
