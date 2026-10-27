import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensurePiModelConfiguredAndAvailable,
  discoverPiModels,
  listPiModels,
  resetPiModelsCacheForTests,
} from "./models.js";

async function writePiFixture(directory: string, source: string): Promise<string> {
  const script = join(directory, "pi-fixture.cjs");
  await writeFile(script, `#!/usr/bin/env node\n${source}\n`);
  if (process.platform === "win32") {
    const command = join(directory, "pi-fixture.cmd");
    await writeFile(command, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    return command;
  }
  await chmod(script, 0o755);
  return script;
}

describe("pi models", () => {
  afterEach(() => {
    delete process.env.PAPERCLIP_PI_COMMAND;
    resetPiModelsCacheForTests();
  });

  it("returns an empty list when discovery command is unavailable", async () => {
    process.env.PAPERCLIP_PI_COMMAND = "__paperclip_missing_pi_command__";
    await expect(listPiModels()).resolves.toEqual([]);
  });

  it("rejects when model is missing", async () => {
    await expect(
      ensurePiModelConfiguredAndAvailable({ model: "" }),
    ).rejects.toThrow("Pi requires `adapterConfig.model`");
  });

  it("rejects when discovery cannot run for configured model", async () => {
    process.env.PAPERCLIP_PI_COMMAND = "__paperclip_missing_pi_command__";
    await expect(
      ensurePiModelConfiguredAndAvailable({
        model: "xai/grok-4",
      }),
    ).rejects.toThrow();
  });

  it("discovers Pi models with diagnostic opt-outs while preserving provider and update settings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paperclip-pi-privacy-"));
    try {
      const command = await writePiFixture(directory, `
        const expected = { PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true", DO_NOT_TRACK: "1", OPENAI_API_KEY: "fixture-key", OPENAI_BASE_URL: "https://provider.invalid/v1", HTTPS_PROXY: "http://proxy.invalid:8080", PI_SKIP_VERSION_CHECK: "0" };
        for (const [key, value] of Object.entries(expected)) if (process.env[key] !== value) process.exit(2);
        if (process.env.SENTRY_DSN || process.env.OTEL_EXPORTER_OTLP_ENDPOINT) process.exit(3);
        process.stdout.write("provider  model\\nfixture  private-model\\n");
      `);
      await expect(discoverPiModels({ command, env: {
        PI_TELEMETRY: "1", OTEL_SDK_DISABLED: "false", SENTRY_DSN: "https://diagnostics.invalid/1", OTEL_EXPORTER_OTLP_ENDPOINT: "https://diagnostics.invalid/otel",
        OPENAI_API_KEY: "fixture-key", OPENAI_BASE_URL: "https://provider.invalid/v1", HTTPS_PROXY: "http://proxy.invalid:8080", PI_SKIP_VERSION_CHECK: "0",
      } })).resolves.toEqual([{ id: "fixture/private-model", label: "fixture/private-model" }]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not embed the model catalogue when the configured model is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paperclip-pi-models-"));
    const modelIds = Array.from({ length: 13 }, (_, index) => `provider/model-${index}`);
    const command = await writePiFixture(directory,
      `process.stdout.write(${JSON.stringify(["provider  model", ...modelIds.map(id => id.replace("/", "  "))].join("\n"))});`);

    try {
      await expect(
        ensurePiModelConfiguredAndAvailable({
          command,
          model: "provider/missing",
        }),
      ).rejects.toMatchObject({
        message:
          "Configured Pi model is unavailable: provider/missing. 13 models are available; list them with `pi --list-models`.",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
