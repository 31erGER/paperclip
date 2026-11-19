import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, instanceSettings, issueComments, issues } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { feedbackService } from "../services/feedback.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("local feedback with production diagnostics disabled", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-feedback-local-policy-");
    db = createDb(database.connectionString);
  }, 90000);
  afterAll(async () => { await db?.$client?.end?.({ timeout: 0 }); await database?.cleanup(); });

  it.each(["prompt", "allowed"] as const)("keeps a local vote, downloadable bundle and saved %s preference", async preference => {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), commentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Local feedback", issuePrefix: `L${companyId.replaceAll("-", "").slice(0, 6)}` });
    await db.insert(agents).values({ id: agentId, companyId, name: "Local agent", role: "engineer", adapterType: "codex_local" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Local task", status: "todo", createdByUserId: "local-user" });
    await db.insert(issueComments).values({ id: commentId, companyId, issueId, authorAgentId: agentId, body: "Private local feedback context" });
    await db.insert(instanceSettings).values({ singletonKey: "default", general: { feedbackDataSharingPreference: preference }, experimental: {} })
      .onConflictDoUpdate({ target: instanceSettings.singletonKey, set: { general: { feedbackDataSharingPreference: preference } } });
    const service = feedbackService(db);
    const result = await service.saveIssueVote({ issueId, targetType: "issue_comment", targetId: commentId, vote: "up", authorUserId: "local-user", allowSharing: false });
    expect(result.sharingEnabled).toBe(false);
    expect(result.persistedSharingPreference).toBeNull();
    const [stored] = await db.select().from(instanceSettings);
    expect(stored.general.feedbackDataSharingPreference).toBe(preference);
    const votes = await service.listIssueVotesForUser(issueId, "local-user");
    expect(votes).toHaveLength(1);
    expect(votes[0]).toMatchObject({ vote: "up", sharedWithLabs: false });
    const traces = await service.listFeedbackTraces({ companyId, issueId });
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe("local_only");
    expect(await service.getFeedbackTraceBundle(result.traceId!)).toMatchObject({ companyId, issueId });
    expect(await service.hasPendingFeedbackTraces()).toBe(false);
  });
});
