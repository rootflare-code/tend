import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type {
  Card,
  CardBlock,
  FeedConfig,
  PolicyRevision,
  ProposedAction,
  RevisionProposal,
  SourceRecipe,
  SweepFeedbackTrace,
  ThreadBinding,
  VoiceTarget,
  WorkItem,
  WorkspaceRevision,
} from "../src/types";
import { AttentionStore, FEED_PROMPT_NAMES } from "./store";
import { demoCards, feedConfig } from "./templates";
import { detectMonologue } from "./monologue";
import { digest, isoNow, makeId, makeToken, slugify, writeJson, writeText } from "./util";

function appendHistory(card: Card, type: string, detail?: string): void {
  card.history.push({ at: isoNow(), type, detail });
}

function actionDigest(card: Card): string {
  const action = card.proposedAction;
  const artifact = action?.artifactBlockId ? card.blocks.find((block) => block.id === action.artifactBlockId) : undefined;
  return digest({ action, artifact });
}

function sourceRecipeFromBrief(brief: string): { recipe: SourceRecipe; markdown: string } {
  const normalizedBrief = brief.replace(/\\n/g, "\n").trim();
  const firstLine = normalizedBrief.split("\n")[0]?.replace(/^#+\s*/, "") || "New source";
  const id = slugify(firstLine);
  const recipe: SourceRecipe = {
    id,
    name: firstLine.slice(0, 80),
    filename: `${id}.md`,
    checkpointFilename: `${id}.json`,
    summary: normalizedBrief,
  };
  return {
    recipe,
    markdown: `---
id: ${id}
kind: codex-recipe
checkpoint: ${id}.json
---
# ${recipe.name}

${normalizedBrief}

Preserve timestamps, locators, and content hashes in immutable local raw snapshots. Advance the
checkpoint only after the run record is durable. Return no candidate rather than padding.
`,
  };
}

const FEEDBACK_STOP_WORDS = new Set(["about", "again", "cards", "have", "more", "that", "these", "they", "this", "those", "want", "with", "would"]);

function feedbackTokens(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 3 && !FEEDBACK_STOP_WORDS.has(word)) ?? [])];
}

function cardSearchText(card: Card): string {
  return JSON.stringify({ title: card.title, why: card.why, blocks: card.blocks }).toLowerCase();
}

function revisionLabel(target: VoiceTarget): string {
  if (target.kind === "feed") return "Feed policy";
  if (target.kind === "source_recipe") return `Source recipe · ${target.sourceId}`;
  if (target.kind === "prompt_layer") return `Feed prompt · ${target.promptId}`;
  if (target.kind === "global_prompt") return `Global prompt · ${target.promptId}`;
  return "Attention policy";
}

function suggestedRevision(previous: string, instruction: string): string {
  return `${previous.trimEnd()}\n\n## Proposed voice learning\n\n- ${instruction.trim()}\n`;
}

export class AttentionDomain {
  constructor(readonly store: AttentionStore) {}

  async detectLocalMonologue(options: { appPath?: string; settingsPath?: string } = {}) {
    const capability = await detectMonologue(options);
    await this.store.serialize(() => this.store.writeDictationCapability(capability));
    return capability;
  }

  async recordVoiceTargetChange(anchorFeedId: string, requested: VoiceTarget): Promise<VoiceTarget> {
    const target = await this.store.validateVoiceTarget(requested);
    await this.store.serialize(() => this.store.appendEvent({ feedId: anchorFeedId, type: "voice.target_changed", detail: { requested, target } }));
    return target;
  }

  async submitVoiceInstruction(anchorFeedId: string, requested: VoiceTarget, instruction: string) {
    if (!instruction.trim()) throw new Error("Instruction is required.");
    const target = await this.store.validateVoiceTarget(requested);
    await this.store.serialize(() => this.store.appendEvent({ feedId: anchorFeedId, type: "voice.instruction_submitted", detail: { target, instruction: instruction.trim() } }));
    if (target.kind === "card") return { kind: "card_work" as const, target, work: await this.queueInstruction(target.feedId, target.cardId, instruction) };
    if (target.kind === "sweep") return { kind: "sweep_feedback" as const, target, trace: await this.applySweepFeedback(target.feedId, instruction, target.runId) };
    return { kind: "revision_proposal" as const, target, proposal: await this.proposeRevision(anchorFeedId, target, instruction) };
  }

