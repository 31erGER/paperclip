# Local agent onboarding implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Configure the first company with Hermes or Pi and an LM Studio model without a cloud account or API key.

**Architecture:** Reuse the existing `hermes_local` and `pi_local` adapters and company-scoped managed AI connections. LM Studio uses the existing local Chat Completions routing contract. Keep endpoint credentials, access checks, isolated runtime configuration and environment tests in their existing owners.

**Tech stack:** React, TypeScript, Zod, Vitest, existing Pi/Hermes CLI adapters.

**Spec:** User-approved flow in this chat: select Hermes/Pi, configure LM Studio, test the connection, finish setup.

## Global constraints

- Default LM Studio URL: `http://localhost:1234/v1`; no authentication by default.
- Local connections retain loopback validation and never fall back to a cloud provider.
- Preserve existing Claude/OpenAI setup and server-disabled adapter filtering.
- Reuse UI tokens and existing connection forms. No schema migration or new adapter type.
- Local first-company setup uses the existing local CLI adapters (legacy runner).
- Leave changes on `codex/local-agent-onboarding` for review; no publishing or commits requested.

## Review focus

- A slash in an upstream model ID must survive Pi's provider prefixing.
- Switching sources must not reuse another source/company's connection.
- Restoring setup must preserve the saved local binding and require a model.
- A missing CLI or failed inference request must prevent successful setup.
- Local model setup must make no OpenRouter catalog request.

### Task 1: Route managed local models to Pi

Files: `packages/shared/src/ai-provider-routing.ts`, `server/src/services/ai-provider-routing.ts`, `server/src/services/ai-connection-runtime.ts`, `server/src/__tests__/ai-provider-routing.test.ts`.

Interface: existing `isAiRoutingCompatible`, `aiRoutingModel`, `managedProviderRouting`; Pi reads isolated `models.json` via `PI_CODING_AGENT_DIR`.

- [x] Add and run failing tests for local Chat Completions compatibility, Pi model prefixing, and provider isolation.
- [x] Project a single custom Pi provider into the disposable managed connection home; use a non-secret placeholder only when authentication is disabled.
- [x] Run routing tests; managed-runtime integration tests also attempted (see execution record).

### Task 2: Expose local setup

Files: `ui/src/components/OnboardingWizard.tsx`, `ui/src/components/onboarding/OnboardingLocalSetup.tsx`, `ui/src/components/onboarding/ModelSourceTiles.tsx`, `ui/src/components/ai-connections/AiProviderSetup.tsx`, associated component tests.

Interface: existing managed binding callbacks and `useConnectionModelsState` supply the saved local connection and its models to the wizard's existing save/test/complete path.

- [x] Add and run failing tests for LM Studio defaults and visible Hermes/Pi onboarding choices.
- [x] Offer Hermes/Pi on self-hosted onboarding and a local connection form with LM Studio defaults, explicit model ID and optional authentication.
- [x] Require the selected local binding/model before testing or finishing. Preserve restore, switching and disabled-adapter behavior.
- [x] Run the affected UI tests and token gates.

### Task 3: Document and verify

- [x] Document prerequisites, localhost semantics, privacy scope and setup steps in `doc/connections/AI-CONNECTIONS.md`.
- [x] Update mapped onboarding behavior and run `node scripts/check-maps.mjs` if map entries change.
- [x] Run targeted tests, `pnpm -r typecheck`, `pnpm test:run`, `pnpm build` and report any environment blockers precisely.
- [x] Review the complete diff and resolve actionable findings.

## Execution record

- Initial checkout clean; created `codex/local-agent-onboarding` in place so existing local startup uses the requested changes.
- Dependencies absent. pnpm 9 frozen install rejects pre-existing patch/config drift; retrying the environment's pnpm with the workspace manifest's supported configuration.
- Dependency installation completed with pnpm 9; original package.json and lockfile restored unchanged. Builds regenerated a tracked team catalog; it was restored.
- Red/green evidence: local Pi routing originally rejected; LM Studio URL originally empty; Hermes/Pi absent from source row. All were reproduced before implementation. Review also reproduced the Pi fixed-binding precheck and native reserved-key failures before correction.
- Passed: all 178 wizard tests and 7 adapter-selection tests; 46 final routing/provider/model-list tests; shared/UI typechecks; UI production build; map structural checks. The final 46-test run includes the previously outdated no-auth access-copy assertion after updating its expectation.
- Independent review found two Pi issues (fixed binding rejected before metadata lookup; authenticated native Pi rejected a reserved environment variable). Both corrected and re-reviewed with no remaining actionable findings.
- Required full-check limitations: recursive typecheck stops at the existing Runner profile checksum assertion; full tests cannot spawn `pnpm` on Windows; full build stops at the existing POSIX `mkdir -p`/`cp` script under Windows cmd. Direct server typecheck also reports missing generated Runner types and related pre-existing errors, with no errors in the changed server/shared implementation files.
- Token gates report 75 color and 31 arbitrary-value violations outside all changed UI files; no new violation in this change.
- Managed-runtime integration retry hit the existing database setup's 90-second beforeAll timeout. The serial retry without concurrent builds passed all five no-auth adapter cases, including Pi's generated models.json and Hermes. Total relevant tests across the final suites: 236 passed. The timeout remains recorded here as a verification environment limitation.
- Live inference not verified: no LM Studio server is listening on localhost:1234. Local inference controls model routing; tool network access and instance telemetry remain separate settings.
