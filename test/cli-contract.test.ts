import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runTendCli } from "../server/cli";
import { AttentionDomain } from "../server/domain";
import { createLocalRuntime } from "../server/runtime";
import { CLI_COMMANDS, INTERNAL_CLI_COMMANDS, cliCommandName } from "../server/cli/contract";
import { MissingFlagError, formatCliError } from "../server/cli/errors";
import { assertCliRuntimeMatchesLive } from "../server/cli/runtimeGuard";
import { setupChroniclePrompt, setupCodexPrompt } from "../server/cli/setup";

describe("CLI contract", () => {
  test("keeps public help focused on the v0 agent surface", () => {
    const commandNames = new Set(CLI_COMMANDS.map(cliCommandName));

    expect(commandNames).toContain("feed:bind");
    expect(commandNames).toContain("context:bind");
    expect(commandNames).toContain("context:publish");
    expect(commandNames).toContain("context:status");
    expect(commandNames).toContain("context:for-feed");
    expect(commandNames).toContain("agent:presence");
    expect(commandNames).toContain("work:list");
    expect(commandNames).toContain("work:claim");
    expect(commandNames).toContain("work:assign");
    expect(commandNames).toContain("feed:drain-agent");
    expect(commandNames).toContain("action:verify");
    expect(commandNames).toContain("work:complete");
    expect(commandNames).toContain("work:executor-reserve");
    expect(commandNames).toContain("work:executor-bind");
    expect(commandNames).toContain("work:executor-claim");
    expect(commandNames).toContain("card:evaluate-triggers");
    expect(commandNames).toContain("work:reconcile-approved");
    expect(commandNames).toContain("source:record-run");
    expect(commandNames).toContain("card:upsert");
    expect(commandNames).toContain("card:dismiss");
    expect(commandNames).toContain("card:cleanup-source");
    expect(commandNames).toContain("card:undo-cleanup-source");
    expect(commandNames).not.toContain("card:dismiss-local");
    expect(commandNames).not.toContain("card:undo-dismiss");
    expect(commandNames).toContain("learning:request");

    for (const command of INTERNAL_CLI_COMMANDS) {
      expect(commandNames).not.toContain(cliCommandName(command));
    }
  });

  test("documents only implemented public commands", async () => {
    const contract = await readFile("docs/AGENT_CONTRACT.md", "utf8");
    const documented = [...contract.matchAll(/`tend cli ([^`\s]+)/g)].map((match) => match[1]);
    const commandNames = new Set(CLI_COMMANDS.map(cliCommandName));

    expect(documented.length).toBeGreaterThan(10);
    for (const command of documented) expect(commandNames).toContain(command);
  });

  test("formats command-owned usage hints for missing flags", () => {
    const error = formatCliError(new MissingFlagError("work:claim", "thread"));

    expect(error).toEqual({
      ok: false,
      error: "Missing --thread",
      code: "missing_flag",
      hint: "Usage: tend cli work:claim --feed <id> --thread <id> [--cross-feed] [--session <id>]",
    });
    expect(CLI_COMMANDS.find((command) => command.startsWith("feed:bind "))).toContain("--agent claude [--replace]");
  });

  test("prints a self-contained Codex setup prompt for binary installs", () => {
    const prompt = setupCodexPrompt({
      binaryPath: "/tmp/tend install/tend",
      skillPath: "/tmp/tend install/docs/SKILL.md",
      attentionHome: "/tmp/tend home",
      feedId: "model-watch",
    });

    expect(prompt).toContain("Tend is Codex-native.");
    expect(prompt).toContain('This prompt connects the current thread to "model-watch"');
    expect(prompt).toContain("Local Tend entry point: /tmp/tend install/tend");
    expect(prompt).toContain("Skill/reference: /tmp/tend install/docs/SKILL.md");
    expect(prompt).toContain("CLI prefix: ATTENTION_HOME='/tmp/tend home' '/tmp/tend install/tend'");
    expect(prompt).toContain("Use the local Tend CLI contract, not a hosted Tend or MCP setup.");
    expect(prompt).toContain("Do setup sequentially: bind first and wait for it to finish, then propose/install the heartbeat.");
    expect(prompt).toContain("ATTENTION_HOME='/tmp/tend home' '/tmp/tend install/tend' cli feed:bind --feed model-watch --thread <current-codex-thread-id>");
    expect(prompt).toContain('says "go deal with the feed"');
  });

  test("prints a self-contained Chronicle Pulse setup prompt", () => {
    const prompt = setupChroniclePrompt({
      binaryPath: "/tmp/tend install/tend",
      skillPath: "/tmp/tend install/docs/SKILL.md",
      attentionHome: "/tmp/tend home",
    });

    expect(prompt).toContain("one dedicated Chronicle Pulse thread for the entire Tend workspace");
    expect(prompt).toContain("Tend does not capture the screen itself.");
    expect(prompt).toContain("Agent contract: /tmp/tend install/docs/AGENT_CONTRACT.md");
    expect(prompt).toContain("Security reference: /tmp/tend install/docs/SECURITY.md");
    expect(prompt).toContain("ATTENTION_HOME='/tmp/tend home' '/tmp/tend install/tend' cli context:bind --thread <current-codex-thread-id>");
    expect(prompt).toContain("refreshes the pulse every two hours");
    expect(prompt).toContain("one coherent window of ten minutes or less");
    expect(prompt).toContain("cli context:publish --thread <current-codex-thread-id> --context-file <local-json-file>");
    expect(prompt).toContain('says "refresh the pulse"');
  });

  test("keeps agent commands under the explicit cli namespace", async () => {
    await expect(runTendCli(["work:list", "--feed", "inbox", "--thread", "thread"]))
      .rejects.toThrow('Unknown Tend command "work:list". Run tend help.');
  });

  test("refuses an implicit CLI runtime that differs from the running service", async () => {
    const mismatch = assertCliRuntimeMatchesLive("card:upsert", "/tmp/quiet-runtime", {
      fetchStatus: async () => ({ dataDir: "/tmp/live-runtime/data" }),
    });
    await expect(mismatch).rejects.toMatchObject({
      code: "runtime_mismatch",
      hint: "Run the CLI from the canonical checkout or set ATTENTION_HOME explicitly for isolated validation.",
    });

    await expect(assertCliRuntimeMatchesLive("card:upsert", "/tmp/quiet-runtime", {
      explicitRuntime: true,
      fetchStatus: async () => ({ dataDir: "/tmp/live-runtime/data" }),
    })).resolves.toBeUndefined();
  });

  test("executes the renamed local-dismiss and source-cleanup commands end to end", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "tend-cli-disposition-"));
    const run = async (args: string[]) => {
      const subprocess = Bun.spawn({
        cmd: [process.execPath, "tend.ts", "cli", ...args],
        cwd: process.cwd(),
        env: { ...process.env, ATTENTION_HOME: home },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(subprocess.stdout).text(),
        new Response(subprocess.stderr).text(),
        subprocess.exited,
      ]);
      if (exitCode !== 0) throw new Error(stderr || `CLI exited ${exitCode}`);
      return JSON.parse(stdout);
    };

    try {
      const card = {
        id: "cli-disposition",
        title: "Choose the disposition.",
        why: "The CLI must distinguish local dismissal from source cleanup.",
        blocks: [{ id: "memo", type: "memo", text: "Routine notice." }],
      };
      await run(["card:upsert", "--feed", "inbox", "--card", JSON.stringify(card)]);

      const dismissed = await run(["card:dismiss", "--feed", "inbox", "--card", card.id]);
      expect(dismissed).toMatchObject({ status: "done", completionDisposition: "dismissed" });

      await run(["card:return-to-review", "--feed", "inbox", "--card", card.id]);
      await run([
        "card:upsert",
        "--feed",
        "inbox",
        "--card",
        JSON.stringify({ ...card, actions: [{ id: "archive-source", label: "Archive", behavior: "default_cleanup" }] }),
      ]);
      const cleanup = await run(["card:cleanup-source", "--feed", "inbox", "--card", card.id]);
      expect(cleanup).toMatchObject({ kind: "default_cleanup", status: "queued" });
      expect(cleanup.approvalDigest).toBeTruthy();

      const restored = await run(["card:undo-cleanup-source", "--feed", "inbox", "--card", card.id]);
      expect(restored).toMatchObject({ status: "to_review_updated" });
      expect(restored.completionDisposition).toBeUndefined();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("executes the repo executor CLI protocol end to end", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "tend-cli-executor-"));
    const run = async (args: string[]) => {
      const subprocess = Bun.spawn({
        cmd: [process.execPath, "tend.ts", "cli", ...args],
        cwd: process.cwd(),
        env: { ...process.env, ATTENTION_HOME: home },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(subprocess.stdout).text(),
        new Response(subprocess.stderr).text(),
        subprocess.exited,
      ]);
      if (exitCode !== 0) throw new Error(stderr || `CLI exited ${exitCode}`);
      return JSON.parse(stdout);
    };

    try {
      const runtime = await createLocalRuntime(path.join(home, "data"), path.join(home, "attention.db"));
      const domain = new AttentionDomain(runtime.store);
      await domain.bindFeed("inbox", "operator-thread");
      await domain.upsertCard("inbox", {
        id: "cli-repo-executor",
        title: "Implement the bounded CLI canary.",
        why: "The CLI protocol needs executable coverage.",
        blocks: [{ id: "context", type: "memo", text: "The exact repo target is reviewed." }],
        actions: [{
          id: "delegate",
          label: "Delegate",
          behavior: "delegate_repo_task",
          instruction: "Implement and verify the bounded CLI canary.",
          execution: { repoKey: "demo-repo", resourceKey: "repo:demo-repo", sourceFingerprint: "cli-source" },
        }],
      });
      const queued = await domain.runCardAction("inbox", "cli-repo-executor", "delegate") as any;
      await domain.upsertCard("inbox", {
        id: "cli-blocked-executor",
        title: "Exercise the blocked receipt path.",
        why: "The CLI must accept a bare schema-v1 executor receipt.",
        blocks: [{ id: "context", type: "memo", text: "This is a bounded protocol test." }],
        actions: [{
          id: "delegate",
          label: "Delegate",
          behavior: "delegate_repo_task",
          instruction: "Attempt the bounded blocker canary.",
          execution: { repoKey: "blocked-repo", resourceKey: "repo:blocked-repo", sourceFingerprint: "blocked-source" },
        }],
      });
      const blockedQueued = await domain.runCardAction("inbox", "cli-blocked-executor", "delegate") as any;
      runtime.sqlite.close();

      const operator = await run(["work:claim", "--feed", "inbox", "--thread", "operator-thread"]);
      expect(operator.id).toBe(queued.id);
      await run([
        "work:executor-reserve", "--feed", "inbox", "--work", queued.id, "--token", operator.capabilityToken,
        "--repo", "demo-repo", "--resource", "repo:demo-repo", "--source-fingerprint", "cli-source",
      ]);
      const bound = await run([
        "work:executor-bind", "--feed", "inbox", "--work", queued.id, "--token", operator.capabilityToken,
        "--task", "executor-task", "--project", "project-demo", "--cwd", "/tmp/demo-repo",
      ]);
      expect(bound.executor).toMatchObject({ state: "bound", taskId: "executor-task" });
      const executor = await run(["work:executor-claim", "--feed", "inbox", "--work", queued.id, "--task", "executor-task"]);
      const receipt = {
        schemaVersion: "1",
        workId: queued.id,
        cardId: "cli-repo-executor",
        executorTaskId: "executor-task",
        repoKey: "demo-repo",
        outcome: "completed",
        summary: "Implemented and verified the CLI canary.",
        changedTargets: [{ path: "working/cli-canary.md", reason: "Recorded the bounded canary." }],
        canonicalRecords: [
          { kind: "session", ref: "SESSION_LOG.md", result: "updated" },
          { kind: "status", ref: "_status.md", result: "not_applicable", reason: "No project state changed." },
        ],
        verification: [{ check: "canary", result: "passed", evidence: "Exact target read back." }],
        externalEffects: [],
      };
      const resultFile = path.join(home, "executor-result.json");
      await writeFile(resultFile, JSON.stringify({ response: "CLI canary complete: $PATH and 'quotes' remain data.", receipt }), "utf8");
      const completed = await run([
        "work:complete", "--feed", "inbox", "--work", queued.id, "--token", executor.capabilityToken,
        "--result-file", resultFile,
      ]);
      expect(completed).toMatchObject({ id: queued.id, status: "completed", executorReceipt: { outcome: "completed" } });

      const blockedOperator = await run(["work:claim", "--feed", "inbox", "--thread", "operator-thread"]);
      expect(blockedOperator.id).toBe(blockedQueued.id);
      await run([
        "work:executor-reserve", "--feed", "inbox", "--work", blockedQueued.id, "--token", blockedOperator.capabilityToken,
        "--repo", "blocked-repo", "--resource", "repo:blocked-repo", "--source-fingerprint", "blocked-source",
      ]);
      await run([
        "work:executor-bind", "--feed", "inbox", "--work", blockedQueued.id, "--token", blockedOperator.capabilityToken,
        "--task", "blocked-task", "--project", "project-blocked", "--cwd", "/tmp/blocked-repo",
      ]);
      const blockedExecutor = await run(["work:executor-claim", "--feed", "inbox", "--work", blockedQueued.id, "--task", "blocked-task"]);
      const blockedReceipt = {
        ...receipt,
        workId: blockedQueued.id,
        cardId: "cli-blocked-executor",
        executorTaskId: "blocked-task",
        repoKey: "blocked-repo",
        outcome: "blocked",
        summary: "The canary hit its planned blocker.",
        blocker: { owner: "Mo", reason: "Canary access is unavailable.", unblockAction: "Restore canary access." },
      };
      const blockedResultFile = path.join(home, "blocked-receipt.json");
      await writeFile(blockedResultFile, JSON.stringify(blockedReceipt), "utf8");
      const blocked = await run([
        "work:block", "--feed", "inbox", "--work", blockedQueued.id, "--token", blockedExecutor.capabilityToken,
        "--result-file", blockedResultFile,
      ]);
      expect(blocked).toMatchObject({ id: blockedQueued.id, status: "blocked", executorReceipt: { outcome: "blocked" } });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
