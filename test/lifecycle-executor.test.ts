import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AttentionDomain } from "../server/domain";
import { formatWorkClaimOutput } from "../server/operator";
import { AttentionStore } from "../server/store";
import type { ExecutorReceipt, WorkItem } from "../shared/types";

const roots: string[] = [];

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tend-lifecycle-executor-"));
  roots.push(root);
  const store = new AttentionStore(root);
  await store.init();
  const domain = new AttentionDomain(store);
  await domain.bindFeed("inbox", "operator-thread");
  return { store, domain };
}

async function queueRepoExecution(
  domain: AttentionDomain,
  id = "repo-work",
  feedId = "inbox",
  repoKey = "demo-repo",
  resourceKey = "repo:demo-repo",
) {
  await domain.upsertCard(feedId, {
    id,
    title: "Implement the bounded repo change.",
    why: "Mo approved this material work unit.",
    blocks: [{ id: "context", type: "memo", text: "The owning repository is explicit." }],
    actions: [{
      id: "implement",
      label: "Implement",
      behavior: "delegate_repo_task",
      instruction: "Implement and verify the bounded change.",
      execution: {
        repoKey,
        resourceKey,
        sourceFingerprint: `source-${id}`,
      },
      variant: "primary",
    }],
  });
  return domain.runCardAction(feedId, id, "implement") as Promise<WorkItem>;
}

