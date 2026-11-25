import type { Db } from "@paperclipai/db";
import { reconcileSteeredIdentity, storedSteeringAcknowledgement, type RunIdentityContext } from "./run-identity.js";
import { NativeSessionSteeringError, steerNativeSession } from "./native-runtime/native-session-executor.js";
import { canSteerLocalRun, steerLocalRun } from "./local-steering.js"; // fork 31erGER

export function steeringDeliveryIsUncertain(error: unknown, attempted: boolean): boolean {
  return attempted && (!(error instanceof NativeSessionSteeringError) || error.code === "steering_timeout");
}

export async function deliverSteeredMessage(db: Db, input: {
  executor?: Pick<Db, "select">;
  companyId: string;
  runId: string;
  messageId: string;
  message: string;
  identity: RunIdentityContext | null;
  onAcknowledged?: () => Promise<void>;
}) {
  const existing = await storedSteeringAcknowledgement(input.executor ?? db, input.identity ?? {
    companyId: input.companyId, runId: input.runId, messageId: input.messageId,
  });
  if (existing) return existing;

  // fork 31erGER: deliver live mid-turn steering directly to local Pi RPC runs.
  // Never call `reconcileSteeredIdentity(db, ...)` here: callers inside a DB
  // transaction (`withLockedTarget`) already hold a FOR UPDATE lock on `issues`
  // and `acceptAcknowledgement` calls `acceptSteeredIdentity(tx, identity)` on `tx`.
  if (canSteerLocalRun(input.runId)) {
    const result = await steerLocalRun(input.runId, input.message);
    if (!result.ok) {
      throw new NativeSessionSteeringError(
        "steering_temporarily_unavailable",
        result.error ?? "Local Pi session could not accept steering",
      );
    }
    if (input.onAcknowledged) {
      await input.onAcknowledged();
    }
    return { turnId: `pi-rpc:${input.runId}` };
  }

  return await steerNativeSession({
    runId: input.runId, correlationId: input.messageId, message: input.message,
    onAcknowledged: input.onAcknowledged ?? (input.identity ? () => reconcileSteeredIdentity(db, input.identity!) : undefined),
  });
}
