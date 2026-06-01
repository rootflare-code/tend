# Capability Map

| User outcome | Browser path | Codex path |
| --- | --- | --- |
| Review a feed | Scroll the active feed | `pnpm cli -- state --feed <id>` |
| Configure local dictation | Hold the detected Monologue shortcut and speak | `setup:detect-monologue` discovers the installed app and records its local shortcut without a setup form |
| Instruct a card | Use the persistent dock | `work:list`, `work:claim`, `work:complete` |
| Cancel accidental dictated text | Use the brief Undo toast or ask Codex before work starts | `work:cancel --feed ... --work ...` restores the card without executing the queued instruction |
| Approve a proposed action | Press `A` or Approve | Executor receives exact approved digest and current state is revalidated |
| Dismiss and run default cleanup | Press `X` or Dismiss, with brief Undo | Queue `default_cleanup`, drain it through Codex, and record the verified outcome |
| Create a feed | Describe it in one text field | `feed:create --brief ... --thread ...` |
| Archive an extra feed | Ask Codex to archive it | `feed:archive --feed ...` preserves its ignored state outside the active workspace |
| Add a source | Describe it in one text field | `source:add --feed ... --brief ...` |
| Tune a feed | Open `Prompts & sources` → `This feed` | Edit feed policy and source recipes directly; `inspect --feed ...` remains available to Codex |
| Edit shared judgment | Open `Prompts & sources` → `Global prompts` | Edit `global-policy.md` and the allowlisted prompt files directly |
| Bind a home thread | Guided Codex setup | `feed:bind --feed ... --thread ...` |
| Schedule refresh and drain | Approve proposed cadence | `feed:heartbeat:propose`, then host `automation_update`, then `feed:heartbeat:installed` |
| Verify an approved external action | Approve the exact visible artifact | `action:verify` rereads the current artifact digest immediately before mutation |
| Collect evidence | Render the resulting cards | `source:record-run` or `source:import-json-file` writes immutable snapshots, judgment record, and checkpoint |
| Render a judged item | Review its structured blocks | `card:upsert --feed ... --card ...` |
| Compound learning | End-of-pass button | Claim `compound_learnings`, revise policy, create structural proposals |
| Revert micro-learning | Review policy history | `policy:revert --feed ... --revision ...` |

The app deliberately exposes atomic primitives. A new feed should usually require new recipe prose,
not new server code.
