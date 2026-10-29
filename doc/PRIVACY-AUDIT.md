# Privacy controls in the 31erGER fork

Audit and implementation dates: 2026-10-27–28.

The goal is to prevent unnecessary background tracking and diagnostic exports.
Agents may use Internet searches, configured model providers and integrations.
Update checks and deliberate package installations remain available. This is
not a general offline mode or a guarantee about arbitrary external programs.

## Central switches and reversal

The switches live in `packages/shared/src/privacy-policy.ts`. They are code-level
feature flags so a saved setting or inherited environment variable cannot
silently enable a disabled feature. Source code remains present for future
upstream merges; disabling code with a documented gate is easier to review and
reverse than commenting out unrelated call sites.

| Flag | Default | Effect | How to re-enable deliberately |
| --- | --- | --- | --- |
| `EXTERNAL_DIAGNOSTICS_ENABLED` | `false` | Suppresses usage telemetry, Sentry, OTLP, agent diagnostic exporters, trace uploads and known child-runtime diagnostic settings | Change to `true`, then configure only the intended upstream feature. Review destination, credentials and capture options first. |
| `BACKGROUND_ANNOUNCEMENTS_ENABLED` | `false` | Stops automatic product-news feed requests | Change to `true`; the existing `PAPERCLIP_ANNOUNCEMENTS_ENABLED` setting still applies. Update checking is separate. |
| `PASSIVE_REMOTE_IMAGES_ENABLED` | `false` | Prevents third-party image/avatar requests merely from reading content | Change to `true` to restore passive remote media. Explicitly loading a Markdown image remains available while false. |

After changing a flag, rebuild/restart both server and UI. Privacy regression
tests intentionally expect the defaults above; re-enabling a feature requires
an explicit review of the corresponding tests and this document. The historical
transport tests mock the feature open only inside their own suites, preserving
upstream transport coverage without a production test-mode bypass.

## Findings and affected code

| Original path and behavior | Enforcement point / change | Lost capability |
| --- | --- | --- |
| `packages/shared/src/telemetry/config.ts` enabled telemetry by default; `client.ts` sent usage events to `telemetry.paperclip.ing/ingest`, with an AWS API Gateway fallback | Resolver and direct-client gates; config schema defaults off; `server/src/config.ts` reports disabled. Direct clients create no state/fingerprints, collection queue, timers or uploads. | Vendor usage analytics. No effect on local tasks or run history. |
| `server/src/sentry-dsn.ts` resolved frontend/backend DSNs, including legacy `SENTRY_DSN`; `sentry.ts` initialized the SDK | DSNs withheld even if configured; browser `ui/src/lib/sentry.ts` independently refuses stale-session activation | Automatic external error reports. Local errors remain available. |
| `server/src/instrumentation.ts` started OpenTelemetry when an OTLP endpoint existed | Gate before SDK import, trace/context helpers and plugin span reporting | Export of server trace diagnostics. Local execution logs remain. |
| `server/src/services/agent-observability.ts` resolved Braintrust/custom OTLP settings and credentials; `forTest` bypassed saved enabled=false | Gate saved destination resolution and explicit tests; `agent-observability-test.ts` separately refuses transport; adapter launch material stays disabled | External agent trace dashboards, including optional prompt/response/tool capture. |
| `server/src/services/feedback-share-client.ts` uploaded compressed full trace bundles to a default Paperclip endpoint or configured destination, independently of normal telemetry opt-outs | Refuse before reading/serializing/uploading; the owning feedback service prevents sharing and background retries | External diagnostic sharing. Local feedback/bundle history stays available. |
| Legacy adapter processes and plugin workers inherited exporter endpoints, DSNs and CLI telemetry settings | `packages/adapter-utils/src/diagnostic-env.ts`, shared local/SSH/sandbox and ACP launch boundaries, Hermes probes and `server/src/services/plugin-worker-manager.ts`; Pi/Claude opt-outs | Known child-runtime diagnostics only. Provider credentials, routing, proxies and network tools remain available. |
| Direct automatic Claude auth/usage and Codex quota probes bypassed the common launcher | Both adapters' `src/server/quota.ts` apply the same privacy environment at their actual exec/spawn boundaries | Diagnostic inheritance only; account/quota detection remains available. |
| `server/src/config.ts` enabled the hosted announcements feed by default | Separate announcements flag prevents its automatic production use | Product-news announcements; updates remain enabled. |
| `ui/src/components/MarkdownBody.tsx`, `ui/src/components/ui/avatar.tsx`, `ui/src/components/SkillCardIcon.tsx` and `ui/src/pages/apps/AppLogo.tsx` rendered external images directly | `ui/src/lib/image-privacy.ts` permits same-origin/embedded media; remote Markdown images require a user load action; remote avatars/icons fall back to initials. The shared avatar gate precedes Radix preloading and omits responsive srcSet candidates while disabled. | Automatic third-party images, which can act as tracking pixels. |

