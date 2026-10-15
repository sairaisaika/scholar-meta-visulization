# Working in Scholar Meta

For interface, dependency-port or tagging changes, start with the short
[engineering entry](docs/wiki/Engineering-entry.md). It maps concrete questions
to declarations, implementations, callers, rules and focused tests, which is
usually faster than guessing filenames.

Query from this repository: `python tools/wiki.py query "外部源端口"`.
Use `python tools/wiki.py list` for supported questions. Routes resolve current source positions;
verify the cited implementation before editing. If a route is missing or stale,
use a targeted source search and repair that route. Source wins over stale docs.
No full-wiki reading requirement.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before edits; its public-engine boundaries
apply. Interface or behavior changes require the relevant contract/version,
CHANGELOG, snapshots and documentation updates described there. Run `pnpm check`
before committing; report platform limitations accurately.