function receipt(work: WorkItem, outcome: ExecutorReceipt["outcome"] = "completed"): ExecutorReceipt {
  return {
    schemaVersion: "1",
    workId: work.id,
    cardId: work.cardId,
    executorTaskId: "task-1",
    repoKey: "demo-repo",
    outcome,
    summary: "Implemented and verified the bounded change.",
    changedTargets: [{ path: "src/change.ts", reason: "Implemented the approved behavior." }],
    canonicalRecords: [
      { kind: "status", ref: "_status.md", result: "updated" },
      { kind: "session", ref: "SESSION_LOG.md", result: "updated" },
      { kind: "decision", ref: "DECISIONS.md", result: "not_applicable", reason: "No consequential decision changed." },
    ],
    verification: [{ check: "focused tests", result: "passed", evidence: "bun test test/lifecycle-executor.test.ts" }],
    externalEffects: [],
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("attention lifecycle", () => {
  test("holds waiting and blocked cards outside review workflow while rejecting impossible combinations", async () => {
    const { store, domain } = await setup();
    const waiting = await domain.upsertCard("inbox", {
      id: "waiting-zubair",
      title: "Zubair is reviewing the validation matrix.",
      why: "The request has already been sent.",
      blocks: [{ id: "context", type: "memo", text: "No action is available to Mo now." }],
      attentionState: {
        kind: "waiting",
        waitingOn: "Zubair",
        resumeWhen: "Zubair replies with the validation result.",
        since: "2026-07-15T08:00:00.000Z",
        recheckAt: "2026-07-20T08:00:00.000Z",
      },
    });
    expect(waiting.status).toBe("to_review_new");
    expect(waiting.attentionState?.kind).toBe("waiting");

    const blocked = await domain.upsertCard("inbox", {
      id: "blocked-access",
      title: "NotebookLM access is unavailable.",
      why: "Execution cannot continue until sign-in succeeds.",
      blocks: [{ id: "context", type: "memo", text: "This is an operational prerequisite, not a decision." }],
      attentionState: {
        kind: "blocked",
        blocker: "NotebookLM session is signed out.",
        unblockOwner: "Mo",
        unblockAction: "Sign in to NotebookLM.",
        since: "2026-07-15T08:00:00.000Z",
      },
    });
    expect(blocked.attentionState?.kind).toBe("blocked");

    await expect(domain.upsertCard("inbox", {
      id: "invalid-done-waiting",
      status: "done",
      title: "Impossible card.",
      why: "Done cannot still require attention.",
      blocks: [{ id: "context", type: "memo", text: "Invalid." }],
      attentionState: {
        kind: "waiting",
        waitingOn: "Nobody",
        resumeWhen: "Never",
        since: "2026-07-15T08:00:00.000Z",
      },
    })).rejects.toThrow("Done cards cannot have an attention state");
    expect((await store.readCard("inbox", "waiting-zubair")).id).toBe("waiting-zubair");
  });

  test("reopens a due waiting card once and keeps future waits unchanged", async () => {
    const { store, domain } = await setup();
    await domain.upsertCard("inbox", {
      id: "scheduled-review",
      title: "Review the scheduled proposal.",
      why: "The review window opens later.",
      blocks: [{ id: "context", type: "memo", text: "Wait until the scheduled date." }],
      attentionState: {
        kind: "waiting",
        waitingOn: "Scheduled review window",
        resumeWhen: "The review window opens.",
        since: "2026-07-15T08:00:00.000Z",
        recheckAt: "2026-07-16T08:00:00.000Z",
      },
    });
    await domain.upsertCard("inbox", {
      id: "future-review",
      title: "Review later.",
      why: "The future date has not arrived.",
      blocks: [{ id: "context", type: "memo", text: "Still waiting." }],
      attentionState: {
        kind: "waiting",
        waitingOn: "Scheduled review window",
        resumeWhen: "The later review window opens.",
        since: "2026-07-15T08:00:00.000Z",
        recheckAt: "2026-07-30T08:00:00.000Z",
      },
    });
    await domain.upsertCard("inbox", {
      id: "offset-review",
      title: "Review the offset-scheduled proposal.",
      why: "The equivalent UTC review time has arrived.",
      blocks: [{ id: "context", type: "memo", text: "Wait until the offset timestamp is due." }],
      attentionState: {
        kind: "waiting",
        waitingOn: "Scheduled review window",
        resumeWhen: "The offset review window opens.",
        since: "2026-07-15T08:00:00.000Z",
        recheckAt: "2026-07-16T10:00:00+02:00",
      },
    });

    expect(await domain.evaluateAttentionTriggers("inbox", "2026-07-16T08:30:00.000Z")).toEqual(["offset-review", "scheduled-review"]);
    expect((await store.readCard("inbox", "scheduled-review")).attentionState).toBeUndefined();
    expect((await store.readCard("inbox", "scheduled-review")).status).toBe("to_review_updated");
    expect((await store.readCard("inbox", "future-review")).attentionState?.kind).toBe("waiting");
    expect(await domain.evaluateAttentionTriggers("inbox", "2026-07-20T08:00:00.000Z")).toEqual([]);
  });

  test("queues an evidence-only check from a held card and restores the hold if cancelled", async () => {
    const { store, domain } = await setup();
    await domain.upsertCard("inbox", {
      id: "waiting-check",
      title: "Wait for Oliver's review.",
      why: "The request is already sent.",
      blocks: [{ id: "context", type: "memo", text: "No action is needed until Oliver replies." }],
      attentionState: {
        kind: "waiting",
        waitingOn: "Oliver",
        resumeWhen: "Oliver replies with review findings.",
        since: "2026-07-15T08:00:00.000Z",
        lastCompletedAction: "Review request sent to Oliver.",
      },
    });
    const work = await domain.queueAttentionCheck("inbox", "waiting-check");
    expect(work.instruction).toContain("Make no material or external mutation");
    expect((await store.readCard("inbox", "waiting-check")).status).toBe("queued");
    await domain.cancelQueuedWork("inbox", work.id);
    expect((await store.readCard("inbox", "waiting-check")).attentionState).toMatchObject({ kind: "waiting", waitingOn: "Oliver" });
  });
});

describe("repo executor delegation", () => {
  test("clears an unbound reservation on release so a new claim can reserve safely", async () => {
    const { store, domain } = await setup();
    const queued = await queueRepoExecution(domain, "released-reservation");
    const firstClaim = await domain.claimWork("inbox", "operator-thread") as WorkItem;
    await domain.reserveExecutor("inbox", queued.id, firstClaim.capabilityToken, {
      repoKey: "demo-repo",
      resourceKey: "repo:demo-repo",
      sourceFingerprint: "source-released-reservation",
    });

    const released = await domain.releaseWork("inbox", queued.id, firstClaim.capabilityToken);
    expect(released.status).toBe("queued");
    expect(released.executor).toBeUndefined();
    expect((await store.readWork("inbox", queued.id)).executor).toBeUndefined();

    const secondClaim = await domain.claimWork("inbox", "operator-thread") as WorkItem;
    const reservedAgain = await domain.reserveExecutor("inbox", queued.id, secondClaim.capabilityToken, {
      repoKey: "demo-repo",
      resourceKey: "repo:demo-repo",
      sourceFingerprint: "source-released-reservation",
    });
    expect(reservedAgain.executor?.state).toBe("reserved");

    await domain.bindExecutor("inbox", queued.id, secondClaim.capabilityToken, {
      taskId: "task-1",
      projectId: "project-demo",
      cwd: "/Users/mo/repos/demo-repo",
    });
    const bound = await store.readWork("inbox", queued.id);
    await expect(domain.releaseWork("inbox", queued.id, bound.capabilityToken))
      .rejects.toThrow("same executor task must complete or block");
  });

  test("deduplicates repeated approval and rejects a concurrent executor for the same repository resource", async () => {
    const { domain } = await setup();
    await domain.bindFeed("company-attention", "operator-thread-2");
    const first = await queueRepoExecution(domain, "first-repo-work");
    const duplicate = await domain.runCardAction("inbox", "first-repo-work", "implement") as WorkItem;
    expect(duplicate.id).toBe(first.id);
    const firstClaim = await domain.claimWork("inbox", "operator-thread") as WorkItem;
    await domain.reserveExecutor("inbox", first.id, firstClaim.capabilityToken, {
      repoKey: "demo-repo",
      resourceKey: "repo:demo-repo",
      sourceFingerprint: "source-first-repo-work",
    });

    const second = await queueRepoExecution(domain, "second-repo-work", "company-attention", "demo-repo", "repo:demo-repo:other");
    const secondClaim = await domain.claimWork("company-attention", "operator-thread-2") as WorkItem;
    expect(secondClaim.id).toBe(second.id);
    await expect(domain.reserveExecutor("company-attention", second.id, secondClaim.capabilityToken, {
      repoKey: "demo-repo",
      resourceKey: "repo:demo-repo:other",
      sourceFingerprint: "source-second-repo-work",
    })).rejects.toThrow("already owns repository");
  });

  test("preserves action identity and fences reserve, bind, and exact-task claim", async () => {
    const { store, domain } = await setup();
    const queued = await queueRepoExecution(domain);
    expect(queued).toMatchObject({
      kind: "repo_execution",
      cardActionId: "implement",
      repoKey: "demo-repo",
      resourceKey: "repo:demo-repo",
      sourceFingerprint: "source-repo-work",
    });
    expect((await store.readCard("inbox", queued.cardId)).attentionState).toBeUndefined();

    const operatorClaim = await domain.claimWork("inbox", "operator-thread") as WorkItem;
    const guidance = formatWorkClaimOutput("inbox", operatorClaim, { card: await store.readCard("inbox", queued.cardId) }) as any;
    expect(guidance.operatorGuidance.requiredWriteBack).toContain("must not execute");
    expect(guidance.operatorGuidance.completionPrerequisite).toContain("executor receipt");
    const operatorToken = operatorClaim.capabilityToken;
    await domain.reserveExecutor("inbox", queued.id, operatorToken, {
      repoKey: "demo-repo",
      resourceKey: "repo:demo-repo",
      sourceFingerprint: "source-repo-work",
    });
    await domain.bindExecutor("inbox", queued.id, operatorToken, {
      taskId: "task-1",
      projectId: "project-demo",
      cwd: "/Users/mo/repos/demo-repo",
    });

    expect(await domain.claimWork("inbox", "operator-thread")).toBeNull();
    await expect(domain.claimExecutor("inbox", queued.id, "wrong-task")).rejects.toThrow("bound executor task");
    const executorClaim = await domain.claimExecutor("inbox", queued.id, "task-1");
    expect(executorClaim.executor?.state).toBe("claimed");
    expect(executorClaim.claimedBy?.threadId).toBe("task-1");
    await expect(domain.completeWork("inbox", queued.id, operatorToken, { response: "Operator attempted execution.", done: true })).rejects.toThrow("Invalid scoped work capability token");
  });

  test("returns stale source work to review before reserving an executor", async () => {
    const { store, domain } = await setup();
    const oldRun = await domain.recordSourceRun("inbox", "gmail-inbox", [{ id: "old" }], [], { cursor: "old" });
    await domain.recordSweepBatch("inbox", [oldRun]);
    const queued = await queueRepoExecution(domain, "stale-before-dispatch");
    const queuedCard = await store.readCard("inbox", queued.cardId);
    await domain.upsertCard("inbox", {
      ...queuedCard,
      sourceRunIds: [oldRun],
    });
    const operatorClaim = await domain.claimWork("inbox", "operator-thread") as WorkItem;
    const newRun = await domain.recordSourceRun("inbox", "gmail-inbox", [{ id: "new" }], [], { cursor: "new" });
    await domain.recordSweepBatch("inbox", [newRun]);

    await expect(domain.reserveExecutor("inbox", queued.id, operatorClaim.capabilityToken, {
      repoKey: "demo-repo",
      resourceKey: "repo:demo-repo",
      sourceFingerprint: "source-stale-before-dispatch",
    })).rejects.toThrow("source evidence is stale");
    expect((await store.readWork("inbox", queued.id)).status).toBe("stale");
    const returnedCard = await store.readCard("inbox", queued.cardId);
    expect(returnedCard.status).toBe("to_review_updated");
    expect(returnedCard.attentionState).toBeUndefined();
  });

  test("requires canonical records and verification before a repo execution can finish waiting", async () => {
    const { store, domain } = await setup();
    const queued = await queueRepoExecution(domain, "waiting-after-send");
    const operatorClaim = await domain.claimWork("inbox", "operator-thread") as WorkItem;
    await domain.reserveExecutor("inbox", queued.id, operatorClaim.capabilityToken, {
      repoKey: "demo-repo",
      resourceKey: "repo:demo-repo",
      sourceFingerprint: "source-waiting-after-send",
    });
    await domain.bindExecutor("inbox", queued.id, operatorClaim.capabilityToken, {
      taskId: "task-1",
      projectId: "project-demo",
      cwd: "/Users/mo/repos/demo-repo",
    });
    const executor = await domain.claimExecutor("inbox", queued.id, "task-1");

    const invalid = receipt(executor);
    invalid.canonicalRecords = invalid.canonicalRecords.filter((record) => record.kind !== "session");
    await expect(domain.completeWork("inbox", queued.id, executor.capabilityToken, {
      response: "Implemented.",
      receipt: invalid,
    })).rejects.toThrow("session record");

    const invalidTarget = receipt(executor);
    invalidTarget.changedTargets = [{ path: "https://github.com/rootflare-code/demo", reason: "URL is not a changed repo path." }];
    await expect(domain.completeWork("inbox", queued.id, executor.capabilityToken, {
      response: "Implemented.",
      receipt: invalidTarget,
    })).rejects.toThrow("repo-relative logical paths");

    const invalidRecord = receipt(executor);
    invalidRecord.canonicalRecords[0] = { kind: "status", ref: "https://example.com/private", result: "updated" };
    await expect(domain.completeWork("inbox", queued.id, executor.capabilityToken, {
      response: "Implemented.",
      receipt: invalidRecord,
    })).rejects.toThrow("Tend artifact paths, or GitHub URLs");

    const invalidOutcome = receipt(executor) as ExecutorReceipt & { outcome: string };
    invalidOutcome.outcome = "silently_done";
    await expect(domain.completeWork("inbox", queued.id, executor.capabilityToken, {
      response: "Implemented.",
      receipt: invalidOutcome as ExecutorReceipt,
    })).rejects.toThrow("outcome is invalid");

    const failedVerification = receipt(executor);
    failedVerification.verification[0].result = "failed";
    await expect(domain.completeWork("inbox", queued.id, executor.capabilityToken, {
      response: "Implementation did not verify.",
      receipt: failedVerification,
    })).rejects.toThrow("every verification check to pass");

    const valid = receipt(executor, "waiting");
    valid.attentionState = {
      kind: "waiting",
      waitingOn: "Zubair",
      resumeWhen: "Zubair confirms the deployed change.",
      since: "2026-07-15T10:00:00.000Z",
      recheckAt: "2026-07-18T10:00:00.000Z",
    };
    const completed = await domain.completeWork("inbox", queued.id, executor.capabilityToken, {
      response: "Implemented; now awaiting confirmation.",
      receipt: valid,
    });
    expect(completed.status).toBe("completed");
    expect(completed.executorReceipt?.outcome).toBe("waiting");
    const card = await store.readCard("inbox", queued.cardId);
    expect(card.status).toBe("to_review_updated");
    expect(card.attentionState).toMatchObject({ kind: "waiting", waitingOn: "Zubair" });
    const replayed = await domain.completeWork("inbox", queued.id, executor.capabilityToken, {
      response: "Identical terminal receipt replay after a lost response.",
      receipt: valid,
    });
    expect(replayed.id).toBe(completed.id);
    expect(replayed.status).toBe("completed");
  });

  test("blocks generic executor work and retries through the same bound task", async () => {
    const { store, domain } = await setup();
    const queued = await queueRepoExecution(domain, "blocked-executor");
    const operatorClaim = await domain.claimWork("inbox", "operator-thread") as WorkItem;
    await domain.reserveExecutor("inbox", queued.id, operatorClaim.capabilityToken, {
      repoKey: "demo-repo",
      resourceKey: "repo:demo-repo",
      sourceFingerprint: "source-blocked-executor",
    });
    await domain.bindExecutor("inbox", queued.id, operatorClaim.capabilityToken, {
      taskId: "task-1",
      projectId: "project-demo",
      cwd: "/Users/mo/repos/demo-repo",
    });
    const executor = await domain.claimExecutor("inbox", queued.id, "task-1");
    await expect(domain.failWork("inbox", queued.id, executor.capabilityToken, "Executor failed."))
      .rejects.toThrow("structured blocked or failed receipt");
    const blockedReceipt = receipt(executor, "blocked");
    blockedReceipt.blocker = {
      owner: "Mo",
      reason: "Repository credentials are unavailable.",
      unblockAction: "Restore repository credentials.",
    };
    await expect(domain.blockWork("inbox", queued.id, executor.capabilityToken, {
      owner: "Someone else",
      reason: "A different blocker.",
      unblockAction: "Do something different.",
      receipt: blockedReceipt,
    })).rejects.toThrow("must match the executor receipt blocker");
    await domain.blockWork("inbox", queued.id, executor.capabilityToken, {
      owner: "Mo",
      reason: "Repository credentials are unavailable.",
      unblockAction: "Restore repository credentials.",
      receipt: blockedReceipt,
    });
    const replayedBlock = await domain.blockWork("inbox", queued.id, executor.capabilityToken, {
      owner: "Mo",
      reason: "Repository credentials are unavailable.",
      unblockAction: "Restore repository credentials.",
      receipt: blockedReceipt,
    });
    expect(replayedBlock.status).toBe("blocked");
    await expect(domain.queueAttentionCheck("inbox", queued.cardId)).rejects.toThrow("same executor task");

    await domain.bindFeed("company-attention", "operator-thread-2");
    const conflicting = await queueRepoExecution(domain, "blocked-lock-conflict", "company-attention", "demo-repo", "repo:other-resource");
    const conflictingClaim = await domain.claimWork("company-attention", "operator-thread-2") as WorkItem;
    await expect(domain.reserveExecutor("company-attention", conflicting.id, conflictingClaim.capabilityToken, {
      repoKey: "demo-repo",
      resourceKey: "repo:other-resource",
      sourceFingerprint: "source-blocked-lock-conflict",
    })).rejects.toThrow("already owns repository");
    expect((await store.readWork("inbox", queued.id)).status).toBe("blocked");
    expect((await store.readCard("inbox", queued.cardId)).attentionState?.kind).toBe("blocked");

    const retried = await domain.retryWork("inbox", queued.id);
    expect(retried.executor?.taskId).toBe("task-1");
    expect(retried.executor?.state).toBe("bound");
    const reclaimed = await domain.claimExecutor("inbox", queued.id, "task-1");
    expect(reclaimed.claimedBy?.threadId).toBe("task-1");

    const secondBlockedReceipt = receipt(reclaimed, "blocked");
    secondBlockedReceipt.blocker = {
      owner: "Mo",
      reason: "Repository credentials are unavailable again.",
      unblockAction: "Restore repository credentials again.",
    };
    await domain.blockWork("inbox", queued.id, reclaimed.capabilityToken, {
      owner: "Mo",
      reason: "Repository credentials are unavailable again.",
      unblockAction: "Restore repository credentials again.",
      receipt: secondBlockedReceipt,
    });
    await domain.dismissCard("inbox", queued.cardId);
    expect((await store.readWork("inbox", queued.id)).status).toBe("cancelled");
    const admittedAfterDismiss = await domain.reserveExecutor("company-attention", conflicting.id, conflictingClaim.capabilityToken, {
      repoKey: "demo-repo",
      resourceKey: "repo:other-resource",
      sourceFingerprint: "source-blocked-lock-conflict",
    });
    expect(admittedAfterDismiss.executor?.state).toBe("reserved");
  });

  test("retries generic blocked work without using approved-action semantics", async () => {
    const { store, domain } = await setup();
    await domain.upsertCard("inbox", {
      id: "generic-blocked",
      title: "Check the exact local evidence.",
      why: "A local prerequisite may be unavailable.",
      blocks: [{ id: "context", type: "memo", text: "This is evidence-only work." }],
    });
    const queued = await domain.queueInstruction("inbox", "generic-blocked", "Read the exact local evidence only.");
    const claimed = await domain.claimWork("inbox", "operator-thread") as WorkItem;
    await domain.blockWork("inbox", queued.id, claimed.capabilityToken, {
      owner: "Mo",
      reason: "The exact artifact is unavailable.",
      unblockAction: "Restore the exact artifact.",
    });

    const retried = await domain.retryWork("inbox", queued.id);
    expect(retried.status).toBe("queued");
    expect((await store.readCard("inbox", "generic-blocked")).status).toBe("queued");
    expect((await store.readCard("inbox", "generic-blocked")).attentionState).toBeUndefined();
    expect((await domain.claimWork("inbox", "operator-thread") as WorkItem).id).toBe(queued.id);
  });
});