These findings establish data-transfer paths and privacy risks, not proof of
malicious intent. Sentry/OTLP were operator-configured, and some diagnostic
sharing required a user action; their independent activation paths still made
the normal telemetry opt-out insufficient for this fork's policy.

Feedback votes and diagnostic bundles remain local. A stored sharing preference
is preserved for reversal, but the effective setting is `not_allowed` while the
policy is closed. Explicit export/test requests fail with
`403 external_diagnostics_disabled`; background upload retries become idle.

The launch helper removes case-insensitive `OTEL_*`, `SENTRY_*`,
`BETA_TRACING_ENDPOINT` and `PAPERCLIP_OBSERVABILITY_CODEX_CONFIG` settings,
then forces SDK/exporter opt-outs and the known CLI controls (`DO_NOT_TRACK=1`,
`PI_TELEMETRY=0`, `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`, Claude
telemetry/beta tracing off). It runs after environment merges. Exact public
opt-out values are excluded from diagnostic-secret matching so local quota
times/error IDs remain readable; actual credentials remain redacted. The
broad Claude nonessential-traffic switch is intentionally not forced because
it also disables the updater.

## Functions that must remain

The LM Studio wizard's **Test connection and load models** is an explicit local
metadata request, not a background upload. Its implementation is
`server/src/services/ai-model-discovery.ts`, authorized in
`server/src/routes/ai-connections.ts` and triggered only by
`ui/src/components/ai-connections/LocalModelDiscovery.tsx`. It sends
`GET <local provider URL>/models`, optionally with the key entered for that
endpoint. It never inherits credentials, follows redirects, saves a connection,
or calls inference during discovery. Only IDs/labels return to the browser;
upstream error bodies are suppressed. To hide this optional control later,
remove the `LocalModelDiscovery` branch in `AiProviderSetup.tsx` and retain its
manual model-ID field; saved connections and agent execution are independent.

- Local database records: task/run history, audit entries, recovery state and
  plugin metrics. They support control-plane correctness and stay in the instance.
- Agent Internet tools, model inference, OAuth and explicitly configured
  integrations. Their requested queries/content go to the chosen service.
- Update checks and explicit installations. Version/package lookups are useful
  maintenance operations and are not disabled by these privacy flags.
- Local logs and locally generated diagnostic bundles. Operators can inspect
  files before deliberately sharing them outside Paperclip.

Managed Hermes connection profiles now explicitly set
`telemetry.shared_metrics.enabled: false` and `send: false`. This configuration
was verified against the pinned official Hermes v0.22.5 source used by the fork
image, and is enforced by `server/src/services/ai-provider-routing.ts` while the
central diagnostics flag is false. The local Docker routing alias is exact;
arbitrary remote hosts remain rejected. The image build excludes `.env` files
and `.superpowers` scratch artifacts from its context.

Hermes/Pi and installed plugins are separate executable code. Known opt-outs and
removing inherited exporter activation do not prove every third-party program
telemetry-free. Independently installed Hermes versions still need their own
configuration/version review. Untrusted plugins can still
make Internet requests; blocking all such requests would also block the searches
and tools the user explicitly wants to keep.

The Node launch guards cover the legacy adapters, direct quota/probe children
and Node plugin workers listed above. Independent native Rust Runner launchers
and independently installed executables have their own environment/profile
rules; this audit does not certify their diagnostic behavior. Company exporter
resolution at the server is disabled for all consumers, but that is not an
OS-wide firewall or proof that every third-party runtime is telemetry-free.

## Future updates

The configured `origin` is `https://github.com/31erGER/paperclip.git`.
Work is committed and pushed on `codex/local-agent-onboarding`.

| Update method | Effect on our changes |
| --- | --- |
| Pull/merge from the 31erGER fork | Includes our published commits. Commit/push local work before merging. |
| Merge an original-repository revision into this fork | Git normally preserves both histories. Overlapping edits can require conflict resolution. Keep the privacy flags/gates and run the privacy checks before shipping. |
| Rebase our branch onto an original-repository revision | Replays our commits; conflicts need the same review. Avoid rewriting an already shared branch without coordination. |
| Install `paperclipai@latest` from public npm / run an npm-managed upgrade | Installs the original published payload, which does not contain these fork changes. It does not patch this source checkout, but starting that payload loses the fork protections. |
| Managed Git installation | The updater uses the recorded `manifest.repo` and `manifest.ref`. Install from the 31erGER repository/ref to keep fork updates; switching channels to a public npm payload changes the code source. |
| Hard reset or replacement checkout | Can discard local fork commits or choose a revision without our protections. Do not use this as the update path. |

