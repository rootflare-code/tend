# On Your Mind

## Product shape

On Your Mind is a separate workspace destination at `/mind`. It stores one current, local,
privacy-filtered picture of what Dan is actively thinking about, plus recent history and the source
observations used to form each signal.

Feeds may use a fresh update in two distinct ways:

1. **Lens**: focus collection, search, ranking, or framing inside the feed's normal sources.
2. **Research brief**: originate one bounded, feed-relevant research question.

In research mode, On Your Mind explains why the research happened now. It is not evidence for the
answer. The resulting card must cite independently collected, current, feed-owned source runs.

## Safety boundaries

- Context never overrides global policy, feed policy, or source permissions.
- Context is never authorization for an external mutation.
- Context cannot make stale evidence current.
- Context cannot create a source-free card.
- Full filtered OCR is available only in the local `/mind` workspace and its dedicated detail API.
- Feed runners receive summaries and short excerpts, never full OCR windows.
- Existing visible cards do not change when a new context update arrives.

## Persistence

- Chronicle binds one publisher thread with `context:bind`.
- Chronicle publishes file-backed payloads with `context:publish`.
- Fresh updates expire after three hours.
- History is retained for seven days; pulse records referenced by cards remain available for audit.
- Replaying an identical update is idempotent.
- Older publications cannot replace a newer publication.
- Health-only stale or unavailable updates preserve the last fresh update for audit.

## Feed provenance

Sweep batches may pin one context update. Source runs may record a context use:

- `lens`: context focused normal collection.
- `research`: context originated a bounded research question.

Cards materially affected by context include a `contextInfluence` receipt with the update, signal,
mode, effect, concise explanation, and source count. Research receipts are labeled
`Prompted by On Your Mind`; lens receipts are labeled `On your mind`.

## Completion evidence

- The `/mind` workspace passes desktop and narrow browser review.
- Inbox, Company Attention, and Every Performance each produce one real-source context lift and one
  no-effect control.
- Context-influenced cards remain fully source-backed and lane-specific.
- Unit, integration, build, binary smoke, and canonical runtime checks pass.

### Paired evaluation results

Read-only paired evaluations on June 13 used the same frozen corpus for baseline and treatment
judgments:

- **Inbox:** a context-shaped Gmail search elevated a potentially unresolved Cora renewal to
  "verify status"; completed Cora work and stale topical mail remained suppressed.
- **Company Attention:** normal pulse evidence produced no card, while a bounded research question
  prompted by the paywall signal found a reversible mobile CTA-placement test; a Dan-led poll with
  no replies remained no-effect.
- **Every Performance:** the mobile treatment path crossed the attention threshold because it
  directly informed the active diagnosis; the obvious overall conversion collapse and the
  instrumentation gap already surfaced without context and received no lift credit.
