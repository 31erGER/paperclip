import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { feedbackService } from "../services/feedback.js";

afterEach(() => { vi.clearAllMocks(); });

function fixture() {
  const select = vi.fn(() => { throw new Error("disabled exports must not query trace data"); });
  const transaction = vi.fn(() => { throw new Error("disabled sharing must not assemble a feedback envelope"); });
  const uploadTraceBundle = vi.fn();
  const service = feedbackService({ select, transaction } as unknown as Db, { shareClient: { uploadTraceBundle } });
  return { service, select, transaction, uploadTraceBundle };
}

describe("production feedback sharing policy", () => {
  it("rejects requested sharing before opening the vote transaction or assembling context", async () => {
    const f = fixture();
    await expect(f.service.saveIssueVote({ issueId: "private-issue", targetType: "issue_comment", targetId: "private-comment", vote: "up", authorUserId: "private-user", allowSharing: true }))
      .rejects.toMatchObject({ status: 403, details: { code: "external_diagnostics_disabled" } });
    expect(f.transaction).not.toHaveBeenCalled();
    expect(f.uploadTraceBundle).not.toHaveBeenCalled();
  });

  it("keeps a worker with a share client idle without querying stored pending traces", async () => {
    const f = fixture();
    await expect(f.service.hasPendingFeedbackTraces()).resolves.toBe(false);
    await expect(f.service.flushPendingFeedbackTraces()).resolves.toEqual({ attempted: 0, sent: 0, failed: 0 });
    expect(f.select).not.toHaveBeenCalled();
    expect(f.uploadTraceBundle).not.toHaveBeenCalled();
  });

  it("refuses an explicitly requested trace export before reading its saved data", async () => {
    const f = fixture();
    await expect(f.service.flushPendingFeedbackTraces({ traceId: "private-trace" }))
      .rejects.toMatchObject({ status: 403, details: { code: "external_diagnostics_disabled" } });
    expect(f.select).not.toHaveBeenCalled();
    expect(f.uploadTraceBundle).not.toHaveBeenCalled();
  });
});
