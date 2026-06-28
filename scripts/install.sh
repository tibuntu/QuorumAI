#!/usr/bin/env bash
#
# Install the Consensum Claude Code integration.
#
# Remote (no checkout needed):
#   curl -fsSL https://raw.githubusercontent.com/tibuntu/consensum/main/scripts/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/tibuntu/consensum/main/scripts/install.sh | bash -s -- --with-hook
#
# Local (from a checkout): scripts/install.sh [options]
#
#   Slash commands (/consensum-push-plan, /consensum-pull-feedback, /consensum-loop)
#   install to ~/.claude/commands by default — invoked explicitly, safe everywhere.
#
#   The ExitPlanMode auto-proceed hook is OPT-IN per project (--with-hook): it pushes
#   every plan-mode exit to Consensum for review, so it installs into a single
#   project's .claude/ rather than globally.
#
# Options:
#   --with-hook            also install + register the hook into the project's .claude/
#   --project DIR          project dir for --with-hook (default: current dir)
#   --commands-dir DIR     where to install commands (default: ~/.claude/commands)
#   -h, --help             show this help
#
# Env overrides (handy for forks/branches/mirrors):
#   CONSENSUM_REPO (default tibuntu/consensum)  CONSENSUM_REF (default main)
#   CONSENSUM_RAW_BASE (override the full raw base URL)
#
set -euo pipefail

REPO="${CONSENSUM_REPO:-tibuntu/consensum}"
REF="${CONSENSUM_REF:-main}"
RAW_BASE="${CONSENSUM_RAW_BASE:-https://raw.githubusercontent.com/${REPO}/${REF}}"
COMMANDS=(consensum-push-plan.md consensum-pull-feedback.md consensum-loop.md)

# If run from a checkout, copy from disk; if piped via curl, download from RAW_BASE.
SRC=""
_self="${BASH_SOURCE[0]:-}"
if [ -n "$_self" ] && [ -f "$_self" ]; then
  _dir="$(cd "$(dirname "$_self")/.." && pwd)"
  [ -f "$_dir/dist/claude/commands/consensum-push-plan.md" ] && SRC="$_dir"
fi

# defaults / args
COMMANDS_DIR="${HOME}/.claude/commands"
PROJECT_DIR="$(pwd)"
WITH_HOOK=0

usage() { sed -n '2,30p' "${BASH_SOURCE[0]}" 2>/dev/null | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --with-hook)     WITH_HOOK=1 ;;
    --project)       PROJECT_DIR="${2:?--project needs a path}"; shift ;;
    --commands-dir)  COMMANDS_DIR="${2:?--commands-dir needs a path}"; shift ;;
    -h|--help)       usage 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

info() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1" >&2; }

# provide <repo-relative-path> <dest> — copy from checkout or download from GitHub.
provide() {
  local rel="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if [ -n "$SRC" ]; then
    cp "$SRC/$rel" "$dest"
  elif command -v curl >/dev/null 2>&1; then
    curl -fsSL "$RAW_BASE/$rel" -o "$dest" || { echo "Failed to download $rel from $RAW_BASE" >&2; exit 1; }
  else
    echo "curl is required to install remotely." >&2; exit 1
  fi
}

# --- install commands --------------------------------------------------------
echo "Installing Consensum slash commands -> $COMMANDS_DIR"
[ -n "$SRC" ] || echo "  (downloading from $RAW_BASE)"
for f in "${COMMANDS[@]}"; do
  provide "dist/claude/commands/$f" "$COMMANDS_DIR/$f"
  info "$f"
done

# --- install + register the hook (opt-in, per project) -----------------------
if [ "$WITH_HOOK" -eq 1 ]; then
  SETTINGS="$PROJECT_DIR/.claude/settings.json"
  echo "Installing ExitPlanMode hook -> $PROJECT_DIR/.claude"
  provide "dist/claude/hooks/consensum-exit-plan.mjs" "$PROJECT_DIR/.claude/hooks/consensum-exit-plan.mjs"
  info "hooks/consensum-exit-plan.mjs"
  # The entry hook imports ./consensum-hook-core.mjs at runtime, so it must ship too.
  provide "dist/claude/hooks/consensum-hook-core.mjs" "$PROJECT_DIR/.claude/hooks/consensum-hook-core.mjs"
  info "hooks/consensum-hook-core.mjs"

  read -r -d '' HOOK_ENTRY <<'JSON' || true
{
  "matcher": "ExitPlanMode",
  "hooks": [
    { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/consensum-exit-plan.mjs\"", "timeout": 345600 }
  ]
}
JSON

  if command -v jq >/dev/null 2>&1; then
    [ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
    tmp="$(mktemp)"
    # Drop any prior Consensum ExitPlanMode entry (idempotent), then append ours.
    jq --argjson entry "$HOOK_ENTRY" '
      .hooks = (.hooks // {})
      | .hooks.PermissionRequest = (
          ((.hooks.PermissionRequest // [])
            | map(select(
                (.matcher != "ExitPlanMode")
                or ([.hooks[]?.command] | any(test("consensum-exit-plan")) | not)
              )))
          + [$entry]
        )
    ' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
    info "registered PermissionRequest hook in .claude/settings.json"
  else
    warn "jq not found — could not auto-merge settings.json. Add this manually to $SETTINGS:"
    cat >&2 <<'JSON'
  { "hooks": { "PermissionRequest": [
    { "matcher": "ExitPlanMode", "hooks": [
      { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/consensum-exit-plan.mjs\"", "timeout": 345600 }
    ] }
  ] } }
JSON
  fi
fi

echo
echo "Done. Set your environment, then plan as usual:"
echo "  export CONSENSUM_BASE_URL=\"http://localhost:3000\""
echo "  export CONSENSUM_API_TOKEN=\"<token from Settings → API tokens>\""
[ "$WITH_HOOK" -eq 1 ] && echo "The hook will push plans for review automatically when you exit plan mode in this project."
exit 0
