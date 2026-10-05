#!/usr/bin/env bash
#
# Zero Factory precommit verification for the ZeroHub monorepo.
#
# Runs the repository's own tooling (Rule of Precedence: respect existing
# project scripts/manifests first) to format, build/typecheck, and test so the
# factory dispatcher can deterministically verify every commit before opening a
# PR.
#
# Phases (each runnable independently, and via `all`):
#   format  - in-place formatting + lint auto-fix (Go gofmt, client ESLint+Prettier)
#   build   - compilation / static typecheck (Go build+vet, client tsc)
#   test    - deterministic test suite (Go unit tests). The Playwright e2e
#             suite is infra-dependent (live servers + chromium + free ports)
#             and is left to CI; here it is reported and skipped.
#
# Subcommands:
#   .zerofactory/precommit.sh [format|build|test|all|install-hook]

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# ---------------------------------------------------------------------------
# Dependency bootstrap
#
# The client is a Node/TypeScript package; its scripts (eslint, prettier, tsc)
# require node_modules, which is gitignored and therefore absent on a fresh
# factory checkout. Install it on demand so the precommit is self-sufficient.
# Prefer `npm ci` (exact, fast, lockfile-verified); fall back to `npm install`
# if the lockfile is out of sync.
# ---------------------------------------------------------------------------
ensure_client_deps() {
  if [ -x "$ROOT_DIR/client/node_modules/.bin/tsc" ]; then
    return 0
  fi
  echo ">> client node_modules missing; installing (npm ci, fallback npm install)..."
  (
    cd "$ROOT_DIR/client"
    npm ci --no-audit --no-fund || npm install --no-audit --no-fund
  )
}

# ---------------------------------------------------------------------------
# run_format: in-place code formatting & lint auto-fixing
# ---------------------------------------------------------------------------
run_format() {
  echo ">> [format] Go: gofmt -s -w"
  ( cd "$ROOT_DIR/server" && gofmt -s -w . )

  echo ">> [format] client: ESLint --fix + Prettier --write (npm run fix)"
  ensure_client_deps
  ( cd "$ROOT_DIR/client" && npm run fix )
}

# ---------------------------------------------------------------------------
# run_build: compilation or static typechecking
# ---------------------------------------------------------------------------
run_build() {
  echo ">> [build] server: go build ./... && go vet ./..."
  ( cd "$ROOT_DIR/server" && go build ./... && go vet ./... )

  echo ">> [build] client: TypeScript build/typecheck (npm run tsc)"
  ensure_client_deps
  ( cd "$ROOT_DIR/client" && npm run tsc )
}

# ---------------------------------------------------------------------------
# run_test: deterministic test suite
# ---------------------------------------------------------------------------
run_test() {
  echo ">> [test] server: go test -count=1 ./..."
  # NOTE: `go test -race` is unusable on this ARM host (ThreadSanitizer
  # "unsupported VMA range"); use plain `go test` and rely on a CI runner for
  # the race detector.
  ( cd "$ROOT_DIR/server" && go test -count=1 ./... )

  # The Playwright e2e suite (test/) is integration/infra-dependent: it needs
  # two live signaling servers on :8080/:8081 and a real browser. That belongs
  # in CI (see `make e2e-test`), not a fast local precommit gate.
  echo ">> [test] e2e (test/): skipped here (requires live servers + browser; run via 'make e2e-test' / CI)"
}

# ---------------------------------------------------------------------------
# install_hook: link .git/hooks/pre-commit -> this script
# ---------------------------------------------------------------------------
install_hook() {
  HOOK_DIR="$(git rev-parse --git-path hooks 2>/dev/null || echo ".git/hooks")"
  mkdir -p "$HOOK_DIR"
  # Force-replace any existing pre-commit (incl. a stale/dangling symlink) so
  # the one-command is safe to repeat and safe across worktrees, where the
  # hooks dir is shared with the primary tree.
  ln -sf "../../.zerofactory/precommit.sh" "$HOOK_DIR/pre-commit"
  # chmod is best-effort: in a worktree the link target lives in the primary
  # repo and is transiently dangling until this change is merged. The hook
  # still runs because the committed target (precommit.sh) is itself
  # executable; a symlink's own exec bit is not required to exec it.
  chmod +x "$HOOK_DIR/pre-commit" 2>/dev/null || true
  echo "✓ Linked .zerofactory/precommit.sh -> $HOOK_DIR/pre-commit"
}

case "${1:-all}" in
  format)       run_format ;;
  build)        run_build ;;
  test)         run_test ;;
  install-hook) install_hook ;;
  all|*)
    run_format
    run_build
    run_test
    ;;
esac

echo "✓ Zero Factory precommit checks passed!"
