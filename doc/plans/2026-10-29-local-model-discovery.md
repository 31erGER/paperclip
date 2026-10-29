# Local OpenAI-compatible model discovery

User request: In the existing LM Studio wizard, test the provider URL and fetch
its model list, then choose model IDs from an expandable checkbox list.

## Decisions and boundaries

- Reuse `AiProviderSetup` and its existing saved routing/model contract. Keep
  manual IDs as a fallback; native/cloud credential flows stay with their owner.
- Perform an explicit, user-triggered server-side `GET <base URL>/models`, as
  documented at https://lmstudio.ai/docs/developer/openai-compat/models. A URL
  ending in `/v1` therefore requests `/v1/models`. This tests reachability and
  listing, not inference quality or tool capability.
- Initial discovery supports unsaved local OpenAI-compatible connections only
  (`chat`/`responses`, no auth or an explicitly entered bearer token). Apply the
  existing local URL validator, company access and connection-creation authority.
  Never follow redirects, inherit provider credentials, or fall back to a cloud.
- Bound request time and response size; return sanitized model IDs/labels only.
  Keep credentials in the POST body and server memory; do not persist them during
  discovery or expose upstream response bodies in errors.
- Scope results to the current URL/auth settings. Ignore stale in-flight results
  after changes. Selecting checkboxes updates the same model IDs saved today.
  Show errors, empty results and retry; keep the agent's real connection probe.
- Preserve the laptop's current container, users, volume and session secrets.
  Use the separate QA instance for verification, then update the running app.

## Implementation and verification

1. Add shared request/result contracts and focused regressions for the bounded
   HTTP discovery service, local URL restrictions and hostile responses.
2. Add the company-scoped route using existing management/create authorization;
   prove foreign companies, viewers and unauthorized agents cannot issue probes.
3. Add explicit discovery and expandable model checkboxes to local setup, with
   stale-result/error/empty/manual-fallback tests and unchanged native flows.
4. Run targeted tests, typechecks/build and token/map/privacy checks. Obtain an
   independent review. Commit/push coherent checkpoints to the existing fork.
5. Verify actual server HTTP requests and checkbox persistence in the isolated
   container against a local protocol fixture (and real LM Studio if available).
   Update the laptop without replacing its data; document evidence and cleanup.

## Related completed work

## Source verification checkpoint

- Service, setup and complete wizard suites: 224 tests passed across three files.
- Real Linux HTTP/embedded-database route regression: one selected test passed
  (147 unrelated cases skipped), including public-host/foreign-company/viewer/
  agent denial and an ordinary member's successful discovery without persistence.
- Shared and UI typechecks, UI production build, and Linux server compilation /
  runtime bundling passed. Maps structural checks passed.
- Token gates retain the same 106 existing violations (75 colors, 31 arbitrary
  values); none are in the changed component files. No allowlist was added.
- Independent review found and rechecked two repaired issues: retain raw manual
  input while typing commas; validate/default personal ownership before the
  existing management guard. The final server-host gate review found no new issue.
- The first Windows database-fixture attempt timed out during setup. Linux then
  reproduced the missing route (404), exposed the ownership-guard rejection,
  and passed after repair. Earlier failing logs are retained in ignored scratch.
- Privacy suite and real isolated-container/browser acceptance are still pending
  at this checkpoint. Real LM Studio inference has not been claimed.

`2026-10-28-docker-onboarding-repair.md` records the Docker/CLI repairs and
account-access follow-up. The laptop operator's role is restored; account
switching and single-agent local setup passed an isolated real-browser journey.
