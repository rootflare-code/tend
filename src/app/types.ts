export const FEED_TABS = ["review", "queued", "working", "waiting", "blocked", "done"] as const;
export type Tab = (typeof FEED_TABS)[number];
export const FEED_TAB_LABELS: Record<Exclude<Tab, "queued">, string> = {
  review: "To review",
  working: "Working",
  waiting: "Waiting",
  blocked: "Blocked",
  done: "Done",
};

export function emptyFeedMessage(tab: Tab): string {
  if (tab === "review") return "A quiet feed is allowed. Wake the feed thread when you want Codex to collect or drain pending work.";
  if (tab === "waiting") return "Nothing is waiting on another person, event, or date.";
  if (tab === "blocked") return "No work is blocked right now.";
  return "Move back to To review when you are ready for the next pass.";
}
export type Inspector = "new-feed" | "add-source" | null;
export type AttentionScreen = "feed" | "workspace" | "learnings";
export type WorkspaceTab = "feed" | "global";
