# Feed Thread Runbook

## First Local Setup

When Codex starts this app on a Mac, check for Monologue before asking the user to configure
dictation:

```bash
pnpm cli -- setup:detect-monologue
```

If Monologue is installed, the command reads its local recording shortcut and persists the
browser-facing capability under ignored `data/integrations/dictation.json`. The dock then follows
that shortcut automatically when it is a supported single modifier. If Monologue is absent or its
custom shortcut is not yet supported, the command records that honestly and keeps the Inbox Sweep
Right Option fallback.

## Wake And Drain

When the user says `go deal with the feed`, use the exact feed and current thread ID:

```bash
pnpm cli -- work:list --feed <feed-id> --thread <thread-id>
pnpm cli -- work:claim --feed <feed-id> --thread <thread-id>
```

Process the claimed item from current state. When it is complete:

```bash
pnpm cli -- work:complete \
  --feed <feed-id> \
  --work <work-id> \
  --token <capability-token> \
  --result '{"response":"What changed, what happened, and any uncertainty."}'
```

Before an external mutation, verify the exact current approved artifact immediately before acting:

```bash
pnpm cli -- action:verify --feed <feed-id> --work <work-id> --token <capability-token>
```

Repeat claim until it returns `null`. An active claimed item is replayed so restart recovery stays
simple and visible.

## Collect

Read the effective recipe with:

```bash
pnpm cli -- inspect --feed <feed-id>
```

Use the connector, browser, computer-use workflow, local file, or source thread described by the
recipe. Preserve immutable retrieved evidence and record the completed run:

```bash
pnpm cli -- source:record-run \
  --feed <feed-id> \
  --source <source-id> \
  --snapshots '<json-array>' \
  --judgments '<json-array>' \
  --checkpoint '<json-object>'
```

Do not pad. If nothing deserves attention, record an empty judgment set and stop.

For an existing local JSON artifact, import it without passing private payload text through the
shell:

```bash
pnpm cli -- source:import-json-file --feed <feed-id> --source <source-id> --path <local-file>
```

Use `source:import-file` for local text or JSONL artifacts.

Commit a judged card with structured blocks:

```bash
pnpm cli -- card:upsert --feed <feed-id> --card '<json-card>'
```

During migration only, an explicitly selected provenance-bearing card from the old Attention
Workbench can be converted into the new block format:

```bash
pnpm cli -- legacy:import-attention-card --feed company-attention --path <batch-json> --card-id <id>
```

For parallel Inbox migration, explicitly selected current Inbox Sweep cards can be converted while
Inbox Sweep remains authoritative:

```bash
pnpm cli -- legacy:import-inbox-card --feed inbox --path <current-brief-json> --card-id <id>
```

## Learn

After meaningful feedback, revise `policy.md` only for small feed-specific improvements. Keep it
compact. Structural changes, new permissions, prompt edits, source changes, and global lessons
become explicit proposal cards:

```bash
pnpm cli -- proposal:create --feed <feed-id> --title "..." --brief "..." --instruction "..."
```
