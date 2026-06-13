import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AttentionDomain, mindContextPublicationReceipt } from "../server/domain";
import { createLocalRuntime } from "../server/runtime";
import { AttentionStore } from "../server/store";
import type { MindContextPublicationInput } from "../shared/types";

const roots: string[] = [];

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "attention-mind-test-"));
  roots.push(root);
  const store = new AttentionStore(root);
  await store.init();
  return { root, store, domain: new AttentionDomain(store) };
}

function freshPublication(overrides: Partial<MindContextPublicationInput> = {}): MindContextPublicationInput {
  return {
    id: "mind_2026-06-13T16-50-00Z",
    sourceThreadId: "thread-chronicle",
    state: "fresh",
    publishedAt: "2026-06-13T16:50:00.000Z",
    observedFrom: "2026-06-13T16:35:00.000Z",
    observedTo: "2026-06-13T16:45:00.000Z",
    summary: "Paywall diagnosis is the main active question.",
    signals: [
      {
        id: "paywall",
        kind: "changed_now",
        title: "Paywall diagnosis",
        summary: "The work shifted from deciding whether to pause the experiment to improving the experience.",
        observationIds: ["obs-paywall"],
      },
    ],
    observations: [
      {
        id: "obs-paywall",
        kind: "chronicle_ocr",
        title: "Paywall working session",
        app: "Codex",
        observedFrom: "2026-06-13T16:35:00.000Z",
        observedTo: "2026-06-13T16:45:00.000Z",
        excerpt: "Investigating mobile CTA visibility and lost pricing context.",
        fullText: "Investigating mobile CTA visibility. Bearer secret-token-value should not survive.",
      },
    ],
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("On Your Mind publication", () => {
  test("binds one Chronicle publisher and stores a privacy-filtered fresh update", async () => {
    const { domain } = await setup();
    await domain.bindMindContextPublisher("thread-chronicle");

    const update = await domain.publishMindContext("thread-chronicle", freshPublication({
      summary: "Paywall work for dan@example.com is the main active question.",
      signals: [{
        id: "paywall",
        kind: "changed_now",
        title: "Paywall diagnosis for dan@example.com",
        summary: "The work shifted from deciding whether to pause secret=signal-secret to improving the experience.",
        observationIds: ["obs-paywall"],
      }],
      observations: [{
        id: "obs-paywall",
        kind: "chronicle_ocr",
        title: "Paywall working session for dan@example.com",
        app: "Codex",
        artifact: "/Users/dan/private-note.md",
        observedFrom: "2026-06-13T16:35:00.000Z",
        observedTo: "2026-06-13T16:45:00.000Z",
        excerpt: "Investigating mobile CTA visibility and lost pricing context.",
        fullText: "Investigating mobile CTA visibility. Bearer secret-token-value should not survive.",
      }],
    }));
    const detail = await domain.readMindContextWorkspace(new Date("2026-06-13T17:00:00.000Z"));
    const feedContext = await domain.readMindContextForFeed("company-attention", new Date("2026-06-13T17:00:00.000Z"));

    expect(update.freshUntil).toBe("2026-06-13T19:50:00.000Z");
    expect(detail.health).toBe("fresh");
    expect(detail.current?.observations[0].fullText).toContain("[REDACTED SECRET]");
    expect(detail.current?.observations[0].fullText).not.toContain("secret-token-value");
    expect(detail.current?.summary).toContain("[REDACTED EMAIL]");
    expect(detail.current?.signals[0].title).toContain("[REDACTED EMAIL]");
    expect(detail.current?.signals[0].summary).toContain("[REDACTED SECRET]");
    expect(detail.current?.observations[0].title).toContain("[REDACTED EMAIL]");
    expect(detail.current?.observations[0].artifact).toBe("/Users/[REDACTED]/private-note.md");
    expect(detail.current?.observations[0].redactionCount).toBe(3);
    expect(feedContext.update?.signals[0].id).toBe("paywall");
    expect(feedContext.update?.observations[0]).not.toHaveProperty("fullText");
    expect(feedContext.guidance.research).toContain("independently collected");
    expect(mindContextPublicationReceipt(update)).toEqual({
      id: update.id,
      state: "fresh",
      publishedAt: update.publishedAt,
      freshUntil: update.freshUntil,
      summary: update.summary,
      signalCount: 1,
      sourceCount: 1,
      redactionCount: 3,
      contentDigest: update.contentDigest,
    });
    expect(mindContextPublicationReceipt(update)).not.toHaveProperty("observations");
  });

  test("is idempotent and refuses a different older publication", async () => {
    const { domain } = await setup();
    await domain.bindMindContextPublisher("thread-chronicle");
    const input = freshPublication();

    const first = await domain.publishMindContext("thread-chronicle", input);
    const replay = await domain.publishMindContext("thread-chronicle", input);

    expect(replay.id).toBe(first.id);
    await expect(domain.publishMindContext("thread-chronicle", freshPublication({
      id: "mind_older",
      publishedAt: "2026-06-13T16:40:00.000Z",
      observedFrom: "2026-06-13T16:20:00.000Z",
      observedTo: "2026-06-13T16:30:00.000Z",
      observations: [{
        id: "obs-paywall",
        kind: "chronicle_ocr",
        title: "Earlier paywall working session",
        app: "Codex",
        observedFrom: "2026-06-13T16:20:00.000Z",
        observedTo: "2026-06-13T16:30:00.000Z",
        excerpt: "Earlier paywall work.",
        fullText: "Earlier paywall work.",
      }],
    }))).rejects.toThrow("older than the current publication");
  });

  test("replays an existing health publication after a newer fresh pulse", async () => {
    const { domain } = await setup();
    await domain.bindMindContextPublisher("thread-chronicle");
    await domain.publishMindContext("thread-chronicle", freshPublication());
    const outage: MindContextPublicationInput = {
      id: "mind_unavailable",
      sourceThreadId: "thread-chronicle",
      state: "unavailable",
      publishedAt: "2026-06-13T17:00:00.000Z",
      reason: "Chronicle could not observe a reliable window.",
    };
    const firstOutage = await domain.publishMindContext("thread-chronicle", outage);
    await domain.publishMindContext("thread-chronicle", freshPublication({
      id: "mind_2026-06-13T17-20-00Z",
      publishedAt: "2026-06-13T17:20:00.000Z",
      observedFrom: "2026-06-13T17:05:00.000Z",
      observedTo: "2026-06-13T17:15:00.000Z",
      observations: [{
        id: "obs-paywall",
        kind: "chronicle_ocr",
        title: "Later paywall working session",
        app: "Codex",
        observedFrom: "2026-06-13T17:05:00.000Z",
        observedTo: "2026-06-13T17:15:00.000Z",
        excerpt: "Later paywall work.",
        fullText: "Later paywall work.",
      }],
    }));

    const replay = await domain.publishMindContext("thread-chronicle", outage);

    expect(replay).toEqual(firstOutage);
    expect(replay.lastFreshUpdateId).toBe("mind_2026-06-13T16-50-00Z");
  });

  test("marks expired context stale and preserves the last fresh update after an outage", async () => {
    const { domain } = await setup();
    await domain.bindMindContextPublisher("thread-chronicle");
    await domain.publishMindContext("thread-chronicle", freshPublication());

    const expired = await domain.readMindContextForFeed("inbox", new Date("2026-06-13T20:00:00.000Z"));
    expect(expired.health).toBe("stale");
    expect(expired.update).toBeNull();

    await domain.publishMindContext("thread-chronicle", {
      id: "mind_unavailable",
      sourceThreadId: "thread-chronicle",
      state: "unavailable",
      publishedAt: "2026-06-13T20:05:00.000Z",
      reason: "Chronicle could not observe a reliable window.",
    });
    const workspace = await domain.readMindContextWorkspace(new Date("2026-06-13T20:06:00.000Z"));
    expect(workspace.health).toBe("unavailable");
    expect(workspace.current).toBeNull();
    expect(workspace.lastFresh?.id).toBe("mind_2026-06-13T16-50-00Z");
  });

  test("rejects publications from a thread that does not own the context lane", async () => {
    const { domain } = await setup();
    await domain.bindMindContextPublisher("thread-chronicle");

    await expect(domain.publishMindContext("thread-other", freshPublication())).rejects.toThrow("does not own On Your Mind");
  });

  test("rejects private observation windows that do not support a published signal", async () => {
    const { domain } = await setup();
    await domain.bindMindContextPublisher("thread-chronicle");

    await expect(domain.publishMindContext("thread-chronicle", freshPublication({
      observations: [
        ...freshPublication().observations ?? [],
        {
          id: "unused-window",
          kind: "chronicle_ocr",
          title: "Unrelated private window",
          observedFrom: "2026-06-13T16:35:00.000Z",
          observedTo: "2026-06-13T16:45:00.000Z",
          excerpt: "This should not be retained.",
          fullText: "This should not be retained.",
        },
      ],
    }))).rejects.toThrow("is not referenced by a published signal");
  });

  test("rejects observations on health-only publications instead of silently dropping them", async () => {
    const { domain } = await setup();
    await domain.bindMindContextPublisher("thread-chronicle");

    await expect(domain.publishMindContext("thread-chronicle", {
      id: "mind_unavailable_with_ocr",
      sourceThreadId: "thread-chronicle",
      state: "unavailable",
      publishedAt: "2026-06-13T17:00:00.000Z",
      reason: "Chronicle is unavailable.",
      observations: freshPublication().observations,
    })).rejects.toThrow("may include only a reason");
  });

  test("rejects source links with embedded credentials", async () => {
    const { domain } = await setup();
    await domain.bindMindContextPublisher("thread-chronicle");

    await expect(domain.publishMindContext("thread-chronicle", freshPublication({
      observations: [{
        id: "obs-paywall",
        kind: "source_receipt",
        title: "Unsafe source link",
        observedFrom: "2026-06-13T16:35:00.000Z",
        observedTo: "2026-06-13T16:45:00.000Z",
        excerpt: "A source link should not carry credentials.",
        href: "https://user:password@example.com/private",
      }],
    }))).rejects.toThrow("without embedded credentials");
  });

  test("rejects unsafe update ids before resolving the file mirror path", async () => {
    const { domain } = await setup();

    await expect(domain.readMindContextUpdate("../../workspace")).rejects.toThrow("not file-safe");
  });

  test("migrates file context into SQLite and mirrors later publications", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "attention-mind-runtime-test-"));
    roots.push(root);
    const dataDir = path.join(root, "data");
    const dbPath = path.join(root, "attention.db");
    const fileStore = new AttentionStore(dataDir);
    await fileStore.init();
    const fileDomain = new AttentionDomain(fileStore);
    await fileDomain.bindMindContextPublisher("thread-chronicle");
    await fileDomain.publishMindContext("thread-chronicle", freshPublication());

    const firstRuntime = await createLocalRuntime(dataDir, dbPath);
    try {
      expect((await firstRuntime.sqlite.mindContext().listUpdates()).map((update) => update.id)).toEqual([
        "mind_2026-06-13T16-50-00Z",
      ]);
      const runtimeDomain = new AttentionDomain(firstRuntime.store);
      await runtimeDomain.publishMindContext("thread-chronicle", freshPublication({
        id: "mind_2026-06-13T17-20-00Z",
        publishedAt: "2026-06-13T17:20:00.000Z",
        observedFrom: "2026-06-13T17:05:00.000Z",
        observedTo: "2026-06-13T17:15:00.000Z",
        observations: [{
          id: "obs-paywall",
          kind: "chronicle_ocr",
          title: "Later paywall working session",
          app: "Codex",
          observedFrom: "2026-06-13T17:05:00.000Z",
          observedTo: "2026-06-13T17:15:00.000Z",
          excerpt: "Later paywall work.",
          fullText: "Later paywall work.",
        }],
      }));
      const mirrored = JSON.parse(await readFile(
        path.join(dataDir, "mind-context", "updates", "mind_2026-06-13T17-20-00Z.json"),
        "utf8",
      )) as { id: string };
      expect(mirrored.id).toBe("mind_2026-06-13T17-20-00Z");
    } finally {
      firstRuntime.sqlite.close();
    }

    await writeFile(
      path.join(dataDir, "mind-context", "binding.json"),
      JSON.stringify({ publisherThreadId: "thread-stale-mirror", boundAt: "2026-06-13T10:00:00.000Z" }),
      "utf8",
    );
    const secondRuntime = await createLocalRuntime(dataDir, dbPath);
    try {
      expect((await secondRuntime.store.listMindContextUpdates()).map((update) => update.id)).toEqual([
        "mind_2026-06-13T16-50-00Z",
        "mind_2026-06-13T17-20-00Z",
      ]);
      expect(JSON.parse(await readFile(
        path.join(dataDir, "mind-context", "binding.json"),
        "utf8",
      ))).toMatchObject({ publisherThreadId: "thread-chronicle" });
    } finally {
      secondRuntime.sqlite.close();
    }
  });

  test("expires an unreferenced last fresh pulse after seven days of health-only updates", async () => {
    const { domain } = await setup();
    await domain.bindMindContextPublisher("thread-chronicle");
    const oldFresh = await domain.publishMindContext("thread-chronicle", freshPublication());

    await domain.publishMindContext("thread-chronicle", {
      id: "mind_unavailable_after_retention",
      sourceThreadId: "thread-chronicle",
      state: "unavailable",
      publishedAt: "2026-06-22T17:00:00.000Z",
      reason: "Chronicle is temporarily unavailable.",
    });

    await expect(domain.readMindContextUpdate(oldFresh.id)).rejects.toThrow("not found");
  });

  test("retains an expired pulse while a card still references it", async () => {
    const { domain } = await setup();
    await domain.bindMindContextPublisher("thread-chronicle");
    const referenced = await domain.publishMindContext("thread-chronicle", freshPublication());
    const runId = await domain.recordSourceRun(
      "company-attention",
      "company-attention",
      [{ title: "Current pricing discussion", url: "https://example.com/pricing" }],
      [],
      {},
      undefined,
      { updateId: referenced.id, mode: "lens", signalIds: ["paywall"] },
    );
    await domain.recordSweepBatch("company-attention", [runId], undefined, referenced.id);
    await domain.upsertCard("company-attention", {
      id: "historical-context-card",
      title: "A context-backed pricing decision.",
      why: "The source mattered because of the active paywall diagnosis.",
      sourceRunIds: [runId],
      contextInfluence: {
        updateId: referenced.id,
        signalIds: ["paywall"],
        mode: "lens",
        effect: "selected",
        summary: "Selected because the paywall diagnosis was active.",
      },
      blocks: [{ id: "evidence", type: "evidence", items: [{ label: "Pricing discussion", href: "https://example.com/pricing" }] }],
    });
    await domain.publishMindContext("thread-chronicle", {
      id: "mind_unreferenced_outage",
      sourceThreadId: "thread-chronicle",
      state: "unavailable",
      publishedAt: "2026-06-14T17:00:00.000Z",
      reason: "Temporary outage.",
    });
    await domain.publishMindContext("thread-chronicle", freshPublication({
      id: "mind_2026-06-22T16-50-00Z",
      publishedAt: "2026-06-22T16:50:00.000Z",
      observedFrom: "2026-06-22T16:35:00.000Z",
      observedTo: "2026-06-22T16:45:00.000Z",
      observations: [{
        id: "obs-paywall",
        kind: "chronicle_ocr",
        title: "Later paywall working session",
        app: "Codex",
        observedFrom: "2026-06-22T16:35:00.000Z",
        observedTo: "2026-06-22T16:45:00.000Z",
        excerpt: "Later paywall work.",
        fullText: "Later paywall work.",
      }],
    }));

    expect((await domain.readMindContextUpdate(referenced.id)).id).toBe(referenced.id);
    await expect(domain.readMindContextUpdate("mind_unreferenced_outage")).rejects.toThrow("not found");
  });
});

