# Governance

JobFoundry is a young, pre-launch project. This document describes how it is
run today and how that will evolve as the community grows.

## Current model: maintainer-led

JobFoundry is led by its founding maintainer
([deadrat-in](https://github.com/deadrat-in)), who has final say on
architecture, releases, and moderation. This is a practical choice for a
pre-launch codebase under active construction — not a power statement. The
maintainer's job is to keep the [Manifesto](MANIFESTO.md) honest, the
[architectural invariant](ARCHITECTURE.md) intact, and the review queue
moving.

## Decision-making

- **Small fixes** (typos, broken providers, docs): PR with passing CI is
  usually merged quickly.
- **Features and provider additions**: PR with tests and docs; discussed in
  the PR itself.
- **Architectural changes** (anything touching the server-never-scrapes
  invariant, the tailor's truthfulness guarantees, or storage ownership):
  require an issue first, with rationale, so the trade-offs are on record
  before code exists.
- **Deadlocks**: the maintainer decides, with reasoning written down in the
  issue or PR.

## Contributor ladder

As the project grows past launch, recognition grows with sustained,
high-quality participation:

1. **Participant** — uses JobFoundry, files issues, joins discussions.
2. **Contributor** — has merged PRs (code, providers, docs).
3. **Reviewer** — regularly reviews others' PRs with care; may approve
   provider and docs PRs.
4. **Maintainer** — merge rights across the repo; shares release and
   moderation duties.

Movement along the ladder is by maintainer nomination based on visible,
sustained work — there are no applications and no quotas. The ladder exists
so that responsibility can be shared, not so that status can be hoarded.

## Code of Conduct

All governance is exercised under [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
Moderation actions (warnings, bans) follow its enforcement ladder, are
decided by maintainers, and may be appealed once by email to
[security@covai.org](mailto:security@covai.org).

## Money, licensing, and forks

- The codebase is **AGPL-3.0**, permanently. There is no contributor license
  agreement and no relicensing plan.
- There is no paid tier, no hosted service, and no telemetry to monetize.
  If that ever needs to change, it changes here first, in public, before
  any code reflects it.
- Forks are explicitly welcome — that is what the license is for. The
  [trademark policy](TRADEMARK.md) only asks that forks not present
  themselves as JobFoundry itself.