  async applySweepFeedback(feedId: string, instruction: string, runId?: string): Promise<SweepFeedbackTrace> {
    if (!instruction.trim()) throw new Error("Sweep feedback is required.");
    return this.store.serialize(async () => {
      const feed = await this.store.readFeed(feedId);
      const visible = feed.cards.filter((card) =>
        (card.status === "to_review_new" || card.status === "to_review_updated") &&
        card.readyForPass <= feed.config.currentPass &&
        !card.sweep?.hidden
      );
      const tokens = feedbackTokens(instruction);
      const ordered = visible
        .map((card, index) => ({
          card,
          index,
          score: tokens.reduce((score, token) => score + (cardSearchText(card).includes(token) ? 1 : 0), 0),
        }))
        .sort((left, right) => right.score - left.score || (left.card.sweep?.rank ?? left.index) - (right.card.sweep?.rank ?? right.index));
      const removeRequested = /\b(too|less|fewer|remove|hide|skip|exclude|only|instead|do not|don't|not interested)\b/i.test(instruction);
      const removed = removeRequested && ordered.length > 1
        ? ordered.slice(-Math.min(ordered.length - 1, Math.max(1, Math.floor(ordered.length / 3)))).map(({ card }) => card.id)
        : [];
      const trace: SweepFeedbackTrace = {
        id: makeId("sweep_feedback"),
        feedId,
        ...(runId ? { runId } : {}),
        instruction: instruction.trim(),
        visibleCardIds: visible.map((card) => card.id),
        orderedCardIds: ordered.map(({ card }) => card.id).filter((cardId) => !removed.includes(cardId)),
        removedCardIds: removed,
        createdAt: isoNow(),
      };
      for (const [rank, { card }] of ordered.entries()) {
        card.sweep = { rank, hidden: removed.includes(card.id), feedbackId: trace.id };
        appendHistory(card, card.sweep.hidden ? "sweep.feedback_hidden" : "sweep.feedback_ranked", trace.id);
        await this.store.writeCard(card);
      }
      await this.store.writeSweepFeedback(trace);
      await this.store.writeSweepState(feedId, {
        currentRunId: runId ?? feed.sweep.currentRunId,
        lastFeedbackId: trace.id,
        recollectionOffered: true,
        statusMessage: removed.length
          ? `${removed.length} card${removed.length === 1 ? "" : "s"} removed`
          : "Cards reranked",
      });
      await this.store.appendEvent({ feedId, type: "sweep.feedback_recorded", detail: { feedbackId: trace.id, runId, instruction: trace.instruction } });
      await this.store.appendEvent({ feedId, type: "sweep.rejudged", detail: { feedbackId: trace.id, orderedCardIds: trace.orderedCardIds, removedCardIds: removed } });
      await this.store.appendEvent({ feedId, type: "sweep.recollection_offered", detail: { feedbackId: trace.id } });
      return trace;
    });
  }

  async requestSweepRecollection(feedId: string): Promise<WorkItem> {
    const sweep = await this.store.readSweepState(feedId);
    if (!sweep.recollectionOffered) throw new Error("Search sources again is not currently offered.");
    const work = await this.queueFeedInstruction(feedId, "Search the configured sources again, record a new collection run, and judge the refreshed sweep.");
    await this.store.serialize(async () => {
      await this.store.writeSweepState(feedId, { ...sweep, recollectionOffered: false, statusMessage: "Source search queued" });
      await this.store.appendEvent({ feedId, workId: work.id, type: "sweep.recollection_requested", detail: { feedbackId: sweep.lastFeedbackId } });
    });
    return work;
  }

  async proposeRevision(anchorFeedId: string, requested: VoiceTarget, instruction: string): Promise<RevisionProposal> {
    if (!instruction.trim()) throw new Error("Revision instruction is required.");
    const target = await this.store.validateVoiceTarget(requested);
    if (target.kind === "card" || target.kind === "sweep") throw new Error("This target routes to work or sweep feedback, not a revision proposal.");
    return this.store.serialize(async () => {
      const previous = await this.store.readTargetContent(target);
      const proposal: RevisionProposal = {
        id: makeId("proposal"),
        anchorFeedId,
        target,
        label: revisionLabel(target),
        instruction: instruction.trim(),
        previous,
        next: suggestedRevision(previous, instruction),
        status: "proposed",
        createdAt: isoNow(),
      };
      await this.store.writeRevisionProposal(proposal);
      await this.store.appendEvent({ feedId: anchorFeedId, type: "revision.proposed", detail: { proposalId: proposal.id, target } });
      return proposal;
    });
  }

  async applyRevisionProposal(proposalId: string): Promise<WorkspaceRevision> {
    return this.store.serialize(async () => {
      const proposal = await this.store.readRevisionProposal(proposalId);
      if (proposal.status !== "proposed") throw new Error("Revision proposal is no longer pending.");
      const current = await this.store.readTargetContent(proposal.target);
      if (current.trimEnd() !== proposal.previous.trimEnd()) throw new Error("Workspace content changed after this proposal. Review a fresh diff.");
      const revision = await this.store.writeWorkspaceRevision(proposal.anchorFeedId, proposal.target, proposal.next, proposal.instruction, "voice_proposal");
      proposal.status = "applied";
      proposal.appliedAt = isoNow();
      proposal.appliedRevisionId = revision.id;
      await this.store.writeRevisionProposal(proposal);
      return revision;
    });
  }

  async updateWorkspaceDocument(anchorFeedId: string, target: VoiceTarget, content: string): Promise<WorkspaceRevision> {
    if (!content.trim()) throw new Error("Workspace content is required.");
    return this.store.serialize(() => this.store.writeWorkspaceRevision(anchorFeedId, target, content, "Edited directly in the workspace.", "manual_edit"));
  }

  async revertWorkspaceRevision(revisionId: string): Promise<WorkspaceRevision> {
    return this.store.serialize(() => this.store.revertWorkspaceRevision(revisionId));
  }

  async bindFeed(feedId: string, homeThreadId: string): Promise<ThreadBinding> {
    if (!homeThreadId.trim()) throw new Error("A home Codex thread ID is required.");
    return this.store.serialize(async () => {
      const thread = await this.store.readThread(feedId);
      thread.homeThreadId = homeThreadId.trim();
      thread.boundAt = isoNow();
      await this.store.writeThread(feedId, thread);
      await this.store.appendEvent({ feedId, type: "thread.bound", detail: { homeThreadId: thread.homeThreadId } });
      return thread;
    });
  }

  async proposeHeartbeat(feedId: string, cadence: string): Promise<ThreadBinding> {
    return this.store.serialize(async () => {
      const thread = await this.store.readThread(feedId);
      thread.heartbeat = { status: "proposed", cadence: cadence.trim(), automationId: null };
      await this.store.writeThread(feedId, thread);
      await this.store.appendEvent({ feedId, type: "heartbeat.proposed", detail: { cadence: cadence.trim() } });
      return thread;
    });
  }

  async recordHeartbeatInstalled(feedId: string, automationId: string): Promise<ThreadBinding> {
    return this.store.serialize(async () => {
      const thread = await this.store.readThread(feedId);
      if (thread.heartbeat.status !== "proposed") throw new Error("Heartbeat must be proposed before installation.");
      thread.heartbeat = { ...thread.heartbeat, status: "installed", automationId: automationId.trim() };
      await this.store.writeThread(feedId, thread);
      await this.store.appendEvent({ feedId, type: "heartbeat.installed", detail: { automationId } });
      return thread;
    });
  }

  async queueInstruction(feedId: string, cardId: string, instruction: string): Promise<WorkItem> {
    if (!instruction.trim()) throw new Error("Instruction is required.");
    return this.store.serialize(async () => {
      const card = await this.store.readCard(feedId, cardId);
      if (card.status === "done") throw new Error("Done cards cannot be queued.");
      const now = isoNow();
      const work: WorkItem = {
        id: makeId("work"),
        feedId,
        cardId,
        kind: "instruction",
        instruction: instruction.trim(),
        status: "queued",
        capabilityToken: makeToken(),
        createdAt: now,
        updatedAt: now,
      };
      card.status = "queued";
      appendHistory(card, "user.instruction", instruction.trim());
      await this.store.writeWork(work);
      await this.store.writeCard(card);
      await this.store.appendEvent({ feedId, cardId, workId: work.id, type: "work.queued", detail: { instruction: work.instruction } });
      return work;
    });
  }

  async queueFeedInstruction(feedId: string, instruction: string): Promise<WorkItem> {
    if (!instruction.trim()) throw new Error("Instruction is required.");
    return this.store.serialize(async () => {
      const now = isoNow();
      const work: WorkItem = {
        id: makeId("work"),
        feedId,
        cardId: "__feed__",
        kind: "instruction",
        instruction: instruction.trim(),
        status: "queued",
        capabilityToken: makeToken(),
        createdAt: now,
        updatedAt: now,
      };
      await this.store.writeWork(work);
      await this.store.appendEvent({ feedId, workId: work.id, type: "feed.instruction_queued", detail: { instruction: work.instruction } });
      return work;
    });
  }

  async approveAction(feedId: string, cardId: string): Promise<WorkItem> {
    return this.store.serialize(async () => {
      const card = await this.store.readCard(feedId, cardId);
      if (!card.proposedAction) throw new Error("Card has no proposed action.");
      if (card.status === "done") throw new Error("Done cards cannot be approved.");
      const now = isoNow();
      const approvalDigest = actionDigest(card);
      const work: WorkItem = {
        id: makeId("work"),
        feedId,
        cardId,
        kind: "execute_approved_action",
        instruction: card.proposedAction.instruction,
        status: "queued",
        capabilityToken: makeToken(),
        approvalDigest,
        createdAt: now,
        updatedAt: now,
      };
      card.status = "queued";
      appendHistory(card, "user.approved_action", approvalDigest);
      await this.store.writeWork(work);
      await this.store.writeCard(card);
      await this.store.appendEvent({ feedId, cardId, workId: work.id, type: "action.approved", detail: { approvalDigest } });
      return work;
    });
  }

  async dismissCard(feedId: string, cardId: string): Promise<WorkItem> {
    return this.store.serialize(async () => {
      const config = await this.store.readConfig(feedId);
      const card = await this.store.readCard(feedId, cardId);
      if (card.status === "done") throw new Error("Done cards cannot be cleaned up again.");
      const now = isoNow();
      const work: WorkItem = {
        id: makeId("work"),
        feedId,
        cardId,
        kind: "default_cleanup",
        instruction: config.defaultCleanup,
        status: "queued",
        capabilityToken: makeToken(),
        createdAt: now,
        updatedAt: now,
      };
      card.status = "queued";
      appendHistory(card, "user.default_cleanup_approved", config.defaultCleanup);
      await this.store.writeWork(work);
      await this.store.writeCard(card);
      await this.store.appendEvent({ feedId, cardId, workId: work.id, type: "cleanup.queued", detail: { cleanup: config.defaultCleanup } });
      return work;
    });
  }

  async undoDismiss(feedId: string, cardId: string): Promise<Card> {
    return this.store.serialize(async () => {
      const feed = await this.store.readFeed(feedId);
      const work = [...feed.work].reverse().find((item) => item.cardId === cardId && item.kind === "default_cleanup" && item.status === "queued");
      if (!work) throw new Error("Queued cleanup is no longer available to undo.");
      work.status = "cancelled";
      const card = await this.store.readCard(feedId, cardId);
      card.status = "to_review_updated";
      card.readyForPass = feed.config.currentPass;
      appendHistory(card, "user.default_cleanup_undone", work.id);
      await this.store.writeWork(work);
      await this.store.writeCard(card);
      await this.store.appendEvent({ feedId, cardId, workId: work.id, type: "cleanup.cancelled" });
      return card;
    });
  }

  async updateBlock(feedId: string, cardId: string, blockId: string, value: string): Promise<Card> {
    return this.store.serialize(async () => {
      const card = await this.store.readCard(feedId, cardId);
      const block = card.blocks.find((item) => item.id === blockId);
      if (!block || !block.editable) throw new Error("Editable card block not found.");
      block.value = value;
      appendHistory(card, "user.edited_artifact", blockId);
      await this.store.writeCard(card);
      await this.store.appendEvent({ feedId, cardId, type: "card.block_edited", detail: { blockId } });
      return card;
    });
  }

  async beginNextPass(feedId: string): Promise<FeedConfig> {
    return this.store.serialize(async () => {
      const config = await this.store.readConfig(feedId);
      config.currentPass += 1;
      await this.store.writeConfig(config);
      await this.store.appendEvent({ feedId, type: "sweep.next_pass", detail: { currentPass: config.currentPass } });
      return config;
    });
  }

  async queueCompound(feedId: string): Promise<WorkItem> {
    return this.store.serialize(async () => {
      const now = isoNow();
      const work: WorkItem = {
        id: makeId("work"),
        feedId,
        cardId: "__feed__",
        kind: "compound_learnings",
        instruction: "Compound the feed learnings. Review raw snapshots, runs, events, outcomes, and policy history. Apply narrow reversible feed-specific improvements and surface structural proposals as review cards.",
        status: "queued",
        capabilityToken: makeToken(),
        createdAt: now,
        updatedAt: now,
      };
      await this.store.writeWork(work);
      await this.store.appendEvent({ feedId, workId: work.id, type: "learning.compound_queued" });
      return work;
    });
  }

  async listPendingWork(feedId: string, threadId: string, explicitCrossFeed = false): Promise<WorkItem[]> {
    await this.assertThread(feedId, threadId, explicitCrossFeed);
    const feed = await this.store.readFeed(feedId);
    return feed.work.filter((work) => work.status === "queued" || work.status === "working");
  }

  async claimWork(feedId: string, threadId: string, explicitCrossFeed = false): Promise<WorkItem | null> {
    await this.assertThread(feedId, threadId, explicitCrossFeed);
    return this.store.serialize(async () => {
      const feed = await this.store.readFeed(feedId);
      const existing = feed.work.find((work) => work.status === "working");
      if (existing) return existing;
      const work = feed.work.find((item) => item.status === "queued");
      if (!work) return null;
      work.status = "working";
      work.claimedAt = isoNow();
      await this.store.writeWork(work);
      if (work.cardId !== "__feed__") {
        const card = await this.store.readCard(feedId, work.cardId);
        card.status = "working";
        appendHistory(card, "codex.claimed", work.id);
        await this.store.writeCard(card);
      }
      await this.store.appendEvent({ feedId, cardId: work.cardId, workId: work.id, type: "work.claimed", detail: { threadId } });
      return work;
    });
  }

  async cancelQueuedWork(feedId: string, workId: string, reason = "Cancelled before Codex started work."): Promise<WorkItem> {
    return this.store.serialize(async () => {
      const work = await this.store.readWork(feedId, workId);
      if (work.status !== "queued") throw new Error("Only queued work can be cancelled before Codex starts.");
      work.status = "cancelled";
      work.error = reason.trim() || "Cancelled before Codex started work.";
      await this.store.writeWork(work);
      if (work.cardId !== "__feed__") {
        const feed = await this.store.readFeed(feedId);
        const card = await this.store.readCard(feedId, work.cardId);
        const hasActiveWork = feed.work.some((item) => item.id !== work.id && item.cardId === work.cardId && (item.status === "queued" || item.status === "working"));
        if (!hasActiveWork) {
          card.status = "to_review_updated";
          card.readyForPass = feed.config.currentPass;
          appendHistory(card, "user.cancelled_queued_work", work.id);
          await this.store.writeCard(card);
        }
      }
      await this.store.appendEvent({ feedId, cardId: work.cardId, workId, type: "work.cancelled", detail: { reason: work.error } });
      return work;
    });
  }

  async completeWork(feedId: string, workId: string, token: string, result: { response: string; blocks?: CardBlock[]; proposedAction?: ProposedAction; done?: boolean }): Promise<WorkItem> {
    return this.store.serialize(async () => {
      const work = await this.store.readWork(feedId, workId);
      if (work.status !== "working") throw new Error("Work item is not currently claimed.");
      if (work.capabilityToken !== token) throw new Error("Invalid scoped work capability token.");
      if (!result.response?.trim()) throw new Error("A work response is required.");
      if (work.cardId !== "__feed__") {
        const card = await this.store.readCard(feedId, work.cardId);
        if (work.approvalDigest && work.approvalDigest !== actionDigest(card)) {
          work.status = "stale";
          work.error = "Approval stale - the proposed action or artifact changed after approval.";
          card.status = "to_review_updated";
          card.readyForPass = (await this.store.readConfig(feedId)).currentPass + 1;
          appendHistory(card, "codex.stale_approval", work.id);
          await this.store.writeWork(work);
          await this.store.writeCard(card);
          await this.store.appendEvent({ feedId, cardId: card.id, workId, type: "action.stale" });
          throw new Error(work.error);
        }
        if (result.blocks) card.blocks = result.blocks;
        if (result.proposedAction) card.proposedAction = result.proposedAction;
        const done = Boolean(result.done || work.kind === "default_cleanup");
        card.status = done ? "done" : "to_review_updated";
        card.completedAt = done ? isoNow() : undefined;
        card.readyForPass = (await this.store.readConfig(feedId)).currentPass + 1;
        appendHistory(card, "codex.completed", result.response.trim());
        await this.store.writeCard(card);
      }
      work.status = "completed";
      work.completedAt = isoNow();
      work.response = result.response.trim();
      await this.store.writeWork(work);
      await this.store.appendEvent({ feedId, cardId: work.cardId, workId, type: "work.completed", detail: { response: work.response } });
      return work;
    });
  }

  async verifyApprovedAction(feedId: string, workId: string, token: string): Promise<{ approvalDigest: string; action: ProposedAction; artifact?: CardBlock }> {
    const work = await this.store.readWork(feedId, workId);
    if (work.status !== "working") throw new Error("Approved action work must be claimed before verification.");
    if (work.kind !== "execute_approved_action" || !work.approvalDigest) throw new Error("Work item is not an approved action.");
    if (work.capabilityToken !== token) throw new Error("Invalid scoped work capability token.");
    const card = await this.store.readCard(feedId, work.cardId);
    if (!card.proposedAction || work.approvalDigest !== actionDigest(card)) throw new Error("Approval stale - reread and return the card for review.");
    return {
      approvalDigest: work.approvalDigest,
      action: card.proposedAction,
      artifact: card.proposedAction.artifactBlockId ? card.blocks.find((block) => block.id === card.proposedAction?.artifactBlockId) : undefined,
    };
  }

  async failWork(feedId: string, workId: string, token: string, error: string): Promise<WorkItem> {
    return this.store.serialize(async () => {
      const work = await this.store.readWork(feedId, workId);
      if (work.status !== "working") throw new Error("Work item is not currently claimed.");
      if (work.capabilityToken !== token) throw new Error("Invalid scoped work capability token.");
      work.status = "failed";
      work.error = error.trim() || "Codex could not complete this work.";
      await this.store.writeWork(work);
      if (work.cardId !== "__feed__") {
        const config = await this.store.readConfig(feedId);
        const card = await this.store.readCard(feedId, work.cardId);
        card.status = "to_review_updated";
        card.readyForPass = config.currentPass + 1;
        appendHistory(card, "codex.failed", work.error);
        await this.store.writeCard(card);
      }
      await this.store.appendEvent({ feedId, cardId: work.cardId, workId, type: "work.failed", detail: { error: work.error } });
      return work;
    });
  }

  async createFeedFromBrief(brief: string, currentThreadId: string | null): Promise<FeedConfig> {
    if (!brief.trim()) throw new Error("Describe the feed you want.");
    const normalizedBrief = brief.replace(/\\n/g, "\n").trim();
    const firstLine = normalizedBrief.split("\n")[0].replace(/^#+\s*/, "");
    const name = firstLine.length <= 60 ? firstLine : firstLine.slice(0, 57).trimEnd() + "...";
    const config = feedConfig({ id: slugify(name), name, purpose: normalizedBrief, defaultCleanup: "Dismiss this card and perform the feed's configured cleanup." });
    await this.store.createFeed(config, currentThreadId);
    const now = isoNow();
    await this.store.writeCard({
      id: "guided-source-setup",
      feedId: config.id,
      kind: "feed_improvement",
      status: "to_review_new",
      eyebrow: "Feed setup",
      title: `Teach ${config.name} where to look.`,
      why: "The feed exists. Codex should now propose the smallest useful source recipe and a heartbeat cadence for review.",
      blocks: [
        { id: "brief", type: "memo", label: "Your brief", text: normalizedBrief },
        { id: "clarify", type: "clarification", label: "Next step", text: "Wake this feed's Codex thread or use the dock. Codex will propose sources in plain English before collecting." },
      ],
      proposedAction: { label: "Propose source recipe", instruction: "Based on this feed brief, propose the smallest useful real source recipe and a heartbeat cadence. Return the proposal for review before collecting." },
      readyForPass: 1,
      createdAt: now,
      updatedAt: now,
      history: [],
    });
    return config;
  }

  async addSourceFromBrief(feedId: string, brief: string): Promise<SourceRecipe> {
    if (!brief.trim()) throw new Error("Describe the source you want to add.");
    const { recipe, markdown } = sourceRecipeFromBrief(brief);
    await this.store.serialize(() => this.store.addSource(feedId, recipe, markdown));
    return recipe;
  }

  async removeSource(feedId: string, sourceId: string): Promise<void> {
    await this.store.serialize(() => this.store.removeSource(feedId, sourceId));
  }

  async updateSourceRecipe(feedId: string, sourceId: string, content: string): Promise<void> {
    if (!content.trim()) throw new Error("Source recipe content is required.");
    await this.store.serialize(() => this.store.writeSourceRecipe(feedId, sourceId, content.trim()));
  }

  async upsertCard(feedId: string, input: Partial<Card> & Pick<Card, "id" | "title" | "why" | "blocks">): Promise<Card> {
    return this.store.serialize(async () => {
      const config = await this.store.readConfig(feedId);
      const now = isoNow();
      const existingPath = this.store.feedPath(feedId, "cards", `${input.id}.json`);
      const existing = existsSync(existingPath) ? await this.store.readCard(feedId, input.id) : null;
      const card: Card = {
        id: input.id,
        feedId,
        kind: input.kind ?? existing?.kind ?? "attention",
        status: input.status ?? existing?.status ?? "to_review_new",
        eyebrow: input.eyebrow ?? existing?.eyebrow ?? config.name,
        title: input.title,
        why: input.why,
        blocks: input.blocks,
        proposedAction: input.proposedAction,
        readyForPass: input.readyForPass ?? existing?.readyForPass ?? config.currentPass,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        completedAt: input.completedAt,
        history: existing?.history ?? [],
      };
      await this.store.writeCard(card);
      await this.store.appendEvent({ feedId, cardId: card.id, type: existing ? "card.updated" : "card.created" });
      return card;
    });
  }

  async createImprovementCard(feedId: string, title: string, brief: string, instruction: string): Promise<Card> {
    const config = await this.store.readConfig(feedId);
    const now = isoNow();
    const card: Card = {
      id: makeId("proposal"),
      feedId,
      kind: "feed_improvement",
      status: "to_review_updated",
      eyebrow: "Feed improvement",
      title: title.trim(),
      why: "Codex found a structural improvement worth reviewing explicitly before it changes the feed.",
      blocks: [{ id: "proposal", type: "memo", label: "Proposal", text: brief.trim() }],
      proposedAction: { label: "Apply this improvement", instruction: instruction.trim() },
      readyForPass: config.currentPass + 1,
      createdAt: now,
      updatedAt: now,
      history: [],
    };
    await this.store.writeCard(card);
    await this.store.appendEvent({ feedId, cardId: card.id, type: "proposal.created" });
    return card;
  }

  async applyPolicyRevision(feedId: string, next: string, reason: string, source: PolicyRevision["source"]): Promise<PolicyRevision> {
    if (!next.trim()) throw new Error("Policy content is required.");
    return this.store.serialize(() => this.store.writePolicy(feedId, next.replace(/\\n/g, "\n").trim(), reason.trim(), source));
  }

  async revertPolicyRevision(feedId: string, revisionId: string): Promise<PolicyRevision> {
    return this.store.serialize(() => this.store.revertPolicy(feedId, revisionId));
  }

  async seedDemo(): Promise<void> {
    for (const feedId of ["inbox", "company-attention"]) {
      for (const card of demoCards(feedId)) {
        if (!existsSync(this.store.feedPath(feedId, "cards", `${card.id}.json`))) await this.store.writeCard(card);
      }
    }
  }

  async clearDemo(): Promise<void> {
    await this.store.serialize(async () => {
      for (const feedId of ["inbox", "company-attention"]) {
        for (const card of demoCards(feedId)) await this.store.removeCard(feedId, card.id);
        await this.store.appendEvent({ feedId, type: "demo.cleared" });
      }
    });
  }

  async archiveFeed(feedId: string): Promise<void> {
    await this.store.archiveFeed(feedId);
  }

  async recordSourceRun(feedId: string, sourceId: string, snapshots: unknown[], judgments: unknown[], checkpoint: unknown): Promise<string> {
    return this.store.serialize(async () => {
      const runId = makeId("run");
      for (const [index, snapshot] of snapshots.entries()) await this.store.writeRawSnapshot(feedId, runId, sourceId, `snapshot-${index + 1}`, snapshot);
      await this.store.writeRun(feedId, runId, { id: runId, feedId, sourceId, snapshots: snapshots.length, judgments, completedAt: isoNow() });
      await writeJson(this.store.feedPath(feedId, "checkpoints", `${sourceId}.json`), checkpoint);
      await this.store.writeSweepState(feedId, { currentRunId: runId, lastFeedbackId: null, recollectionOffered: false, statusMessage: null });
      await this.store.appendEvent({ feedId, type: "source.run_completed", detail: { runId, sourceId, snapshots: snapshots.length, judgments: judgments.length } });
      return runId;
    });
  }

  async inspectHowFeedWorks(feedId: string): Promise<Record<string, unknown>> {
    const feed = await this.store.readFeed(feedId);
    const sources = await Promise.all(feed.sources.map(async (source) => ({
      ...source,
      content: await readFile(this.store.feedPath(feedId, "sources", source.filename), "utf8"),
      checkpoint: await readFile(this.store.feedPath(feedId, "checkpoints", source.checkpointFilename), "utf8"),
    })));
    const prompts = await Promise.all(FEED_PROMPT_NAMES.map(async (name) => ({ name, content: await readFile(this.store.feedPath(feedId, "prompts", name), "utf8") })));
    return { feed: feed.config, thread: feed.thread, policy: feed.policy, sources, prompts };
  }

  async inspectGlobalPromptWorkspace() {
    return this.store.readGlobalPromptWorkspace();
  }

  async updateGlobalPolicy(content: string): Promise<void> {
    if (!content.trim()) throw new Error("Global policy content is required.");
    await this.store.serialize(() => this.store.writeGlobalPolicy(content.replace(/\\n/g, "\n").trim()));
  }

  async updateGlobalPrompt(name: string, content: string): Promise<void> {
    if (!content.trim()) throw new Error("Prompt content is required.");
    await this.store.serialize(() => this.store.writeGlobalPrompt(name, content.replace(/\\n/g, "\n").trim()));
  }

  private async assertThread(feedId: string, threadId: string, explicitCrossFeed: boolean): Promise<void> {
    if (!threadId.trim()) throw new Error("A Codex thread ID is required.");
    const thread = await this.store.readThread(feedId);
    if (!thread.homeThreadId) throw new Error("Feed has no bound home thread.");
    if (thread.homeThreadId !== threadId.trim() && !explicitCrossFeed) throw new Error("This Codex thread does not own the feed. Use explicit cross-feed mode to proceed.");
  }
}
