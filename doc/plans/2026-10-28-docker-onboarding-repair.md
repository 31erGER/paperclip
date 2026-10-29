# Docker onboarding repair implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. The user explicitly requested investigation, then a plan, then continuous systematic execution in this chat.

**Goal:** Make the existing self-hosted Docker onboarding offer Hermes/Pi with LM Studio and make every displayed credential switch perform its stated action.

**Architecture:** Keep company/account access and agent creation with their current owners. Repair the existing wizard's source/method state and restoration rather than adding another onboarding path. Verify Docker's actual runtime prerequisites and distinguish source behavior from an old or differently built image.

**Tech stack:** Existing React/TypeScript wizard, Vitest, Docker, Node/Python agent CLIs, existing managed local connections.

**Spec:** The approved Hermes/Pi → LM Studio → connection test flow in this chat, plus the user's report after account creation and first-admin claim. Preserve working Claude/Codex/Copilot configuration, local privacy gates and multi-user auth.

## Investigation findings

- Checkout: `codex/local-agent-onboarding`, clean at `53afa36d6` before this repair.
- Docker and Compose explicitly select `authenticated/private`; this is supported self-hosting, not Paperclip Cloud.
- The current wizard registers Hermes/Pi and recommends them when Cloud metadata is absent and managed-sandbox-only policy is off. Their disappearance has not yet been reproduced against the user's image; do not invent a root cause.
- `credentialMode` is forced to `api` for Copilot while `CredentialModeLink` remains rendered and changes only the ignored preference. A subscription switch can therefore be offered without an effect.
- Restored setup records asynchronously write provider/method selection. Exercise delayed restoration so it cannot silently overwrite a newer explicit choice.
- The Docker tool-install layer installs Claude/Codex/OpenCode/Gemini/Kimi, but no Hermes or Pi CLI. A visible adapter alone does not prove a runnable container setup.
- No Paperclip container/image is currently present on this host's Docker daemon, and port3100 is closed. A question about the affected host/build command is pending; continue independent source checks meanwhile. Do not touch unrelated containers.

## Global constraints

- Keep the existing feature branch and user-authorized frequent coherent commits/pushes to `31erGER/paperclip`; no main-branch merge, no data reset.
- Preserve login, first-admin claim, company isolation, saved provider accounts and the privacy policy.
- Use existing UI tokens; do not create another competing setup flow.
- Use explicit agent package versions and build-time installation if packaging needs repair. Do not download/install tools silently at application startup.
- Local model requests must not fall back to a cloud provider. A container's localhost is not the host's LM Studio server.
- Never claim a live subscription/model run from fixtures or component tests.

## Review focus

- Authenticated/private Docker has no Cloud metadata and must retain local model choices.
- Server-disabled adapters and explicit managed-sandbox-only policy stay enforced.
- Switching provider/method cannot reuse another provider's credential or create duplicate agents.
- Delayed saved-state responses must not replace an explicit newer choice.
- Copilot must not advertise unsupported subscription authorization.

## Task1: Reproduce the actual source/method failures

Files: `ui/src/components/OnboardingWizard.test.tsx`, `ui/src/components/OnboardingWizard.adapters.test.tsx`, existing canary tests under `tests/canary-onboarding/` as appropriate.

- [x] Run the existing relevant wizard baseline and inspect the actual adapter metadata/registration.
- [x] Add an authenticated/private fresh-install regression that checks Hermes/Pi alongside the cloud providers; include disabled/managed-only cases without mocking away the policy being verified.
- [x] Add regressions for API/subscription switching, restored Copilot and delayed setup restoration. Observe a failing assertion before changing production behavior.
- [x] Record which report reproduces in current source and which still depends on the user's image/build identity.

## Task2: Repair the existing wizard

Files: `ui/src/components/OnboardingWizard.tsx`, `ui/src/components/onboarding/CredentialModeLink.tsx` only if its shared contract is at fault, tests from Task1.

- [x] Make a displayed method switch effective for providers supporting both methods. Hide unsupported switching on a committed token-only Copilot selection.
- [x] Preserve explicit newer user choices if delayed setup restoration reproduces the race.
- [x] Correct a source-visibility condition only if Task1 proves it wrong; retain the real self-hosted/cloud policy distinction. Current visibility is correct; no speculative filter change.
- [x] Run the relevant wizard/provider-connection suites, UI typecheck and token gates; commit/push a coherent fix. Commit `037e05124`; 267 targeted cases pass, UI typecheck/build pass, 106 existing token violations remain.

## Task3: Prove and repair Docker prerequisites

Files: `Dockerfile`, `doc/DOCKER.md`, `doc/connections/AI-CONNECTIONS.md`, narrow packaging tests/helper if needed.

- [x] Verify the official pinned Pi package already used by this repo and the official Hermes distribution/install contract.
- [x] Add the missing local CLI distributions to the image's build-time tool layer, preserving updates and privacy gates; use an isolated environment for Python dependencies.
- [x] Verify CLI entrypoints/versions as the runtime user in an isolated container. Check the local inference URL instructions for Docker Desktop and Linux host reachability. Both CLIs exit successfully as `node` with networking disabled in the tool-stage image; final production verification is still pending.
- [x] Document exact build/ref and persistence instructions so a rebuilt fork image is distinguishable from an original/old image. Published in `47611efd4` / `5501b91db`.

## Task4: Integrated verification and review

