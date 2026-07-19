import type { WorkItem } from "../../shared/types";
import { isoNow, makeId, makeToken } from "../util";

export function queuedWork(
  feedId: string,
  cardId: string,
  instruction: string,
  extra: Pick<WorkItem, "kind"> & Partial<Pick<WorkItem, "assignee" | "target" | "intent" | "feedbackId" | "startingBatchId" | "previousSweepState" | "approvalDigest" | "completionCleanup" | "cardActionId" | "repoKey" | "resourceKey" | "sourceFingerprint" | "previousAttentionState" | "routineActionGroupId" | "sourceMobileCommandId">>,
): WorkItem {
  const now = isoNow();
  return {
    id: makeId("work"),
    feedId,
    cardId,
    instruction: instruction.trim(),
    status: "queued",
    capabilityToken: makeToken(),
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}
