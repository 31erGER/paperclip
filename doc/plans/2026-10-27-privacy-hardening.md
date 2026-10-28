# Privacy hardening implementation plan

> **For agentic workers:** Use the parallel-agent workflow with the ownership below; preserve other workers' changes.

**Goal:** Disable external telemetry, crash reporting and diagnostic exports while retaining agent web searches, inference providers and update checks.

**Approved scope:** The user clarified that agents need Internet and updates must continue. This is privacy hardening, not global network isolation. Commit and push coherent verified increments to `origin` (`31erGER/paperclip`).

**Architecture:** A browser-safe immutable `EXTERNAL_DIAGNOSTICS_ENABLED = false` policy gates every first-party diagnostic export before collection/initialization or transport. Keep local run logs, audit history and local diagnostic bundles. External agent programs retain their network access, with documented telemetry opt-outs applied at launch. Passive external images require user action.

**Telemetry contract:** Reviewed the generated schema first. No event names, fields or wire schemas are added/changed, and no local generator exists; do not hand-edit the generated upstream contract. Update the telemetry README and obtain a separate privacy review of the emission-disable change.

## Ownership and steps

- Root: shared policy and telemetry client/config, configuration defaults, audit documentation, integration, verification, commits/pushes.
- Server diagnostics worker: Sentry DSN resolution/bootstrap, OpenTelemetry bootstrap, agent-observability resolution/test/export material and feedback trace upload. Preserve local trace/bundle storage and useful errors.
- Runtime privacy worker: inherited diagnostic environment and known Pi/Codex/Claude opt-outs at child launch; preserve provider credentials, model routing, proxies, web search and explicit installs.
- UI privacy worker: browser Sentry initialization and passive third-party image/avatar loads; preserve explicit user loads and local images.

For each owned behavior: add a meaningful regression, observe failure, implement, rerun affected existing tests. Legacy transport-only tests may explicitly mock the immutable policy to exercise retained code, but production must have no environment/config bypass. New privacy regressions use the actual production policy.

## Acceptance

- [x] Explicit enabled flags, remote DSNs, OTLP endpoints and saved export settings cannot activate diagnostics.
- [x] Direct telemetry clients and plugin events create no tracking state, timers or outgoing requests.
- [x] Trace uploads and diagnostic connection tests cannot send user data.
- [x] Known child diagnostic settings are suppressed without denying Internet.
- [x] Reading imported content/profile images makes no passive remote image request.
- [x] Updates, model connections, web searches and local task/audit logs remain available.
- [x] Targeted tests/typechecks/build and applicable repo checks run; retain baseline failures in the report.
- [x] Independent privacy review complete; verified increments committed and pushed.

## Existing verification limits

From the preceding setup change: full recursive typecheck hits a pre-existing Runner profile checksum assertion; full test runner cannot spawn `pnpm` on Windows; full build's POSIX copy script fails under cmd; token gates have 106 pre-existing violations outside changed UI. Shared/UI typechecks and UI production build passed. Database integration tests pass when run without competing builds.

## Review and verification follow-up (2026-10-28)

Independent review found bypasses in Radix avatar preloading, skill/app icons and
direct Claude/Codex quota subprocesses. All were reproduced and closed at their
owning boundaries. Expanded ACP tests exposed over-redaction of public privacy
opt-out values; an exact key/value exception preserves credentials and received
a second independent security review with no findings.

The privacy command uses the installed Node/Vitest runtime without package
downloads. Full-check failures and the remaining ACPX 0.13.1 Windows fixture
errors are retained in [the audit](../PRIVACY-AUDIT.md). Current pinned ACPX
0.12.0 real-process quota cases pass. No live provider/search or independent
native Rust runtime certification is claimed.

Final `pnpm check:privacy`: 19 files / 75 tests passed. Shared, adapter-utils,
Claude/Codex adapter and UI typechecks passed; UI production build and map
validation passed. The full repository checks remain limited as recorded above.
