export type FeedId = string;
export type CardStatus = "to_review_new" | "to_review_updated" | "queued" | "working" | "done";
export type CardKind = "attention" | "feed_improvement";
export type WorkStatus = "queued" | "working" | "completed" | "failed" | "stale" | "cancelled";
export type BlockType =
  | "rich_text"
  | "evidence"
  | "editable_text"
  | "memo"
  | "options"
  | "checklist"
  | "diff"
  | "clarification"
  | "profile"
  | "receipt";

export interface SourceRecipe {
  id: string;
  name: string;
  filename: string;
  checkpointFilename: string;
  summary: string;
}

export interface ThreadBinding {
  homeThreadId: string | null;
  boundAt: string | null;
  heartbeat: {
    status: "not_proposed" | "proposed" | "installed";
    cadence: string | null;
    automationId: string | null;
  };
}

export interface DictationCapability {
  provider: "monologue" | null;
  status: "not_checked" | "not_installed" | "detected_default" | "detected_configured" | "detected_unsupported";
  activationCode: string;
  activationLabel: string;
  source: "fallback" | "monologue_default" | "monologue_settings";
  detectedAt: string | null;
  note: string;
}

export interface FeedConfig {
  id: FeedId;
  name: string;
  purpose: string;
  defaultCleanup: string;
  currentPass: number;
  createdAt: string;
  updatedAt: string;
}

export interface CardBlock {
  id: string;
  type: BlockType;
  label?: string;
  title?: string;
  text?: string;
  value?: string;
  items?: Array<string | { label: string; detail?: string; checked?: boolean }>;
  before?: string;
  after?: string;
  editable?: boolean;
  profile?: {
    name: string;
    subtitle?: string;
    href: string;
    imageUrl: string;
    fallbackImageUrl?: string;
    links?: Array<{ label: string; href: string }>;
  };
}

export interface ProposedAction {
  label: string;
  instruction: string;
  artifactBlockId?: string;
  externalMutation?: boolean;
}

export interface Card {
  id: string;
  feedId: FeedId;
  kind: CardKind;
  status: CardStatus;
  title: string;
  eyebrow: string;
  why: string;
  blocks: CardBlock[];
  proposedAction?: ProposedAction;
  readyForPass: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  history: Array<{ at: string; type: string; detail?: string }>;
}

export interface WorkItem {
  id: string;
  feedId: FeedId;
  cardId: string;
  kind: "instruction" | "execute_approved_action" | "default_cleanup" | "compound_learnings";
  instruction: string;
  status: WorkStatus;
  capabilityToken: string;
  approvalDigest?: string;
  createdAt: string;
  updatedAt: string;
  claimedAt?: string;
  completedAt?: string;
  response?: string;
  error?: string;
}

export interface FeedEvent {
  id: string;
  type: string;
  at: string;
  feedId: FeedId;
  cardId?: string;
  workId?: string;
  detail?: unknown;
}

export interface PolicyRevision {
  id: string;
  feedId: FeedId;
  previous: string;
  next: string;
  reason: string;
  source: "micro_learning" | "compound" | "user_instruction" | "import";
  status: "applied" | "reverted";
  createdAt: string;
  revertedAt?: string;
}

export interface FeedView {
  config: FeedConfig;
  thread: ThreadBinding;
  sources: SourceRecipe[];
  policy: string;
  cards: Card[];
  work: WorkItem[];
  readyNextPass: number;
}

export interface WorkspaceView {
  feeds: Array<{ id: string; name: string; purpose: string }>;
  active: FeedView;
  dictation: DictationCapability;
}
