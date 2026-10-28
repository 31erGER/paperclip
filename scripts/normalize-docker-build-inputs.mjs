import { readFile, writeFile, readdir, lstat } from "node:fs/promises";
import { extname, resolve } from "node:path";

// These inputs have byte-level contracts checked against canonical Git/CI LF
// content. Windows working trees may still have CRLF after an attribute change.
// Normalize only line endings before building; never regenerate attestations.
const roots = ["packages/paperclip-runner", "patches", "scripts/docker-entrypoint.sh"];
const textExtensions = new Set([".json", ".jsonl", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".md", ".yaml", ".yml", ".toml", ".lock", ".rs", ".sh", ".patch", ".txt", ".sql", ".html", ".css"]);
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
let changed = 0;

async function visit(path) {
  const info = await lstat(path).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (!info || info.isSymbolicLink()) return;
  if (info.isDirectory()) {
    for (const entry of await readdir(path)) {
      if (entry !== "node_modules" && entry !== "target" && entry !== ".git") await visit(resolve(path, entry));
    }
    return;
  }
  if (!info.isFile() || !textExtensions.has(extname(path))) return;
  const raw = await readFile(path);
  if (raw.includes(0) || !raw.includes(Buffer.from("\r\n"))) return;
  let text;
  try { text = decoder.decode(raw); } catch { return; }
  await writeFile(path, text.replace(/\r\n/g, "\n"));
  changed++;
}

const root = resolve(process.argv[2] ?? process.cwd());
for (const input of roots) await visit(resolve(root, input));
console.log(`Normalized CRLF in ${changed} Docker text inputs; binary files and unrelated paths unchanged.`);
