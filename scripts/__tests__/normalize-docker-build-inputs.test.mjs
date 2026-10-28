import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const helper = fileURLToPath(new URL("../normalize-docker-build-inputs.mjs", import.meta.url));

test("Windows build inputs acquire canonical LF bytes while binary and unrelated data stay intact", () => {
  const root = mkdtempSync(join(tmpdir(), "paperclip-docker-text-"));
  try {
    mkdirSync(join(root, "packages/paperclip-runner/protocol"), { recursive: true });
    mkdirSync(join(root, "patches"));
    mkdirSync(join(root, "scripts"));
    const manifest = join(root, "packages/paperclip-runner/protocol/manifest.json");
    const binary = join(root, "packages/paperclip-runner/protocol/fixture.bin");
    const unrelated = join(root, "scripts/unrelated.txt");
    const bomText = join(root, "packages/paperclip-runner/protocol/bom.md");
    writeFileSync(manifest, '{\r\n  "sha256": "keep-this-attestation"\r\n}\r\n');
    writeFileSync(binary, Buffer.from([0, 13, 10, 255]));
    writeFileSync(unrelated, "keep\r\n");
    writeFileSync(bomText, Buffer.from([239, 187, 191, 97, 13, 10]));
    writeFileSync(join(root, "patches/agent.patch"), "--- a/file\r\n+++ b/file\r\n");
    writeFileSync(join(root, "scripts/docker-entrypoint.sh"), "#!/bin/sh\r\nexec node app.mjs\r\n");
    const result = spawnSync(process.execPath, [helper, root], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(manifest, "utf8"), '{\n  "sha256": "keep-this-attestation"\n}\n');
    assert.equal(readFileSync(join(root, "patches/agent.patch"), "utf8"), "--- a/file\n+++ b/file\n");
    assert.equal(readFileSync(join(root, "scripts/docker-entrypoint.sh"), "utf8"), "#!/bin/sh\nexec node app.mjs\n");
    assert.deepEqual(readFileSync(binary), Buffer.from([0, 13, 10, 255]));
    assert.equal(readFileSync(unrelated, "utf8"), "keep\r\n");
    assert.deepEqual(readFileSync(bomText), Buffer.from([239, 187, 191, 97, 10]));
    const rerun = spawnSync(process.execPath, [helper, root], { encoding: "utf8" });
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.equal(readFileSync(manifest, "utf8"), '{\n  "sha256": "keep-this-attestation"\n}\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Pi lock inputs keep their committed non-executable modes in a Linux image", { skip: process.platform === "win32" }, () => {
  const root = mkdtempSync(join(tmpdir(), "paperclip-docker-modes-"));
  try {
    const directory = join(root, "packages/paperclip-runner/scripts/pi-distribution");
    mkdirSync(directory, { recursive: true });
    for (const name of ["package.json", "package-lock.json", "unrelated.sh"]) {
      writeFileSync(join(directory, name), "{}\n");
      chmodSync(join(directory, name), 0o755);
    }
    const result = spawnSync(process.execPath, [helper, root], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    for (const name of ["package.json", "package-lock.json"]) {
      assert.equal(statSync(join(directory, name)).mode & 0o777, 0o644);
      assert.equal(readFileSync(join(directory, name), "utf8"), "{}\n");
    }
    assert.equal(statSync(join(directory, "unrelated.sh")).mode & 0o777, 0o755);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
