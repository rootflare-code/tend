import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { Card, DictationCapability, FeedConfig, FeedEvent, FeedView, PolicyRevision, SourceRecipe, ThreadBinding, WorkItem, WorkspaceView } from "../src/types";
import {
  BASE_JUDGE_PROMPT,
  COMPOUND_PROMPT,
  COMPOSE_CARD_PROMPT,
  DISTILL_POLICY_PROMPT,
  EXECUTE_WORK_PROMPT,
  GLOBAL_POLICY,
  companyRecipe,
  feedConfig,
  inboxRecipe,
  setupCard,
  threadBinding,
} from "./templates";
import { isoNow, makeId, readJson, writeJson, writeText } from "./util";
import { defaultDictationCapability } from "./monologue";

export const GLOBAL_PROMPT_NAMES = ["judge.md", "compose-card.md", "execute-work.md", "distill-policy.md", "compound.md"] as const;

export class AttentionStore {
  readonly dataDir: string;
  private tail = Promise.resolve();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await this.ensureText("global-policy.md", GLOBAL_POLICY);
    await this.ensureText("prompts/judge.md", BASE_JUDGE_PROMPT);
    await this.ensureText("prompts/compose-card.md", COMPOSE_CARD_PROMPT);
    await this.ensureText("prompts/execute-work.md", EXECUTE_WORK_PROMPT);
    await this.ensureText("prompts/distill-policy.md", DISTILL_POLICY_PROMPT);
    await this.ensureText("prompts/compound.md", COMPOUND_PROMPT);
    const dictationPath = this.path("integrations/dictation.json");
    if (!existsSync(dictationPath)) await writeJson(dictationPath, defaultDictationCapability());
    const workspacePath = this.path("workspace.json");
    if (!existsSync(workspacePath)) await writeJson(workspacePath, { version: 1, feedIds: ["inbox", "company-attention"], createdAt: isoNow() });
    await this.ensureDefaultFeed("inbox");
    await this.ensureDefaultFeed("company-attention");
  }

  path(...parts: string[]): string {
    return path.join(this.dataDir, ...parts);
  }

  feedPath(feedId: string, ...parts: string[]): string {
    return this.path("feeds", feedId, ...parts);
  }

  async readWorkspace(feedId = "inbox"): Promise<WorkspaceView> {
    await this.init();
    const workspace = await readJson<{ feedIds: string[] }>(this.path("workspace.json"));
    const feeds = await Promise.all(workspace.feedIds.map(async (id) => {
      const config = await this.readConfig(id);
      return { id: config.id, name: config.name, purpose: config.purpose };
    }));
    const selected = workspace.feedIds.includes(feedId) ? feedId : workspace.feedIds[0];
    return { feeds, active: await this.readFeed(selected), dictation: await this.readDictationCapability() };
  }

  async readDictationCapability(): Promise<DictationCapability> {
    return readJson<DictationCapability>(this.path("integrations/dictation.json"));
  }

  async writeDictationCapability(capability: DictationCapability): Promise<void> {
    await writeJson(this.path("integrations/dictation.json"), capability);
  }

  async readGlobalPromptWorkspace(): Promise<{ globalPolicy: string; prompts: Array<{ name: string; content: string }> }> {
    return {
      globalPolicy: await readFile(this.path("global-policy.md"), "utf8"),
      prompts: await Promise.all(GLOBAL_PROMPT_NAMES.map(async (name) => ({ name, content: await readFile(this.path("prompts", name), "utf8") }))),
    };
  }

  async writeGlobalPolicy(content: string): Promise<void> {
    await writeText(this.path("global-policy.md"), content);
  }

  async writeGlobalPrompt(name: string, content: string): Promise<void> {
    if (!GLOBAL_PROMPT_NAMES.includes(name as (typeof GLOBAL_PROMPT_NAMES)[number])) throw new Error(`Unknown global prompt: ${name}`);
    await writeText(this.path("prompts", name), content);
  }

  async readFeed(feedId: string): Promise<FeedView> {
    const config = await this.readConfig(feedId);
    const [thread, sources, policy, cards, work] = await Promise.all([
      readJson<ThreadBinding>(this.feedPath(feedId, "thread.json")),
      readJson<SourceRecipe[]>(this.feedPath(feedId, "sources.json")),
      readFile(this.feedPath(feedId, "policy.md"), "utf8"),
      this.readDirectoryJson<Card>(this.feedPath(feedId, "cards")),
      this.readDirectoryJson<WorkItem>(this.feedPath(feedId, "work")),
    ]);
    cards.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    work.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      config,
      thread,
      sources,
      policy,
      cards,
      work,
      readyNextPass: cards.filter((card) => card.status === "to_review_updated" && card.readyForPass > config.currentPass).length,
    };
  }

  async readConfig(feedId: string): Promise<FeedConfig> {
    return readJson<FeedConfig>(this.feedPath(feedId, "feed.json"));
  }

  async writeConfig(config: FeedConfig): Promise<void> {
    config.updatedAt = isoNow();
    await writeJson(this.feedPath(config.id, "feed.json"), config);
  }

  async readCard(feedId: string, cardId: string): Promise<Card> {
    return readJson<Card>(this.feedPath(feedId, "cards", `${cardId}.json`));
  }

  async writeCard(card: Card): Promise<void> {
    card.updatedAt = isoNow();
    await writeJson(this.feedPath(card.feedId, "cards", `${card.id}.json`), card);
  }

  async removeCard(feedId: string, cardId: string): Promise<void> {
    await rm(this.feedPath(feedId, "cards", `${cardId}.json`), { force: true });
  }

  async readWork(feedId: string, workId: string): Promise<WorkItem> {
    return readJson<WorkItem>(this.feedPath(feedId, "work", `${workId}.json`));
  }

  async writeWork(work: WorkItem): Promise<void> {
    work.updatedAt = isoNow();
    await writeJson(this.feedPath(work.feedId, "work", `${work.id}.json`), work);
  }

  async readThread(feedId: string): Promise<ThreadBinding> {
    return readJson<ThreadBinding>(this.feedPath(feedId, "thread.json"));
  }

  async writeThread(feedId: string, thread: ThreadBinding): Promise<void> {
    await writeJson(this.feedPath(feedId, "thread.json"), thread);
  }

  async appendEvent(event: Omit<FeedEvent, "id" | "at">): Promise<FeedEvent> {
    const full = { ...event, id: makeId("evt"), at: isoNow() };
    await mkdir(this.feedPath(event.feedId), { recursive: true });
    await appendFile(this.feedPath(event.feedId, "events.jsonl"), `${JSON.stringify(full)}\n`, "utf8");
    return full;
  }

  async readEvents(feedId: string): Promise<FeedEvent[]> {
    const file = this.feedPath(feedId, "events.jsonl");
    if (!existsSync(file)) return [];
    return (await readFile(file, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as FeedEvent);
  }

  async writePolicy(feedId: string, next: string, reason: string, source: PolicyRevision["source"]): Promise<PolicyRevision> {
    const previous = await readFile(this.feedPath(feedId, "policy.md"), "utf8");
    const revision: PolicyRevision = { id: makeId("policy"), feedId, previous, next, reason, source, status: "applied", createdAt: isoNow() };
    await writeText(this.feedPath(feedId, "policy.md"), next);
    await writeJson(this.feedPath(feedId, "policy-revisions", `${revision.id}.json`), revision);
    await this.appendEvent({ feedId, type: "policy.applied", detail: { revisionId: revision.id, source, reason } });
    return revision;
  }

  async revertPolicy(feedId: string, revisionId: string): Promise<PolicyRevision> {
    const file = this.feedPath(feedId, "policy-revisions", `${revisionId}.json`);
    const revision = await readJson<PolicyRevision>(file);
    if (revision.status !== "applied") throw new Error("Policy revision is not active.");
    revision.status = "reverted";
    revision.revertedAt = isoNow();
    await writeText(this.feedPath(feedId, "policy.md"), revision.previous);
    await writeJson(file, revision);
    await this.appendEvent({ feedId, type: "policy.reverted", detail: { revisionId } });
    return revision;
  }

  async addSource(feedId: string, recipe: SourceRecipe, markdown: string): Promise<void> {
    const file = this.feedPath(feedId, "sources.json");
    const recipes = await readJson<SourceRecipe[]>(file);
    const next = [...recipes.filter((item) => item.id !== recipe.id), recipe];
    await writeJson(file, next);
    await writeText(this.feedPath(feedId, "sources", recipe.filename), markdown);
    const checkpointPath = this.feedPath(feedId, "checkpoints", recipe.checkpointFilename);
    if (!existsSync(checkpointPath)) await writeJson(checkpointPath, { sourceId: recipe.id, updatedAt: null, cursor: null });
    await this.appendEvent({ feedId, type: "source.recipe_added", detail: { sourceId: recipe.id } });
  }

  async removeSource(feedId: string, sourceId: string): Promise<void> {
    const file = this.feedPath(feedId, "sources.json");
    const recipes = await readJson<SourceRecipe[]>(file);
    if (!recipes.some((item) => item.id === sourceId)) throw new Error(`Source recipe not found: ${sourceId}`);
    await writeJson(file, recipes.filter((item) => item.id !== sourceId));
    await this.appendEvent({ feedId, type: "source.recipe_removed", detail: { sourceId } });
  }

  async writeSourceRecipe(feedId: string, sourceId: string, content: string): Promise<void> {
    const recipes = await readJson<SourceRecipe[]>(this.feedPath(feedId, "sources.json"));
    const recipe = recipes.find((item) => item.id === sourceId);
    if (!recipe) throw new Error(`Source recipe not found: ${sourceId}`);
    await writeText(this.feedPath(feedId, "sources", recipe.filename), content);
    await this.appendEvent({ feedId, type: "source.recipe_edited", detail: { sourceId } });
  }

  async writeRawSnapshot(feedId: string, runId: string, sourceId: string, snapshotId: string, value: unknown): Promise<void> {
    const file = this.feedPath(feedId, "raw", runId, sourceId, `${snapshotId}.json`);
    if (existsSync(file)) throw new Error("Raw snapshots are immutable.");
    await writeJson(file, value);
  }

  async writeRun(feedId: string, runId: string, value: unknown): Promise<void> {
    await writeJson(this.feedPath(feedId, "runs", `${runId}.json`), value);
  }

  async createFeed(config: FeedConfig, homeThreadId: string | null = null): Promise<FeedView> {
    return this.serialize(async () => {
      const workspace = await readJson<{ version: number; feedIds: string[]; createdAt: string }>(this.path("workspace.json"));
      if (workspace.feedIds.includes(config.id)) throw new Error(`Feed already exists: ${config.id}`);
      workspace.feedIds.push(config.id);
      await writeJson(this.path("workspace.json"), workspace);
      await writeJson(this.feedPath(config.id, "feed.json"), config);
      await writeText(this.feedPath(config.id, "feed.md"), `# ${config.name}\n\n${config.purpose}\n`);
      await writeText(this.feedPath(config.id, "policy.md"), `# ${config.name} policy\n\n- Start with a high attention bar. Learn from explicit corrections and outcomes.\n`);
      await writeJson(this.feedPath(config.id, "thread.json"), { ...threadBinding(), homeThreadId, boundAt: homeThreadId ? isoNow() : null });
      await writeJson(this.feedPath(config.id, "sources.json"), []);
      await this.appendEvent({ feedId: config.id, type: "feed.created", detail: { homeThreadId } });
      return this.readFeed(config.id);
    });
  }

  async archiveFeed(feedId: string): Promise<void> {
    await this.serialize(async () => {
      if (feedId === "inbox" || feedId === "company-attention") throw new Error("Default feeds cannot be archived.");
      const workspace = await readJson<{ version: number; feedIds: string[]; createdAt: string }>(this.path("workspace.json"));
      if (!workspace.feedIds.includes(feedId)) throw new Error(`Feed not found: ${feedId}`);
      await this.appendEvent({ feedId, type: "feed.archived" });
      workspace.feedIds = workspace.feedIds.filter((id) => id !== feedId);
      await writeJson(this.path("workspace.json"), workspace);
      await mkdir(this.path("archived-feeds"), { recursive: true });
      await rename(this.feedPath(feedId), this.path("archived-feeds", `${feedId}-${Date.now()}`));
    });
  }

  async serialize<T>(callback: () => Promise<T>): Promise<T> {
    const operation = this.tail.then(() => this.withFilesystemLock(callback));
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async withFilesystemLock<T>(callback: () => Promise<T>): Promise<T> {
    const lockPath = this.path(".mutation-lock");
    for (let attempt = 0; attempt < 400; attempt += 1) {
      try {
        await mkdir(lockPath);
        try {
          return await callback();
        } finally {
          await rm(lockPath, { recursive: true, force: true });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
    }
    throw new Error("Timed out waiting for the filesystem mutation lock.");
  }

  private async ensureDefaultFeed(feedId: "inbox" | "company-attention"): Promise<void> {
    if (existsSync(this.feedPath(feedId, "feed.json"))) return;
    const inbox = feedId === "inbox";
    const config = inbox
      ? feedConfig({ id: "inbox", name: "Inbox", purpose: "Turn email into a calm, actionable sweep with exact approval before any external send.", defaultCleanup: "Archive the email thread." })
      : feedConfig({ id: "company-attention", name: "Company Attention", purpose: "Surface a small number of exceptional company signals with enough evidence to decide or act.", defaultCleanup: "Dismiss this card and suppress unchanged repeats." });
    await writeJson(this.feedPath(feedId, "feed.json"), config);
    await writeText(this.feedPath(feedId, "feed.md"), `# ${config.name}\n\n${config.purpose}\n`);
    await writeText(this.feedPath(feedId, "policy.md"), `# ${config.name} policy\n\n- Start with a high attention bar.\n- Preserve provenance and do not pad.\n`);
    await writeJson(this.feedPath(feedId, "thread.json"), threadBinding());
    await writeJson(this.feedPath(feedId, "sources.json"), []);
    const source = inbox ? inboxRecipe() : companyRecipe();
    await this.addSource(feedId, source.recipe, source.markdown);
    await this.writeCard(setupCard(feedId, inbox ? "inbox" : "company"));
  }

  private async ensureText(relativePath: string, value: string): Promise<void> {
    const full = this.path(relativePath);
    if (!existsSync(full)) await writeText(full, value);
  }

  private async readDirectoryJson<T>(directory: string): Promise<T[]> {
    if (!existsSync(directory)) return [];
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json"));
    return Promise.all(files.map((file) => readJson<T>(path.join(directory, file))));
  }
}
