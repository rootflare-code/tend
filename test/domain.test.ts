import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AttentionDomain } from "../server/domain";
import { AttentionStore } from "../server/store";

const roots: string[] = [];

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "attention-test-"));
  roots.push(root);
  const store = new AttentionStore(root);
  await store.init();
  return { root, store, domain: new AttentionDomain(store) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("filesystem workspace", () => {
  test("creates real Inbox and Company defaults with inspectable recipes and setup cards", async () => {
    const { store, domain } = await setup();
    const workspace = await store.readWorkspace();
    expect(workspace.feeds.map((feed) => feed.id)).toEqual(["inbox", "company-attention"]);
    expect(workspace.active.sources[0].id).toBe("gmail-inbox");
    expect(workspace.active.cards[0].id).toBe("inbox-ready-to-collect");
    expect(workspace.dictation.status).toBe("not_checked");
    const company = await domain.inspectHowFeedWorks("company-attention");
    expect((company.sources as Array<{ content: string }>)[0].content).toContain("Return no card rather than padding");
  });

  test("lets Codex detect Monologue and persist its configured recording shortcut", async () => {
    const { root, domain, store } = await setup();
    const appPath = path.join(root, "Monologue.app");
    const settingsPath = path.join(root, "jottle_settings.json");
    await mkdir(appPath);
    await writeFile(settingsPath, JSON.stringify({ hotkey: { modifiers: { modifiers: [{ rightOption: {} }] } } }));
    const capability = await domain.detectLocalMonologue({ appPath, settingsPath });
    expect(capability.status).toBe("detected_configured");
    expect(capability.activationCode).toBe("AltRight");
    expect((await store.readWorkspace()).dictation.activationLabel).toBe("Right Option");
  });

  test("keeps raw snapshots immutable and stores run checkpoints separately", async () => {
    const { root, domain } = await setup();
    const run = await domain.recordSourceRun("inbox", "gmail-inbox", [{ threadId: "gmail-1", subject: "Hello" }], [{ decision: "keep" }], { cursor: "gmail-1" });
    await expect(domain.store.writeRawSnapshot("inbox", run, "gmail-inbox", "snapshot-1", { changed: true })).rejects.toThrow("immutable");
    const checkpoint = JSON.parse(await readFile(path.join(root, "feeds", "inbox", "checkpoints", "gmail-inbox.json"), "utf8"));
    expect(checkpoint.cursor).toBe("gmail-1");
  });

  test("creates a feed and source recipe from plain English", async () => {
    const { root, domain, store } = await setup();
    const feed = await domain.createFeedFromBrief("Model Vibe Check\nNotice meaningful changes in which models are winning for different kinds of work.", "thread-models");
    expect(feed.id).toBe("model-vibe-check");
    expect((await store.readThread(feed.id)).homeThreadId).toBe("thread-models");
    expect((await store.readCard(feed.id, "guided-source-setup")).title).toContain("Teach Model Vibe Check");
    const source = await domain.addSourceFromBrief(feed.id, "Read my recent Chronicle notes about model usage.");
    expect(source.id).toBe("read-my-recent-chronicle-notes-about-model-usage");
    expect(await readFile(path.join(root, "feeds", feed.id, "sources", source.filename), "utf8")).toContain("content hashes");
  });

  test("archives an extra feed without deleting its durable state", async () => {
    const { root, domain, store } = await setup();
    await domain.createFeedFromBrief("Research Watch\nTrack a narrow research topic.", "thread-research");
    await domain.archiveFeed("research-watch");
    expect((await store.readWorkspace()).feeds.some((feed) => feed.id === "research-watch")).toBe(false);
    const [archived] = await readdir(path.join(root, "archived-feeds"));
    expect(await readFile(path.join(root, "archived-feeds", archived, "feed.json"), "utf8")).toContain("Research Watch");
    await expect(domain.archiveFeed("inbox")).rejects.toThrow("Default feeds");
  });

  test("normalizes escaped newlines and removes a source recipe without deleting evidence files", async () => {
    const { root, domain, store } = await setup();
    const source = await domain.addSourceFromBrief("company-attention", "Local pulse artifact\\nRead the current ignored JSON batch.");
    expect(source.id).toBe("local-pulse-artifact");
    await domain.removeSource("company-attention", source.id);
    expect((await store.readFeed("company-attention")).sources.some((item) => item.id === source.id)).toBe(false);
    expect(await readFile(path.join(root, "feeds", "company-attention", "sources", source.filename), "utf8")).toContain("Read the current");
  });

  test("edits feed recipes and allowlisted global prompt files from the workspace", async () => {
    const { root, domain } = await setup();
    await domain.updateSourceRecipe("inbox", "gmail-inbox", "# Gmail inbox\n\nInspect the authoritative inbox carefully.");
    expect(await readFile(path.join(root, "feeds", "inbox", "sources", "gmail-inbox.md"), "utf8")).toContain("authoritative inbox");
    await domain.updateGlobalPolicy("# Global policy\n\n- Keep the bar high.");
    await domain.updateGlobalPrompt("judge.md", "# Judge\n\nKeep only meaningful changes.");
    const workspace = await domain.inspectGlobalPromptWorkspace();
    expect(workspace.globalPolicy).toContain("Keep the bar high");
    expect(workspace.prompts.find((prompt) => prompt.name === "judge.md")?.content).toContain("meaningful changes");
    await expect(domain.updateGlobalPrompt("../feed.md", "Nope")).rejects.toThrow("Unknown global prompt");
  });

  test("lets Codex upsert a structured card without adding server code", async () => {
    const { store, domain } = await setup();
    await domain.upsertCard("company-attention", {
      id: "company-real-signal",
      title: "A real company signal",
      why: "It changes a decision.",
      blocks: [{ id: "brief", type: "memo", label: "Brief", text: "Concrete evidence belongs here." }],
    });
    const card = await store.readCard("company-attention", "company-real-signal");
    expect(card.blocks[0].type).toBe("memo");
    expect(card.status).toBe("to_review_new");
  });

  test("queues a feed-level instruction when an empty feed has no active card", async () => {
    const { domain } = await setup();
    const feed = await domain.createFeedFromBrief("Research Watch\nTrack a narrow research topic.", "thread-research");
    const work = await domain.queueFeedInstruction(feed.id, "Also inspect my saved reading notes.");
    expect(work.cardId).toBe("__feed__");
    expect(work.kind).toBe("instruction");
    expect((await domain.claimWork(feed.id, "thread-research"))?.id).toBe(work.id);
  });
});

describe("thread-owned work drain", () => {
  test("queues, claims, completes, and buffers finished work for the next pass", async () => {
    const { store, domain } = await setup();
    await domain.bindFeed("inbox", "thread-inbox");
    const queued = await domain.queueInstruction("inbox", "inbox-ready-to-collect", "Collect the first real sweep.");
    expect((await store.readCard("inbox", "inbox-ready-to-collect")).status).toBe("queued");
    const claimed = await domain.claimWork("inbox", "thread-inbox");
    expect(claimed?.id).toBe(queued.id);
    expect((await store.readCard("inbox", "inbox-ready-to-collect")).status).toBe("working");
    await domain.completeWork("inbox", queued.id, queued.capabilityToken, { response: "Collection complete." });
    const workspace = await store.readWorkspace("inbox");
    expect(workspace.active.cards.find((card) => card.id === "inbox-ready-to-collect")?.status).toBe("to_review_updated");
    expect(workspace.active.readyNextPass).toBe(1);
    await domain.beginNextPass("inbox");
    expect((await store.readConfig("inbox")).currentPass).toBe(2);
  });

  test("cancels a stray queued instruction before Codex starts and restores the card", async () => {
    const { store, domain } = await setup();
    const queued = await domain.queueInstruction("inbox", "inbox-ready-to-collect", "Stray dictated text.");
    expect((await store.readCard("inbox", "inbox-ready-to-collect")).status).toBe("queued");
    expect((await domain.cancelQueuedWork("inbox", queued.id, "Accidental dictation.")).status).toBe("cancelled");
    expect((await store.readCard("inbox", "inbox-ready-to-collect")).status).toBe("to_review_updated");
    await expect(domain.claimWork("inbox", "thread-inbox")).rejects.toThrow("no bound home thread");
  });

  test("requires the home thread unless cross-feed work is explicit", async () => {
    const { domain } = await setup();
    await domain.bindFeed("company-attention", "thread-company");
    await domain.queueInstruction("company-attention", "company-source-confirmation", "Refine the sources.");
    await expect(domain.claimWork("company-attention", "thread-other")).rejects.toThrow("does not own");
    expect((await domain.claimWork("company-attention", "thread-other", true))?.status).toBe("working");
  });

  test("replays the active claim rather than claiming a second item", async () => {
    const { domain } = await setup();
    await domain.bindFeed("company-attention", "thread-company");
    const first = await domain.queueInstruction("company-attention", "company-source-confirmation", "Inspect source options.");
    await domain.seedDemo();
    await domain.queueInstruction("company-attention", "demo-company-models", "Draft the feed recipe.");
    expect((await domain.claimWork("company-attention", "thread-company"))?.id).toBe(first.id);
    expect((await domain.claimWork("company-attention", "thread-company"))?.id).toBe(first.id);
  });
});

describe("approval, learning, and heartbeat safety", () => {
  test("refuses approved external work when the editable artifact changed", async () => {
    const { store, domain } = await setup();
    await domain.seedDemo();
    await domain.bindFeed("inbox", "thread-inbox");
    const work = await domain.approveAction("inbox", "demo-inbox-partnership");
    await domain.claimWork("inbox", "thread-inbox");
    expect((await domain.verifyApprovedAction("inbox", work.id, work.capabilityToken)).action.label).toBe("Send this reply");
    await domain.updateBlock("inbox", "demo-inbox-partnership", "draft", "A different draft.");
    await expect(domain.verifyApprovedAction("inbox", work.id, work.capabilityToken)).rejects.toThrow("Approval stale");
    await expect(domain.completeWork("inbox", work.id, work.capabilityToken, { response: "Sent." })).rejects.toThrow("Approval stale");
    expect((await store.readWork("inbox", work.id)).status).toBe("stale");
    expect((await store.readCard("inbox", "demo-inbox-partnership")).status).toBe("to_review_updated");
  });

  test("queues default cleanup for Codex and allows a brief undo", async () => {
    const { store, domain } = await setup();
    const cleanup = await domain.dismissCard("inbox", "inbox-ready-to-collect");
    expect(cleanup.kind).toBe("default_cleanup");
    expect((await store.readCard("inbox", "inbox-ready-to-collect")).status).toBe("queued");
    await domain.undoDismiss("inbox", "inbox-ready-to-collect");
    expect((await store.readWork("inbox", cleanup.id)).status).toBe("cancelled");
    expect((await store.readCard("inbox", "inbox-ready-to-collect")).status).toBe("to_review_updated");
    await domain.bindFeed("inbox", "thread-inbox");
    const secondCleanup = await domain.dismissCard("inbox", "inbox-ready-to-collect");
    await domain.claimWork("inbox", "thread-inbox");
    await domain.completeWork("inbox", secondCleanup.id, secondCleanup.capabilityToken, { response: "Archived the authoritative email thread." });
    expect((await store.readCard("inbox", "inbox-ready-to-collect")).status).toBe("done");
  });

  test("clears visual QA demo cards without touching setup cards", async () => {
    const { store, domain } = await setup();
    await domain.seedDemo();
    await domain.clearDemo();
    expect((await store.readFeed("inbox")).cards.map((card) => card.id)).toEqual(["inbox-ready-to-collect"]);
    expect((await store.readFeed("company-attention")).cards.map((card) => card.id)).toEqual(["company-source-confirmation"]);
  });

  test("applies and reverts compact policy revisions", async () => {
    const { store, domain } = await setup();
    const original = (await store.readFeed("inbox")).policy;
    const revision = await domain.applyPolicyRevision("inbox", "# Inbox policy\n\n- Prefer replies only when an answer is actually required.", "Learned from a corrected card.", "micro_learning");
    expect((await store.readFeed("inbox")).policy).toContain("actually required");
    await store.revertPolicy("inbox", revision.id);
    expect((await store.readFeed("inbox")).policy).toBe(original);
  });

  test("records a proposed heartbeat before installation", async () => {
    const { domain } = await setup();
    await expect(domain.recordHeartbeatInstalled("inbox", "auto-1")).rejects.toThrow("proposed");
    expect((await domain.proposeHeartbeat("inbox", "Every 30 minutes on weekdays")).heartbeat.status).toBe("proposed");
    expect((await domain.recordHeartbeatInstalled("inbox", "auto-1")).heartbeat.status).toBe("installed");
  });

  test("preserves a thread binding when heartbeat setup happens concurrently", async () => {
    const { root, store, domain } = await setup();
    const secondProcessDomain = new AttentionDomain(new AttentionStore(root));
    await Promise.all([
      domain.bindFeed("inbox", "thread-inbox"),
      secondProcessDomain.proposeHeartbeat("inbox", "Every 30 minutes"),
    ]);
    const thread = await store.readThread("inbox");
    expect(thread.homeThreadId).toBe("thread-inbox");
    expect(thread.heartbeat.status).toBe("proposed");
  });
});
