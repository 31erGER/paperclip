// fork 31erGER: regression tests for Pi UI transcript parsing.
import { describe, expect, it } from "vitest";
import { parsePiStdoutLine, resetParserState } from "./parse-stdout.js";

const TS = "2026-11-24T20:00:00.000Z";

describe("parsePiStdoutLine", () => {
  it("maps user wake payloads in message_end to user entries instead of assistant bubbles", () => {
    resetParserState();
    const wakeLine = JSON.stringify({
      type: "message_end",
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text: "## Paperclip Wake Payload\n\nAgent ID: agent-1\nChat mode directive: reply concisely.",
          },
        ],
      },
    });

    const entries = parsePiStdoutLine(wakeLine, TS);
    expect(entries).toEqual([
      {
        kind: "user",
        ts: TS,
        text: "## Paperclip Wake Payload\n\nAgent ID: agent-1\nChat mode directive: reply concisely.",
      },
    ]);
  });

  it("drops toolResult message_end so tool outputs do not leak as assistant messages", () => {
    resetParserState();
    const toolResultLine = JSON.stringify({
      type: "message_end",
      message: {
        role: "toolResult",
        toolCallId: "tc-1",
        toolName: "bash",
        content: [{ type: "text", text: "file1\nfile2" }],
      },
    });

    expect(parsePiStdoutLine(toolResultLine, TS)).toEqual([]);
  });

  it("streams thinking and text once without duplicating on thinking_end, text_end, message_end, turn_end, or agent_end", () => {
    resetParserState();
    const lines = [
      JSON.stringify({ type: "session", id: "s-1", cwd: "/tmp/work" }),
      JSON.stringify({ type: "agent_start" }),
      JSON.stringify({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "First I should " },
      }),
      JSON.stringify({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "check the files." },
      }),
      JSON.stringify({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_end", content: "First I should check the files." },
      }),
      JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "tc-1",
        toolName: "read",
        args: { path: "README.md" },
      }),
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "tc-1",
        toolName: "read",
        result: { content: [{ type: "text", text: "# Hello" }] },
        isError: false,
      }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "First I should check the files." }],
        },
      }),
      JSON.stringify({
        type: "turn_end",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "First I should check the files." }],
        },
        toolResults: [
          { toolCallId: "tc-1", toolName: "read", content: [{ type: "text", text: "# Hello" }], isError: false },
        ],
      }),
      JSON.stringify({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Done!" },
      }),
      JSON.stringify({
        type: "message_update",
        assistantMessageEvent: { type: "text_end", content: "Done!" },
      }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done!" }],
        },
      }),
      JSON.stringify({
        type: "agent_end",
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "Done!" }],
            usage: { input: 100, output: 20, cacheRead: 10, cost: { total: 0.002 } },
          },
        ],
      }),
      JSON.stringify({ type: "agent_settled" }),
    ];

    const entries = lines.flatMap((line) => parsePiStdoutLine(line, TS));

    expect(entries.filter((e) => e.kind === "thinking")).toEqual([
      { kind: "thinking", ts: TS, text: "First I should ", delta: true },
      { kind: "thinking", ts: TS, text: "check the files.", delta: true },
      { kind: "thinking", ts: TS, text: "First I should check the files.", lifecycle: "completed" },
    ]);
    expect(entries.filter((e) => e.kind === "assistant")).toEqual([
      { kind: "assistant", ts: TS, text: "Done!", delta: true },
    ]);
    expect(entries.filter((e) => e.kind === "tool_result")).toHaveLength(1);
    expect(entries.filter((e) => e.kind === "stdout")).toEqual([]);
    expect(entries.filter((e) => e.kind === "result")).toHaveLength(1);
  });

  it("emits structured diff entries from Pi edit result.details.diff", () => {
    resetParserState();
    const startLine = JSON.stringify({
      type: "tool_execution_start",
      toolCallId: "tc-edit-1",
      toolName: "edit",
      args: { path: "src/app.ts", oldText: "const a = 1;", newText: "const a = 2;\nconst b = 3;" },
    });
    const endLine = JSON.stringify({
      type: "tool_execution_end",
      toolCallId: "tc-edit-1",
      toolName: "edit",
      result: {
        content: [{ type: "text", text: "Successfully replaced text in src/app.ts." }],
        details: {
          diff: " 10 function init() {\n-11   const a = 1;\n+11   const a = 2;\n+12   const b = 3;\n 13 }",
          firstChangedLine: 11,
        },
      },
      isError: false,
    });

    const entries = [
      ...parsePiStdoutLine(startLine, TS),
      ...parsePiStdoutLine(endLine, TS),
    ];

    expect(entries.filter((e) => e.kind === "diff")).toEqual([
      { kind: "diff", ts: TS, changeType: "file_header", text: "src/app.ts", toolUseId: "tc-edit-1", additions: 2, deletions: 1 },
      { kind: "diff", ts: TS, changeType: "context", text: "10 function init() {", toolUseId: "tc-edit-1" },
      { kind: "diff", ts: TS, changeType: "remove", text: "11   const a = 1;", toolUseId: "tc-edit-1" },
      { kind: "diff", ts: TS, changeType: "add", text: "11   const a = 2;", toolUseId: "tc-edit-1" },
      { kind: "diff", ts: TS, changeType: "add", text: "12   const b = 3;", toolUseId: "tc-edit-1" },
      { kind: "diff", ts: TS, changeType: "context", text: "13 }", toolUseId: "tc-edit-1" },
    ]);
  });

  it("emits fallback diff entries for edit without details.diff and for write calls", () => {
    resetParserState();
    const editEntries = [
      ...parsePiStdoutLine(
        JSON.stringify({
          type: "tool_execution_start",
          toolCallId: "tc-edit-2",
          toolName: "edit",
          args: { path: "notes.md", oldText: "line1\nold\nline3", newText: "line1\nnew\nline3" },
        }),
        TS,
      ),
      ...parsePiStdoutLine(
        JSON.stringify({
          type: "tool_execution_end",
          toolCallId: "tc-edit-2",
          toolName: "edit",
          result: { content: [{ type: "text", text: "Updated notes.md" }] },
          isError: false,
        }),
        TS,
      ),
    ];
    expect(editEntries.filter((e) => e.kind === "diff")).toEqual([
      { kind: "diff", ts: TS, changeType: "file_header", text: "notes.md", toolUseId: "tc-edit-2", additions: 1, deletions: 1 },
      { kind: "diff", ts: TS, changeType: "context", text: "line1", toolUseId: "tc-edit-2" },
      { kind: "diff", ts: TS, changeType: "remove", text: "old", toolUseId: "tc-edit-2" },
      { kind: "diff", ts: TS, changeType: "add", text: "new", toolUseId: "tc-edit-2" },
      { kind: "diff", ts: TS, changeType: "context", text: "line3", toolUseId: "tc-edit-2" },
    ]);

    const writeEntries = [
      ...parsePiStdoutLine(
        JSON.stringify({
          type: "tool_execution_start",
          toolCallId: "tc-write-1",
          toolName: "write",
          args: { path: "new.md", content: "# Title\nBody line\n" },
        }),
        TS,
      ),
      ...parsePiStdoutLine(
        JSON.stringify({
          type: "tool_execution_end",
          toolCallId: "tc-write-1",
          toolName: "write",
          result: { content: [{ type: "text", text: "Successfully wrote new.md" }] },
          isError: false,
        }),
        TS,
      ),
    ];
    expect(writeEntries.filter((e) => e.kind === "diff")).toEqual([
      { kind: "diff", ts: TS, changeType: "file_header", text: "new.md", toolUseId: "tc-write-1", additions: 2, deletions: 0 },
      { kind: "diff", ts: TS, changeType: "add", text: "# Title", toolUseId: "tc-write-1" },
      { kind: "diff", ts: TS, changeType: "add", text: "Body line", toolUseId: "tc-write-1" },
    ]);
  });
});
