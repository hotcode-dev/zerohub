#!/usr/bin/env bash
# Zero Factory precommit checks for the zerohub monorepo.
#
# Phases (each runnable individually):
#   format - prettier (client) + gofmt (server)
#   build  - go build/vet (server) + tsc (client)
#   test   - go test (server; -race on x86, plain on aarch64 where
#            ThreadSanitizer is unsupported). The Playwright E2E suite
#            needs two live servers and is intentionally skipped here.
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# server/go.mod declares `go 1.25.4`; the host may ship a much older
# system Go, so promote a new enough toolchain when one is available.
GO_MIN="1.25.4"

go_is_new_enough() {
  command -v go >/dev/null 2>&1 || return 1
  local cur
  cur="$(go version | awk '{print $3}' | sed 's/^go//')" || return 1
  [ "$(printf '%s\n%s\n' "$cur" "$GO_MIN" | sort -V | head -n 1)" = "$GO_MIN" ]
}

ensure_go() {
  if go_is_new_enough; then
    return 0
  fi
  if [ -x /usr/local/go/bin/go ]; then
    PATH="/usr/local/go/bin:$PATH"
    go_is_new_enough && return 0
  fi
  echo "error: Go >= ${GO_MIN} required (found: $(command -v go >/dev/null 2>&1 && go version || echo 'none'))" >&2
  exit 1
}

log_phase() {
  echo ""
  echo "==> Zero Factory: $1"
}

run_format() {
  log_phase "run_format (prettier client + gofmt server)"
  if [ ! -d "$ROOT_DIR/client/node_modules" ]; then
    echo "error: client/node_modules missing - run: cd client && npm install" >&2
    exit 1
  fi
  (cd "$ROOT_DIR/client" && npx --no-install prettier --write "src/**/*.{ts,js,json,md}" "!src/proto/**")
  (cd "$ROOT_DIR" && gofmt -s -w ./server)
}

run_build() {
  log_phase "run_build (go build/vet server + tsc client)"
  ensure_go
  if [ ! -d "$ROOT_DIR/client/node_modules" ]; then
    echo "error: client/node_modules missing - run: cd client && npm install" >&2
    exit 1
  fi
  (cd "$ROOT_DIR/server" && go build ./... && go vet ./...)
  (cd "$ROOT_DIR/client" && npm run tsc)
}

run_test() {
  log_phase "run_test (go test server)"
  ensure_go
  cd "$ROOT_DIR/server"
  if [ "$(uname -m)" = "aarch64" ]; then
    echo "  (skipping -race: ThreadSanitizer unsupported on this aarch64 host; use -count=1)"
    go test -count=1 ./...
  else
    go test -race -count=1 ./...
  fi
  cd "$ROOT_DIR"
  echo "  (skipping e2e: Playwright suite requires two live servers; run via: make e2e-test)"
}

install_hook() {
  HOOK_DIR="$(git rev-parse --git-path hooks 2>/dev/null || echo ".git/hooks")"
  mkdir -p "$HOOK_DIR"
  ln -sf "../../.zerofactory/precommit.sh" "$HOOK_DIR/pre-commit"
  # The link may dangle in a shared worktree .git (file not yet in the
  # primary repo), so chmod the real script instead of the link target.
  chmod +x "$ROOT_DIR/.zerofactory/precommit.sh"
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
