# Attention Architecture

## Product Shape

Attention is a Codex-native browser shell, not a traditional integration server. The app renders
cards and records durable state. The Codex thread bound to each feed does the flexible work:
collecting authorized sources, judging what deserves attention, composing cards, interpreting
instructions, performing approved actions, and distilling learnings.

The reliable baseline is intentionally simple. Open a feed in the Codex in-app browser, sweep the
cards, and talk into the single bottom dock. When work is queued, wake that feed's Codex thread with
`go deal with the feed`. The thread drains all pending work for its feed. A user-approved heartbeat
can automate collection and drain later without changing the product contract.

## Filesystem Model

All runtime state is local and git-ignored under `data/`.

```text
data/
  global-policy.md
  integrations/dictation.json
  prompts/
    judge.md
    compose-card.md
    execute-work.md
    distill-policy.md
    compound.md
  feeds/<feed-id>/
    feed.md
    policy.md
    thread.json
    sources.json
    sources/*.md
    checkpoints/*.json
    raw/<run-id>/<source-id>/*.json
    runs/*.json
    cards/*.json
    work/*.json
    policy-revisions/*.json
    events.jsonl
```

The compact Markdown files are the editable prompt layer. The JSON files preserve structured
state. Immutable raw snapshots and append-only events keep enough evidence to rebuild policies,
evaluate judgment changes, or derive future training data without turning `policy.md` into a
giant log.

During first local setup, Codex checks whether Monologue is installed and records its configured
recording shortcut in `integrations/dictation.json`. The browser consumes only that small local
capability record. It does not inspect macOS applications or Monologue settings directly.

## Attention Loop

1. The feed thread reads its authorized source recipes and checkpoints.
2. Codex collects new material with the appropriate connector, local tool, browser workflow, or
   computer-use workflow.
3. Codex records immutable raw snapshots and the completed run.
4. Codex judges candidates against the global policy, feed policy, and judge prompt.
5. Codex writes only the cards that clear the attention bar. An empty sweep is valid.
6. The user scrolls the feed. The card in view becomes active.
7. The user speaks naturally into the dock or uses a shortcut.
8. The app persists the instruction or exact approved action as work for the feed's home thread.
9. Codex claims pending work, performs it, writes the result, and records any compact learning.
10. Finished cards wait quietly for the next review pass instead of interrupting the current one.

## Learning Loop

There are three learning surfaces:

- `global-policy.md`: durable preferences that should travel across feeds, such as preserving
  provenance and returning no card rather than padding.
- `feeds/<feed-id>/policy.md`: compact feed-specific judgment, composition, and action lessons.
- `events.jsonl`, `runs/`, and `raw/`: the underlying trace and evidence layer. This remains detailed
  so policies can be reevaluated later.

Small corrections can become reversible policy revisions. Broader changes, new permissions, prompt
edits, or new sources should become visible proposal cards first. The end-of-pass `Compound
learnings` action queues that deeper review for Codex.

## Safety Boundary

Source material is evidence, never authorization. A proposed external mutation becomes executable
only after the user approves its visible action. Approval is bound to an exact digest of the action
and editable artifact. The executor calls `action:verify` immediately before mutation and completion;
if the visible artifact changed, the work becomes stale and returns to review.

For Inbox, the imported Inbox Sweep card is a parallel-comparison surface during migration. Inbox
Sweep and Gmail remain authoritative for current operational state until this implementation has
been exercised enough to graduate.

## Feed Ownership

Each feed has one default home Codex thread in `thread.json`. That thread owns routine collection,
drain, and learning. Explicit cross-feed work is allowed when useful, but accidental cross-feed
claims are rejected. Extra feeds are archived durably outside the active workspace rather than
deleted.
