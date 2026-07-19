import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyFeedMessage, FEED_TAB_LABELS, FEED_TABS } from "../src/app/types";
import { CardView } from "../src/feed/CardView";
import { countFor, visibleCards } from "../src/feed/selectors";
import type { Card, FeedView, WorkItemView } from "../shared/types";

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    feedId: "inbox",
    kind: "attention",
    status: "to_review_new",
    title: "Follow up on the review.",
    eyebrow: "Company attention",
    why: "A review request has already been sent.",
    blocks: [],
    readyForPass: 1,
    createdAt: "2026-07-15T08:00:00.000Z",
    updatedAt: "2026-07-15T08:00:00.000Z",
    history: [],
    ...overrides,
  };
}

function feed(cards: Card[], work: WorkItemView[] = []): FeedView {
  return {
    config: {
      id: "inbox",
      name: "Inbox",
      purpose: "Review attention.",
      defaultCleanup: "Archive when done.",
      currentPass: 1,
      createdAt: "2026-07-15T08:00:00.000Z",
      updatedAt: "2026-07-15T08:00:00.000Z",
    },
    thread: {
      homeThreadId: "thread-codex",
      boundAt: "2026-07-15T08:00:00.000Z",
      heartbeat: { status: "not_proposed", cadence: null, automationId: null },
    },
    sources: [],
    policy: "",
    cards,
    runs: [],
    routineActions: [],
    work,
    sweep: { currentBatchId: null, lastFeedbackId: null, recollectionOffered: false, statusMessage: null },
    drain: { status: "idle", consecutiveFailures: 0 },
    readyNextPass: 0,
  };
}

test("orders waiting and blocked between active work and done", () => {
  expect(FEED_TABS).toEqual(["review", "queued", "working", "waiting", "blocked", "done"]);
  expect(FEED_TAB_LABELS.waiting).toBe("Waiting");
  expect(FEED_TAB_LABELS.blocked).toBe("Blocked");
  expect(emptyFeedMessage("waiting")).toBe("Nothing is waiting on another person, event, or date.");
  expect(emptyFeedMessage("blocked")).toBe("No work is blocked right now.");
});

test("routes held cards out of review while active workflow status takes precedence", () => {
  const waiting = card({
    id: "waiting",
    attentionState: {
      kind: "waiting",
      waitingOn: "Zubair",
      resumeWhen: "Zubair replies with validation results.",
      since: "2026-07-15T08:30:00.000Z",
    },
  });
  const blocked = card({
    id: "blocked",
    attentionState: {
      kind: "blocked",
      blocker: "ACP support is unavailable.",
      unblockOwner: "Platform team",
      unblockAction: "Enable ACP and rerun the probe.",
      since: "2026-07-15T08:30:00.000Z",
    },
  });
  const queuedWaiting = card({ ...waiting, id: "queued-waiting" });
  const legacyApprovedBlocked = card({ id: "legacy-approved-blocked", status: "approved_blocked" });
  const queuedWork: WorkItemView = {
    id: "work-queued",
    feedId: "inbox",
    cardId: "queued-waiting",
    status: "queued",
    kind: "instruction",
    instruction: "Continue the approved work.",
    createdAt: "2026-07-15T08:40:00.000Z",
    updatedAt: "2026-07-15T08:40:00.000Z",
  };
  const active = feed([waiting, blocked, queuedWaiting, legacyApprovedBlocked], [queuedWork]);

  expect(visibleCards(active, "review").map((item) => item.id)).toEqual([]);
  expect(visibleCards(active, "queued").map((item) => item.id)).toEqual(["queued-waiting"]);
  expect(visibleCards(active, "waiting").map((item) => item.id)).toEqual(["waiting"]);
  expect(visibleCards(active, "blocked").map((item) => item.id)).toEqual(["blocked", "legacy-approved-blocked"]);
  expect(countFor(active, "waiting")).toBe(1);
  expect(countFor(active, "blocked")).toBe(2);
});

test("counts blocked feed-level work in the Blocked tab", () => {
  const blockedWork: WorkItemView = {
    id: "work-blocked",
    feedId: "inbox",
    cardId: "__feed__",
    status: "blocked",
    kind: "instruction",
    instruction: "Refresh the source.",
    error: "Source credentials are unavailable.",
    createdAt: "2026-07-15T08:40:00.000Z",
    updatedAt: "2026-07-15T08:45:00.000Z",
  };
  const active = feed([], [blockedWork]);

  expect(countFor(active, "blocked")).toBe(1);
});

test("renders waiting metadata without promoting a stale Archive proposal", () => {
  const waiting = card({
    proposedAction: { label: "Archive", instruction: "Archive this item." },
    actions: [
      {
        id: "delegate",
        label: "Delegate stale repo work",
        behavior: "delegate_repo_task",
        instruction: "Implement stale work.",
        execution: { repoKey: "demo", resourceKey: "repo:demo", sourceFingerprint: "stale" },
      },
      { id: "approve", label: "Approve stale action", behavior: "approve_action", instruction: "Execute stale action." },
    ],
    attentionState: {
      kind: "waiting",
      waitingOn: "Oliver",
      resumeWhen: "Oliver replies to the review request.",
      since: "2026-07-15T08:30:00.000Z",
      recheckAt: "2026-07-17T08:30:00.000Z",
      lastCompletedAction: "Sent Oliver the review request on Discord.",
    },
  });

  const html = renderToStaticMarkup(<CardView card={waiting} active={false} onActivate={() => {}} onChanged={() => {}} onAction={() => {}} onReturnToReview={() => {}} />);

  expect(html).toContain("Waiting on");
  expect(html).toContain("Already done");
  expect(html).toContain("Sent Oliver the review request on Discord.");
  expect(html).toContain("Oliver");
  expect(html).toContain("Oliver replies to the review request.");
  expect(html).toContain("Next check");
  expect(html).toContain("Check now");
  expect(html).toContain("Move to review");
  expect(html).not.toContain("Next thing");
  expect(html).not.toContain(">Archive<");
  expect(html).not.toContain("Delegate stale repo work");
  expect(html).not.toContain("Approve stale action");
});

test("renders blocker ownership and exact unblock action", () => {
  const blocked = card({
    attentionState: {
      kind: "blocked",
      blocker: "GitHub credentials are missing.",
      unblockOwner: "Mo",
      unblockAction: "Sign in to GitHub in the in-app browser.",
      since: "2026-07-15T08:30:00.000Z",
      lastVerifiedEvidence: "GitHub returned 401 at 08:29.",
    },
  });

  const html = renderToStaticMarkup(<CardView card={blocked} active={false} onActivate={() => {}} onChanged={() => {}} onAction={() => {}} onReturnToReview={() => {}} canRetryBlocked />);

  expect(html).toContain("Blocked by");
  expect(html).toContain("GitHub credentials are missing.");
  expect(html).toContain("Unblock owner");
  expect(html).toContain("Mo");
  expect(html).toContain("Sign in to GitHub in the in-app browser.");
  expect(html).toContain("Last verified evidence");
  expect(html).toContain("GitHub returned 401 at 08:29.");
  expect(html).not.toContain("Resolve blocker");
  expect(html).toContain("Retry");
  expect(html).toContain("Move to review");
  expect(html).not.toContain("Next thing");
});