- [x] Exercise the built UI journey with representative authenticated/private fixture APIs, or the isolated source container if the full build is available. Complete isolated signup/claim, provider choice, saved LM Studio routing and real Hermes/Pi CLI hello checks passed against a simulated host model; no real model/subscription claim.
- [x] Run `pnpm check:privacy`, relevant typechecks/build, and map validation after updating affected map entries. 98 privacy tests passed at that checkpoint; later model discovery extends the suite to 116.
- [x] Attempt the required full checks; preserve existing Runner checksum, Windows shell/runner and token-gate failures. Do not weaken checks to hide them. See the recorded Windows failures below.
- [x] Obtain one independent final review; repair actionable findings with red/green evidence. Independent read-only review found no actionable issue; production-image acceptance remains a separate required check.
- [x] Update this plan's results and publish verification. Implementation commits
  `037e05124`, `47611efd4`, `5501b91db` and `b77ac7e63` are pushed to the fork;
  the model-discovery follow-up records final container cleanup below.

## Execution record

### Follow-up: local account access and completed setup (2026-10-29)

- [x] Identify the signed-in account and restore only the human operator's
  intended access through the existing admin API. The browser-test administrator
  had already claimed this laptop instance; the later human signup had no role.
  Verified the targeted promotion without deleting accounts or changing passwords.
- [x] Reproduce missing logout on **No organization access** (three red cases:
  self-hosted logout/cache reset, failed logout, existing Cloud logout).
- [x] Add the existing `useSignOut` hook to that page; preserve permission gates.
- [x] Reproduce a saved native runner leaking into the neutral process setup
  placeholder; resolve the placeholder with `auto` before a source is selected.
- [x] Complete affected suites/typecheck/build: 216 tests passed across the three
  complete UI suites; UI typecheck/build and maps pass. Token gates retain their
  106 existing violations. Independent read-only review found no actionable issue.
- [x] Complete real browser verification; commit/push the follow-up and keep
  the user's current volume/session secrets. `b77ac7e63`; the separate real browser
  journey passed signup/claim, both local CLIs, single-agent finalization, second
  account denial, logout and signing in as a different account. Matching UI was
  deployed on the existing port 3100 container without replacing data/secrets.
- [x] Remove only the isolated build/test resources after verification; the
  laptop instance on port 3100 now contains a real user account and must remain.
  Builder/cache, disposable port 3101 data, redundant CLI test image and owned
  model fixtures were removed. The temporary QA admin role/session was retired
  after checking the human operator's admin role. See the 2026-10-29 plan.

### Final production acceptance (2026-10-29)

The `5501b91db` production image completed Rust, UI, server, runtime-bundle and
provider-pack verification. Its first export command was interrupted after the
image had registered; a repeated exact-source cached build completed with exit
zero. Digest: `sha256:4722d15b8d237fad88456e1845ba6432d0d68d90665ecfb87efa44e1d0e44697`.
The final image and both real local CLIs were exercised as the runtime user.
The separate real browser journey passed; earlier failure records above are
historical and remain preserved. Full native Windows checks still have the
documented platform/tooling blockers. The 2026-10-29 model-discovery plan records
the later application overlay, preserving deployment and final cleanup.

### Earlier investigation and verification

- User confirmed the affected container is on another PC and explicitly authorized building/starting an isolated instance here. The other PC's memory failure has no known phase/error yet.
- Baseline adapter suite: 7 passed. New source/method cases: 8 passed after reproducing and fixing the Copilot no-op and delayed method overwrite. The current source offers Hermes/Pi in both private auth modes.
- Broader wizard/provider run: 233 passed; one newly added policy assertion read before React's query notification committed. Waiting for the actual DOM policy state corrected that assertion; all 8 new cases then passed. Retain both logs.
- UI typecheck and production build passed. Token gates retain the same 106 existing violations.
- Ruling: extend Docker repair to the exact `host.docker.internal` endpoint alias — the shared local-route validator currently rejects the address needed to reach host LM Studio from bridge-networked Docker. Arbitrary LAN/public hosts and lookalike domains remain rejected.
- Ruling: explicitly turn Hermes shared metrics off in generated managed profiles — the verified pinned Hermes distribution supports this config, and the existing privacy policy requires both collection/upload disabled.
- Docker build uses its own BuildKit container (8GB RAM / 10GB RAM+swap, two concurrent build steps) to protect unrelated running containers. A sample during concurrent application build and CLI-image export reached 7.8GB; this is not an isolated steady-state Paperclip measurement.
- Baseline full Docker build failed at the unchanged Runner protocol manifest check because Windows CRLF bytes differed from committed LF bytes. Verified normalized input hashes against Git blobs; added narrowly scoped normalization, preserving binary/BOM content and all integrity checks. Node regression passed after an observed BOM preservation failure was repaired.
- Repaired full build passed native Rust, UI, server and runtime-bundle stages. Image export/runtime acceptance is pending. Compose now selects `production` explicitly instead of Dockerfile's final optional `cloud` stage.
- Shared/UI typechecks and map validation pass. Privacy verification: 20 files / 98 tests pass. No real LM Studio model or subscription authentication has been exercised.
- Stamped production build additionally exposed a native Pi closure mismatch. Diagnosis proved Windows Docker COPY used `0755` for both Pi distribution manifests although Git records `100644`. Added a Linux regression (observed red, then green) and canonicalized only those two modes in the normalized-inputs helper. Trusted closure pins are unchanged; re-run of the full pack check is pending.
- Required full native Windows checks were attempted again: recursive typecheck fails at the existing ACP patch checksum/CRLF assertion; test runner fails at `spawn pnpm ENOENT`; recursive build fails at the existing shared POSIX `mkdir -p` / `cp` command. Restored only the teams catalog generated by that failed build.
