import type { Tab } from "../app/types";
import type { Card, FeedView, RoutineActionGroup, WorkItemView } from "../types";
export { visibleCardActions } from "../../shared/cardActions";

export function visibleCards(feed: FeedView, tab: Tab): Card[] {
  const pass = feed.config.currentPass;
  if (tab === "review") {
    return feed.cards
      .filter((card) => (card.status === "to_review_new" || card.status === "to_review_updated") && !card.attentionState && card.readyForPass <= pass && !card.sweep?.hidden && !card.routineActionGroupId)
      .sort((left, right) => {
        if (left.sweep?.rank !== undefined || right.sweep?.rank !== undefined) return (left.sweep?.rank ?? Number.MAX_SAFE_INTEGER) - (right.sweep?.rank ?? Number.MAX_SAFE_INTEGER);
        if (left.status !== right.status) return left.status === "to_review_updated" ? -1 : 1;
        return (right.completedAt ?? right.updatedAt).localeCompare(left.completedAt ?? left.updatedAt);
      });
  }
  if (tab === "queued") return feed.cards.filter((card) => activeWorkflowStatus(feed, card) === "queued" && !card.routineActionGroupId);
  if (tab === "working") return feed.cards.filter((card) => activeWorkflowStatus(feed, card) === "working" && !card.routineActionGroupId);
  if (tab === "waiting") return feed.cards.filter((card) => !activeWorkflowStatus(feed, card) && card.attentionState?.kind === "waiting" && !card.routineActionGroupId);
  if (tab === "blocked") return feed.cards.filter((card) => !activeWorkflowStatus(feed, card) && (card.status === "approved_blocked" || card.attentionState?.kind === "blocked") && !card.routineActionGroupId);
  return feed.cards.filter((card) => card.status === "done" && !card.attentionState && !card.routineActionGroupId);
}

export function visibleRoutineActions(feed: FeedView, tab: Tab): RoutineActionGroup[] {
  if (tab === "waiting" || tab === "blocked") return [];
  const status = tab === "review" ? "proposed" : tab === "done" ? "completed" : tab;
  return feed.routineActions.filter((group) => group.status === status);
}

export function visibleFeedWork(feed: FeedView, tab: Tab): WorkItemView[] {
  if (tab === "review" || tab === "waiting") return [];
  if (tab === "blocked") return feed.work.filter((work) => work.cardId === "__feed__" && (work.status === "blocked" || work.status === "approved_blocked"));
  const status = tab === "done" ? "completed" : tab;
  return feed.work.filter((work) => work.cardId === "__feed__" && work.status === status);
}

export function countFor(feed: FeedView, tab: Tab): number {
  return visibleCards(feed, tab).length + visibleRoutineActions(feed, tab).length + visibleFeedWork(feed, tab).length;
}

function activeWorkflowStatus(feed: FeedView, card: Card): "queued" | "working" | undefined {
  if (card.status === "queued" || card.status === "working") return card.status;
  return feed.work
    .filter((work) => work.cardId === card.id && (work.status === "queued" || work.status === "working"))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.status as "queued" | "working" | undefined;
}
