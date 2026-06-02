import type { WorkItem } from "../src/types";

export interface IdleWorkHandshake {
  status: "idle";
  next: "offer_compound_if_sweep_finished";
  message: string;
  compound: {
    meaning: string;
    ifApproved: string;
    ifApprovedWithSearch: string;
  };
}

export function idleWorkHandshake(feedId: string): IdleWorkHandshake {
  return {
    status: "idle",
    next: "offer_compound_if_sweep_finished",
    message: 'If you completed or refreshed this feed during this turn, ask the user: "Want me to compound what I learned from this sweep?" If this wake began idle, stop quietly rather than repeating the question.',
    compound: {
      meaning: "Review this sweep's cards, feedback, outcomes, and prior policy. Distill an editable feed-policy proposal. Never apply it without user approval.",
      ifApproved: `Run \`pnpm cli -- learning:request --feed ${feedId}\`, drain the resulting compound_learnings job, and return the editable proposal for review.`,
      ifApprovedWithSearch: "Compound first. Recollect only after the reviewed policy proposal is applied, or after the user explicitly says to continue without applying it.",
    },
  };
}

export function formatWorkListOutput(feedId: string, work: WorkItem[]): WorkItem[] | IdleWorkHandshake {
  return work.length > 0 ? work : idleWorkHandshake(feedId);
}

export function formatWorkClaimOutput(feedId: string, work: WorkItem | null): WorkItem | IdleWorkHandshake {
  return work ?? idleWorkHandshake(feedId);
}