describe("context-backed feed provenance", () => {
  test("pins lens context to a sweep and validates an influenced card", async () => {
    const { domain } = await setup();
    await domain.bindMindContextPublisher("thread-chronicle");
    const update = await domain.publishMindContext("thread-chronicle", freshPublication());
    const runId = await domain.recordSourceRun(
      "company-attention",
      "company-attention",
      [{ title: "Current pricing discussion", url: "https://example.com/pricing" }],
      [],
      {},
      undefined,
      { updateId: update.id, mode: "lens", signalIds: ["paywall"] },
    );
    await domain.recordSweepBatch("company-attention", [runId], undefined, update.id);

    const card = await domain.upsertCard("company-attention", {
      id: "paywall-signal",
      title: "The current paywall discussion has a decision-ready angle.",
      why: "A current company source now connects directly to the active paywall diagnosis.",
      sourceRunIds: [runId],
      contextInfluence: {
        updateId: update.id,
        signalIds: ["paywall"],
        mode: "lens",
        effect: "selected",
        summary: "Selected because paywall diagnosis is an active decision.",
      },
      blocks: [{ id: "evidence", type: "evidence", items: [{ label: "Pricing discussion", href: "https://example.com/pricing" }] }],
    });

    expect(card.contextInfluence).toMatchObject({ updateId: update.id, sourceCount: 1, mode: "lens" });
  });

  test("requires independently collected evidence for context-originated research", async () => {
    const { domain } = await setup();
    await domain.bindMindContextPublisher("thread-chronicle");
    const update = await domain.publishMindContext("thread-chronicle", freshPublication());
    const runId = await domain.recordSourceRun(
      "company-attention",
      "company-attention",
      [{ title: "Research result", url: "https://example.com/paywall-research" }],
      [],
      {},
      undefined,
      {
        updateId: update.id,
        mode: "research",
        signalIds: ["paywall"],
        researchQuestion: "What evidence-backed paywall improvements fit Every?",
      },
    );
    await domain.recordSweepBatch("company-attention", [runId], undefined, update.id);

    await expect(domain.upsertCard("company-attention", {
      id: "bad-research-card",
      title: "Ideas for the paywall.",
      why: "The topic is currently active.",
      contextInfluence: {
        updateId: update.id,
        signalIds: ["paywall"],
        mode: "research",
        effect: "selected",
        summary: "Prompted by the active paywall work.",
        researchQuestion: "What evidence-backed paywall improvements fit Every?",
      },
      blocks: [{ id: "brief", type: "memo", text: "Ideas without evidence." }],
    })).rejects.toThrow("requires current source evidence");

    const card = await domain.upsertCard("company-attention", {
      id: "good-research-card",
      title: "Three evidence-backed ways to improve the paywall.",
      why: "A bounded research pass found patterns relevant to the current paywall work.",
      sourceRunIds: [runId],
      contextInfluence: {
        updateId: update.id,
        signalIds: ["paywall"],
        mode: "research",
        effect: "selected",
        summary: "Prompted by the active paywall work.",
        researchQuestion: "What evidence-backed paywall improvements fit Every?",
      },
      blocks: [{ id: "evidence", type: "evidence", items: [{ label: "Paywall research", href: "https://example.com/paywall-research" }] }],
    });

    expect(card.contextInfluence?.mode).toBe("research");
  });

  test("allows multiple research runs but only one context-originated question per sweep", async () => {
    const { domain } = await setup();
    await domain.bindMindContextPublisher("thread-chronicle");
    const update = await domain.publishMindContext("thread-chronicle", freshPublication());
    const firstRun = await domain.recordSourceRun(
      "company-attention",
      "company-attention",
      [{ title: "First research result" }],
      [],
      {},
      undefined,
      {
        updateId: update.id,
        mode: "research",
        signalIds: ["paywall"],
        researchQuestion: "What should change in the mobile paywall?",
      },
    );
    const secondRun = await domain.recordSourceRun(
      "company-attention",
      "company-attention",
      [{ title: "Second research result" }],
      [],
      {},
      undefined,
      {
        updateId: update.id,
        mode: "research",
        signalIds: ["paywall"],
        researchQuestion: "Should Every change the offer itself?",
      },
    );

    await expect(domain.recordSweepBatch(
      "company-attention",
      [firstRun, secondRun],
      undefined,
      update.id,
    )).rejects.toThrow("only one On Your Mind research question");
  });
});
