# Changelog

Attention uses SemVer for tagged release snapshots. Releases are provided for reproducibility, not as
a promise of ongoing maintenance.

## Unreleased

- Add the local On Your Mind workspace, Chronicle publication contract, privacy-filtered source
  trails, and source-backed feed influence receipts.
- Advance the CLI contract to `0.2` with context binding, publication, health, and feed-safe read
  commands.
- Advance the SQLite schema to `12` for mirrored context binding and update records.

## 0.1.0 - Initial Local-First OSS Snapshot

- Local Bun executable serving UI and API from one process.
- SQLite runtime storage with readable file mirrors and backup compatibility.
- CLI-first Codex agent contract with feed binding, work queue, card, source-run, sweep, and learning commands.
- TanStack Router and TanStack Query UI structure.
- Binary build, smoke, and package scripts with bundled UI assets.
- CI verification for build, tests, binary smoke, and package creation.
- MIT license, contributor guidance, install/data/security/agent docs, runbook, and capability map.