The source-checkout updater currently refuses to modify a repository and gives
manual Git instructions (`cli/src/commands/update.ts`, `mode === "source"`).
The managed Git updater preserves its recorded repository and ref. Merely
checking for updates does not install or overwrite code.

A clean merge is not a privacy guarantee: upstream can add a new export path
without conflicting with existing gates. After every upstream merge:

1. Keep the fork's privacy commits and review changes to diagnostics and external
   image handling. Review newly introduced outbound services separately.
2. Run `pnpm check:privacy` (or `node scripts/check-privacy.mjs`) with installed
   dependencies. This runner uses Node directly and does not install packages.
3. Run affected regression suites, typechecks and the UI build; preserve any
   failures in the update review.
4. Recheck newly installed/updated agent CLIs and plugins for their own telemetry.

## Verification record

Target: this source checkout on native Windows, Node 24.16.0, pnpm 9.15.4.
Tests use isolated fixtures/local embedded databases, not production data.

- Initial audit `pnpm check:privacy`: 19 files, 75 tests passed with the actual closed
  production flags. The wrapper was invoked with the cached pinned pnpm in
  offline mode; the check itself uses installed Node/Vitest and no installer.
- Docker/onboarding follow-up (2026-10-28): 20 files / 98 privacy tests passed,
  including explicit Hermes shared-metrics opt-out and exact Docker-host
  routing/rejection cases. Wizard/provider/routing verification passed 267
  cases. These suites overlap and must not be added as unique coverage.
- Local model discovery (2026-10-29): 21 files / 116 privacy tests passed.
  Service/setup/wizard coverage passed 224 cases, and a real Linux HTTP/database
  authorization regression passed separately. An isolated browser journey proved
  two local model choices, only the checked model persisted, and real Hermes/Pi
  CLI probes against a simulated host model. The existing laptop deployment also
  returned the model list without creating a connection. This is no claim of
  real LM Studio inference. See the dated local-model-discovery plan for limits,
  retained failures and cleanup of temporary administrator/test resources.
- Core telemetry/update regressions: 8 files, 47 tests passed.
- Server diagnostic/legacy transport regressions: 12 files passed, 145 tests
  passed; 1 file / 18 tests skipped by their existing conditions. The separate
  real-database feedback suite passed 2 tests, including retained local votes,
  bundles and saved sharing preferences.
- Runtime launch regressions: 8 files, 136 tests passed, including real benign
  child-process/worker boundaries. The expanded quota/readability run passed
  82 tests and retained 8 Windows fixture failures (ACPX 0.13.1 rejects their
  unchanged raw command strings and requires argv arrays). All 8 selected
  pinned ACPX 0.12.0 real-process quota cases passed separately.
- UI compatibility: 8 files, 140 tests passed. Avatar/icon/quota review-gap
  regression run: 6 files, 27 tests passed. These counts overlap the privacy
  runner and must not be summed as unique coverage.
- Shared, adapter-utils, Claude/Codex adapter and UI typechecks passed; the UI
  production build passed. `node scripts/check-maps.mjs` passed structural
  validation.
- Independent focused privacy review resolved its avatar/icon/quota findings
  and found no remaining actionable defect in those changes. It was a source
  review, not a network capture or live third-party-agent certification.

The full repository checks were attempted again. Recursive typecheck stops at
the unchanged Runner ACP profile checksum assertion; `pnpm test:run` fails
with `spawn pnpm ENOENT` on Windows; the full build stops at the shared
package's POSIX `mkdir -p` / `cp` command under cmd. The token gate still
reports 75 color and 31 arbitrary-value violations outside this privacy diff.
Existing adapter observability tests also retain Windows file-mode/symlink
limitations. These failures are not covered by the passing targeted checks.

The first expanded ACP quota run exposed a real privacy-change regression:
public opt-out values were treated as secrets and obscured local errors. The
new regression and fix preserve credential redaction while keeping public
control values readable. Earlier failing results are retained in the local
verification logs rather than discarded after a successful retry.

The exact-public-setting exception received a second independent security
review with no findings. Unknown-key short credentials, arbitrary values under
familiar keys, configured credentials and the explicit auth token still join
the redaction set.

Local logs are in `.superpowers/sdd/2026-10-27-privacy-hardening/` (ignored by
Git). This document records portable outcomes; it does not claim a live model
run or a packet-capture proof of zero external traffic.
