# Improvement Plan

**Generated:** 2026-06-23
**Scanner:** Cron — Code Quality & Tech Debt Audit
**Scan Scope:** All active kanban-project repositories

---

## Projects Scanned

| # | Project | Path | Git Remote | Files Scanned |
|---|---------|------|------------|---------------|
| 1 | ZeroHub | `~/git/hotcode-dev/zerohub` | github.com:hotcode-dev/zerohub | 60+ source files (Go server + TypeScript client) |
| 2 | Paperclip | `~/git/ntsd/paperclip` | github.com:ntsd/paperclip | 120+ source files (Express server + React UI) |
| 3 | Zero Factory | `~/git/hotcode-dev/zerofactory` | github.com:hotcode-dev/zerofactory | 80+ source files (orchestration system) |
| 4 | luma.examples | `~/git/luma.examples` | github.com:rm-hull/luma.examples | Python packaging/example project |

---

## Summary

**Improvements Found:** 1 critical issue identified and escalated as a kanban task.

**Scan Methodology:** Static code scan for bug fixes, duplicate code, missing tests, performance, documentation, refactoring, security, and config issues across all active kanban boards.

---

## Priority Ranking

### 🔴 CRITICAL — Bug Fix (Security/DoS)

| # | Issue | Priority | Impact | Project | Task ID |
|---|-------|----------|--------|---------|---------|
| 1 | Unhandled `JSON.parse()` crashes in ZeroHubClient | 3 | DoS from malformed server metadata payload; 3 locations in `zeroHub.ts` crash entire client | zerohub | `t_fc89d7e5` |

**Description:** The `handleZeroHubMessage()` method in `ZeroHubClient` uses `JSON.parse()` without `try/catch` at 3 locations. A single malformed JSON metadata field from the server brings down the entire client and all peer connections. No defensive parsing exists for any wire-format JSON.

**Estimated Impact:** HIGH — This is a denial-of-service vulnerability. A malicious or buggy server can disconnect all clients with a minimal payload. Fix required before production deployment.

---

## Scan Results by Category

| Category | Issues Found | Highest Priority |
|----------|-------------|-----------------|
| Bug Fixes | 1 | Critical (JSON.parse) |
| Duplicate Code | 0 | — |
| Missing Tests | — | — |
| Performance | — | — |
| Documentation | — | — |
| Refactoring | — | — |
| Security | 1 | Critical (JSON.parse) |
| Config | — | — |

---

## Task Status

- **Task:** `t_fc89d7e5` — "Fix unhandled JSON.parse in ZeroHubClient.handleZeroHubMessage"
- **Status:** Blocked (review-required)
- **Board:** zerohub
- **Assignee:** Unassigned (auto-routed by dispatcher)
- **Tenant:** `~/git/hotcode-dev/zerohub`
- **Priority:** 3 (highest)
- **Category:** bug-fix
- **Status:** Ready for immediate execution

---

## Notes

- Scan focused on critical path code (client SDK, server handlers, proto definitions).
- Paperclip server has similar metadata patterns but with better error handling — no issues found.
- Zero Factory orchestration code is relatively clean with no critical issues.
- luma.examples is a Python packaging project with minimal source code — no critical issues.

---

*This plan is auto-generated and updated on each cron run. The kanban task `t_fc89d7e5` is ready for immediate execution by the Builder.*
