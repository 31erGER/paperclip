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
- [ ] Run the relevant wizard/provider-connection suites, UI typecheck and token gates; commit/push a coherent fix.

## Task3: Prove and repair Docker prerequisites

Files: `Dockerfile`, `doc/DOCKER.md`, `doc/connections/AI-CONNECTIONS.md`, narrow packaging tests/helper if needed.

- [ ] Verify the official pinned Pi package already used by this repo and the official Hermes distribution/install contract.
- [ ] Add the missing local CLI distributions to the image's build-time tool layer, preserving updates and privacy gates; use an isolated environment for Python dependencies.
- [ ] Verify CLI entrypoints/versions as the runtime user in an isolated container. Check the local inference URL instructions for Docker Desktop and Linux host reachability.
- [ ] Document exact build/ref and persistence instructions so a rebuilt fork image is distinguishable from an original/old image. Commit/push after verification.

## Task4: Integrated verification and review

- [ ] Exercise the built UI journey with representative authenticated/private fixture APIs, or the isolated source container if the full build is available. Record whether APIs/providers are real or simulated.
- [ ] Run `pnpm check:privacy`, relevant typechecks/build, and map validation after updating affected map entries.
- [ ] Attempt the required full checks; preserve existing Runner checksum, Windows shell/runner and token-gate failures. Do not weaken checks to hide them.
- [ ] Obtain one independent final review; repair actionable findings with red/green evidence.
- [ ] Update this plan's results, commit/push and verify clean status plus remote HEAD.

## Execution record

- User confirmed the affected container is on another PC and explicitly authorized building/starting an isolated instance here. The other PC's memory failure has no known phase/error yet.
- Baseline adapter suite: 7 passed. New source/method cases: 8 passed after reproducing and fixing the Copilot no-op and delayed method overwrite. The current source offers Hermes/Pi in both private auth modes.
- Broader wizard/provider run: 233 passed; one newly added policy assertion read before React's query notification committed. Waiting for the actual DOM policy state corrected that assertion; all 8 new cases then passed. Retain both logs.
- UI typecheck and production build passed. Token gates retain the same 106 existing violations.
- Ruling: extend Docker repair to the exact `host.docker.internal` endpoint alias — the shared local-route validator currently rejects the address needed to reach host LM Studio from bridge-networked Docker. Arbitrary LAN/public hosts and lookalike domains remain rejected.
- Ruling: explicitly turn Hermes shared metrics off in generated managed profiles — the verified pinned Hermes distribution supports this config, and the existing privacy policy requires both collection/upload disabled.
- Docker build uses its own BuildKit container (8GB RAM / 10GB RAM+swap, two concurrent build steps) to protect unrelated running containers. A sample during concurrent application build and CLI-image export reached 7.8GB; this is not an isolated steady-state Paperclip measurement.
