# Support

Stuck? You are in the right place. This page explains where to get help with
JobFoundry depending on what kind of help you need.

> **New here and not technical?** Start with the
> [Quickstart Guide](https://jobfoundry.covai.org/welcome.html) —
> it walks through installing the app and the browser extension with no
> terminal required. You do not need to know programming, Docker, or AI tools
> to use JobFoundry.

## I need help using JobFoundry

- **Documentation first:** the [docs portal](https://jobfoundry.covai.org/)
  covers installation, the browser extension, architecture, providers, and
  privacy. Most setup questions are answered in
  [Getting Started](https://jobfoundry.covai.org/docs/getting-started/)
  and the [Extension guide](https://jobfoundry.covai.org/docs/extension/).
- **Ask the community:** open a
  [GitHub Discussion](https://github.com/deadrat-in/JobFoundry/discussions)
  (Q&A category) describing what you were trying to do, what you expected,
  and what happened instead. Screenshots of the dashboard or extension popup
  help far more than log pastes.
- **Found a bug?** File it as a
  [GitHub Issue](https://github.com/deadrat-in/JobFoundry/issues) using the
  bug report template. Please include: your install method (Docker, AppImage,
  MSIX), your OS and browser, and steps to reproduce.

When asking for help, **never share** your `.env` file, API keys, or your
full resume in public threads. Maintainers will never ask for your keys.

## I want a new job board supported

Check the [provider directory](https://jobfoundry.covai.org/docs/providers/)
first — your board may already be covered. If not, file a **provider
request** issue with a link to a sample public job posting on that board.
If you are comfortable contributing code, the
[provider authoring guide](extension/src/background/providers/ADDING_A_PROVIDER.md)
walks through the whole process.

## I am coming from career-ops

Welcome — the tools are complementary, and migration is supported:

- Bring your discovered postings over with the import script, which reads a
  career-ops `pipeline.md` (or workspace directory) and ingests each posting
  into JobFoundry (deduplication is automatic):
  ```bash
  node scripts/import-career-ops.mjs --from /path/to/career-ops/data/pipeline.md
  ```
- Relationship notes: career-ops is an excellent AI-CLI-native power tool;
  JobFoundry exists for people who would rather drive everything from their
  browser and dashboard. See
  ["JobFoundry vs career-ops" in the README](README.md#jobfoundry-vs-career-ops)
  for the full story.

## I found a security vulnerability

Do **not** open a public issue. Follow
[SECURITY.md](SECURITY.md): email
[security@covai.org](mailto:security@covai.org) or open a
[private security advisory](https://github.com/deadrat-in/JobFoundry/security/advisories/new).

## I want to contribute

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Development Guide](DEVELOPMENT.md). Provider contributions follow
[ADDING_A_PROVIDER.md](extension/src/background/providers/ADDING_A_PROVIDER.md).
All participation is covered by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Response expectations

JobFoundry is maintained by a small team alongside day jobs. We triage
issues and discussions as fast as we can, roughly in this order: security
reports, data-loss bugs, broken installs, provider breakage, feature
requests. If your issue hasn't had a response in two weeks, a polite bump is
welcome — things do slip.
