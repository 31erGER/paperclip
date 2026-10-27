const readline = require("node:readline");
const keys = ["OTEL_SDK_DISABLED", "OTEL_TRACES_EXPORTER", "OTEL_EXPORTER_OTLP_ENDPOINT", "SENTRY_DSN", "DO_NOT_TRACK", "PI_TELEMETRY", "OPENAI_BASE_URL", "OPENAI_API_KEY", "HTTPS_PROXY", "DISABLE_AUTOUPDATER", "PAPERCLIP_PLUGIN_ID"];
readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", line => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  const result = message.method === "initialize"
    ? { ok: true, supportedMethods: ["health"] }
    : message.method === "health"
      ? { status: "ok", details: { env: Object.fromEntries(keys.map(key => [key, process.env[key]])) } }
      : {};
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
  if (message.method === "shutdown") setImmediate(() => process.exit(0));
});
