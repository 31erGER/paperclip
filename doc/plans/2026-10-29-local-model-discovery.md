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
- Privacy suite: 21 files / 116 tests passed, including the new bounded local
  discovery cases. Real LM Studio inference has not been claimed.

## Container acceptance record

- The first incremental candidate compiled but failed startup: plain server TSC
  overwrote the development Runner shim, and the overlay recipe omitted the
  regular build's `cp -Rf packages/paperclip-runner/dist/.
  server/dist/vendor/paperclip-runner/` step. Only the separate QA container was
  affected. Its failed health/browser result and startup logs were retained.
- Restored that regular build step in the temporary overlay recipe, rebuilt
  successfully, and retained the unchanged, verified native/provider-pack cohort.
  Corrected candidate digest:
  `sha256:453ce1f9797e4c3af11e804a7d7f0892478f59c63a99a2210f419b358e6b7256`.
- This is an application overlay (`fdc4d027e`) on the previously verified
  `5501b91db` production base, not a claim of a new cold Rust/provider-pack build.
  Normal future builds use the committed root Dockerfile, including its complete
  server build. The incremental recipe and logs stay in ignored local scratch.
- Real isolated Edge/Playwright journey passed on port 3101 with real server,
  database and Hermes/Pi CLIs, plus a simulated OpenAI-compatible model server on
  host loopback port 12438. It proved explicit `GET /v1/models`, two checkboxes,
  one selected model, no pre-save connection creation, only the selected ID
  persisted, both CLI hello probes, single-agent finalization and account logout/
  switching. No browser errors occurred. A smoke-helper company-name assertion
  initially used the old fixture name; correcting that fixture allowed the same
  journey to complete. Both failed and passing results are retained locally.
- Updated the existing port 3100 container in place with the verified runtime,
  the changed compiled/source contracts and matching UI. Its container ID,
  named data volume and environment (including session secrets) were checked
  unchanged. Health returned `ok`; a real discovery request returned both fixture
  models and left the connection count unchanged. The served UI bundle matched
  the local build byte-for-byte:
  `/assets/index-Cw3BOC07.js`, SHA256
  `18a5510c56dab897b122a1d15d596e4555987533b4d199b26ad99af0ba4cf9c3`.
- The temporary full compiled-tree export was too slow on this Windows/OneDrive
  workspace. It was stopped before any live files changed; only the changed
  compiled files and complete runtime bundle were then transferred. The live
  instance was restarted once and became healthy before the UI was switched.
- Removed the disposable port 3101 container/volume, both owned local model
  fixtures and the redundant CLI test image. The dedicated BuildKit cleanup
  initially timed out; subsequent inspection confirmed its builder, container
  and large cache volume had all been removed. Other projects were untouched.
- Verified the human operator remains instance admin, removed only the temporary
  test account's instance-admin role through the normal API (then confirmed 403),
  revoked that test session and removed its local cookie/user-list snapshots.
  Human accounts, memberships, credentials and the real port 3100 data remain.
- Real LM Studio model inference, paid subscription authorization and production
  agent workloads remain unverified. The complete native Windows repo checks
  retain the pre-existing Runner checksum, `spawn pnpm ENOENT` and POSIX command
  blockers recorded in the previous plan; no check was weakened.

## Related completed work

`2026-10-28-docker-onboarding-repair.md` records the Docker/CLI repairs and
account-access follow-up. The laptop operator's role is restored; account
switching and single-agent local setup passed an isolated real-browser journey.
