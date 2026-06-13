# Security

Attention is local-first and binds its development server to `127.0.0.1` by default.

## Trust Boundary

- The local Attention app stores workflow state and evidence.
- Codex Desktop performs connector access.
- Gmail, GitHub, Slack, browser, and other connector credentials are not stored by Attention.
- External mutations require approved work and immediate `verify_action` checks.

## Localhost

The API is a local HTTP endpoint. Treat it as a trusted-local interface and avoid exposing it on a public network.

## On Your Mind

Chronicle context may include privacy-filtered OCR. Tend stores the full filtered windows only in
the local SQLite database, readable file mirror, and dedicated `/mind` detail API. Publication
receipts, cards, and feed-safe CLI reads omit full OCR.

The built-in filter removes common secrets, email addresses, long account numbers, and local user
paths. It is defense in depth, not a substitute for source restraint: publishers must include only
short windows that support a published signal.

## Reporting

For vulnerabilities, open a private report through the repository's security advisory flow if available. If not, contact the maintainers before publishing details.
