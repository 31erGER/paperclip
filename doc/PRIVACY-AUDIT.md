# Privacy controls in the 31erGER fork

Audit and implementation date: 2026-10-27.

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
| Legacy adapter processes inherited exporter endpoints, DSNs and CLI telemetry settings | Shared child-launch privacy environment and adapter diagnostic gates; documented Pi/Claude opt-outs | Known child-runtime diagnostics only. Provider credentials, routing, proxies and network tools remain available. |
| `server/src/config.ts` enabled the hosted announcements feed by default | Separate announcements flag prevents its automatic production use | Product-news announcements; updates remain enabled. |
| `ui/src/components/MarkdownBody.tsx`, `Identity.tsx`, `SidebarAccountMenu.tsx` and its production variant rendered external images directly | Same-origin/embedded media remains; remote Markdown images require a user load action; remote avatars fall back to initials | Automatic third-party images, which can act as tracking pixels. |

These findings establish data-transfer paths and privacy risks, not proof of
malicious intent. Sentry/OTLP were operator-configured, and some diagnostic
sharing required a user action; their independent activation paths still made
the normal telemetry opt-out insufficient for this fork's policy.

## Functions that must remain

- Local database records: task/run history, audit entries, recovery state and
  plugin metrics. They support control-plane correctness and stay in the instance.
- Agent Internet tools, model inference, OAuth and explicitly configured
  integrations. Their requested queries/content go to the chosen service.
- Update checks and explicit installations. Version/package lookups are useful
  maintenance operations and are not disabled by these privacy flags.
- Local logs and locally generated diagnostic bundles. Operators can inspect
  files before deliberately sharing them outside Paperclip.

Hermes/Pi and installed plugins are separate executable code. Known opt-outs and
removing inherited exporter activation do not prove every third-party program
telemetry-free. In particular, a Hermes-specific opt-out must be verified against
the installed Hermes version rather than invented. Untrusted plugins can still
make Internet requests; blocking all such requests would also block the searches
and tools the user explicitly wants to keep.

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

Implementation and verification are in progress. Record the final successful
commands, remaining platform limitations and independent privacy review here
before the privacy changes are marked complete.
