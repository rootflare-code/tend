import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AttentionDomain } from "../server/domain";
import { attentionHome } from "../server/paths";
import { createLocalRuntime, resolveRuntimeRoot } from "../server/runtime";

describe("runtime resolution", () => {
  test("uses the shared workbench for a canonical source checkout", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "attention-runtime-"));
    const appRoot = path.join(parent, "attention");
    const previous = process.env.ATTENTION_HOME;
    delete process.env.ATTENTION_HOME;
    try {
      await mkdir(path.join(appRoot, ".git"), { recursive: true });
      await mkdir(path.join(appRoot, "bin"), { recursive: true });
      await writeFile(path.join(appRoot, ".git", "HEAD"), "ref: refs/heads/main\n");
      await writeFile(path.join(appRoot, "bin", "tend-live"), "#!/bin/zsh\n");
      expect(resolveRuntimeRoot(appRoot)).toBe(path.join(parent, ".attention-workbench"));
    } finally {
      if (previous === undefined) delete process.env.ATTENTION_HOME;
      else process.env.ATTENTION_HOME = previous;
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("does not attach a feature branch checkout to the shared runtime", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "attention-runtime-"));
    const appRoot = path.join(parent, "attention");
    const previous = process.env.ATTENTION_HOME;
    delete process.env.ATTENTION_HOME;
    try {
      await mkdir(path.join(appRoot, ".git"), { recursive: true });
      await mkdir(path.join(appRoot, "bin"), { recursive: true });
      await writeFile(path.join(appRoot, ".git", "HEAD"), "ref: refs/heads/feat/runtime-test\n");
      await writeFile(path.join(appRoot, "bin", "tend-live"), "#!/bin/zsh\n");
      expect(resolveRuntimeRoot(appRoot)).toBe(attentionHome());
    } finally {
      if (previous === undefined) delete process.env.ATTENTION_HOME;
      else process.env.ATTENTION_HOME = previous;
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("honors an explicit isolated runtime", () => {
    const previous = process.env.ATTENTION_HOME;
    process.env.ATTENTION_HOME = "/tmp/attention-isolated";
    try {
      expect(resolveRuntimeRoot("/tmp/attention-worktree")).toBe("/tmp/attention-isolated");
    } finally {
      if (previous === undefined) delete process.env.ATTENTION_HOME;
      else process.env.ATTENTION_HOME = previous;
    }
  });

  test("migrates feed-scoped primary keys without losing legacy cards", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "attention-runtime-schema-"));
    const dbPath = path.join(root, "attention.db");
    const legacy = new Database(dbPath, { create: true });
    legacy.exec(`
      CREATE TABLE cards (
        id TEXT PRIMARY KEY,
        feed_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        ready_for_pass INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      INSERT INTO cards (
        id, feed_id, kind, status, ready_for_pass, created_at, updated_at, payload_json
      ) VALUES (
        'legacy-card',
        'inbox',
        'attention',
        'to_review_new',
        0,
        '2026-06-13T18:00:00.000Z',
        '2026-06-13T18:00:00.000Z',
        '{"id":"legacy-card","feedId":"inbox"}'
      );
    `);
    legacy.close();

    const runtime = await createLocalRuntime(path.join(root, "data"), dbPath);
    try {
      expect(await runtime.store.hasCard("inbox", "legacy-card")).toBe(true);
      const domain = new AttentionDomain(runtime.store);
      await domain.createFeedFromBrief("Every\nReview Every.", null);
      await domain.upsertCard("inbox", {
        id: "shared-card",
        title: "Inbox card",
        why: "Inbox context.",
        blocks: [{ id: "memo", type: "memo", text: "Inbox." }],
      });
      await domain.upsertCard("every", {
        id: "shared-card",
        title: "Every card",
        why: "Every context.",
        blocks: [{ id: "memo", type: "memo", text: "Every." }],
      });

      expect((await runtime.store.readCard("inbox", "shared-card")).title).toBe("Inbox card");
      expect((await runtime.store.readCard("every", "shared-card")).title).toBe("Every card");

      const feedback = await domain.submitVoiceInstruction(
        "inbox",
        { kind: "card", feedId: "inbox", cardId: "shared-card" },
        "This migrated card still accepts feedback.",
      );
      expect(feedback.work.status).toBe("queued");
      expect((await runtime.store.readCard("inbox", "shared-card")).history).toEqual([
        expect.objectContaining({
          type: "user.scoped_instruction",
          detail: "This migrated card still accepts feedback.",
        }),
      ]);
      const feedbackEventTypes = (await runtime.store.readEvents("inbox"))
        .filter((event) => event.workId === feedback.work.id)
        .map((event) => event.type);
      expect(feedbackEventTypes).toHaveLength(2);
      expect(feedbackEventTypes).toEqual(expect.arrayContaining([
        "voice.intent_queued",
        "voice.instruction_submitted",
      ]));
    } finally {
      runtime.sqlite.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
