# Tend Feed Thread Protocol

- Read `RUNBOOK.md` before operating a feed.
- Drain pending work with `work:list` and repeated `work:claim` calls for the exact feed and home
  thread. Complete each claimed item from current state.
- When a meaningful sweep or refresh reaches the CLI idle handshake, ask the user: `Want me to
  compound what I learned from this sweep?`
- `Compound` means: review the sweep's cards, feedback, outcomes, and prior policy; queue
  `learning:request --feed <id>` after the user agrees; return an editable policy proposal; and
  never apply it without user approval.
- If the user asks to compound and search again, compound first. Recollect after the reviewed policy
  proposal is applied, or after the user explicitly says to continue without applying it.
- Do not repeat the compound question when a wake begins idle and no meaningful sweep or refresh
  happened in the current turn.
- Never perform an external mutation without the app's exact visible approval and a fresh
  `action:verify`.
