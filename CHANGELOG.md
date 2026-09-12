# Changelog

JobFoundry follows [Semantic Versioning](https://semver.org/). The current
version lives in [`VERSION`](VERSION). This file records user-visible changes
per release; the full commit history is in git.

## [Unreleased]

- Documentation overhaul: new Code of Conduct, Support, Architecture,
  Manifesto, Governance, Privacy-adjacent legal docs, changelog, provider
  authoring rewrite, and a non-technical-user-first getting-started guide.

## [0.4.0] — 2026-09-12

First packaged distribution release.

- **Windows 11 MSIX sideload package** (x64) with Start-menu launch and
  `jobfoundry` control CLI (`start` / `status` / `logs` / `stop`).
- **Linux AppImage** (x86_64): single portable file, no Docker required;
  distro-agnostic build on AlmaLinux 10. Data follows XDG conventions under
  `~/.local/share/jobfoundry/`.
- Web dashboard unification: settings with vertical categories, embedded
  profile & sync, onboarding quickstart, split-pane triage station.
- Per-user LLM settings for multi-tenant BYOK; multi-model catalog with
  LiteLLM test endpoint.
- Security: SSRF + credential-leak guard via LLM API base-URL allowlist.
- Scorer daemon self-heal for un-migrated databases.
- Runtime baseline: Node 26.
- Removed the in-container LLM proxy; scoring/tailoring call the configured
  provider directly.

## [0.3.0] — 2026-09-02

The "everything local" consolidation.

- **resume-ops merged into `server/tailor`**: the standalone tailoring
  service became JobFoundry's integrated LangGraph engine (it began life as
  a standalone API designed to sit alongside tools like career-ops; it now
  ships inside the stack).
- Single All-in-One container image published to GHCR with multi-arch
  support; single-command installer (`install.sh`).
- Extension dashboard, side panel with reconnect sync, secure
  extension-to-dashboard auto-connect (heartbeat + API-key UI).
- Universal job decanter, background worker daemon with attempt tracking
  and batch ingestion limits.
- TOON resume formatting for LLM prompts (lower token usage); tailored
  artifacts (PDF + ATS plaintext) with pipeline monitoring endpoints.
- Docs portal (Astro → GitHub Pages), `CONTRIBUTING.md`, `DEVELOPMENT.md`,
  `SECURITY.md`, `AGENTS.md`.

## [0.2.12] — 2026-07-22

- Parameterized LLM retry back-off exposed via environment variables.
- Default PDF theme switched to folio with runtime npm theme loading via
  `NODE_PATH`.

## [0.2.11] — 2026-07-01

- Refactored LLM response cache to a post-validation layer.

## [0.2.10] — 2026-07-01

- LiteLLM caching made configurable (`LLM_CACHE`).

## [0.2.9] — 2026-06-28

- Structured-LLM retry count made configurable (`LLM_MAX_RETRIES`).

## [0.2.8] — 2026-06-25

- Client-side rate limiting and concurrency throttling in the structured
  LLM client.

## [0.2.7] — 2026-06-24

- Plain-text ATS resume output added to the tailoring API.

## [0.2.6] — 2026-06-23

- `drop_params=True` for forward-compatible model routing.

## [0.2.5] — 2026-06-22

- Retry without `response_format` when `json_object` mode fails
  (Claude/OpenRouter compatibility).

## [0.2.4] — 2026-06-16

- Reverted strict verbatim-name instruction for optional resume sections.

## [0.2.3] — 2026-06-16

- Removed strict interest-name verification.

## [0.2.2] — 2026-06-16

- Strict warning to preserve interest names verbatim in prompts.

## [0.2.1] — 2026-06-16

- Ensure `'json'` appears in messages when `response_format` is
  `json_object`.

## [0.2.0] — 2026-06-15

- Pydantic model validators enforcing tailored output consistency against
  the master resume, with test coverage.
- Podman-first volume guidance (rootless `:U` mounts) with Docker
  compatibility notes.

## [0.1.1] — 2026-06-08

- Container build fixes (amd64).

## [0.1.0] — 2026-06-08

Initial public history: monorepo scaffold (AGPL-3.0), ingest API with
SQLite + API-key auth + SimHash dedup, LangGraph tailoring pipeline with
immutable-field protection, prompt-robustness work for structured LLM
output, and GHCR publishing.
