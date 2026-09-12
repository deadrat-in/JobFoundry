## What this PR does

<!-- One or two sentences: the problem and the fix. Link issues with "Closes #NN". -->

## Type of change

<!-- Check all that apply. -->

- [ ] Bug fix
- [ ] New provider (`extension/src/background/providers/`) — per-provider checklist below applies
- [ ] Feature
- [ ] Documentation only
- [ ] CI / packaging / chore

## Verification

<!-- How did you verify this? Commands run, manual steps, screenshots for UI changes. -->

```bash
npm test
npm --workspace=extension test
npm run lint
npm run format:check
```

- [ ] Root suite (`npm test`) green
- [ ] Extension suite (`npm --workspace=extension test`) green
- [ ] Python suites (`server/scorer`, `server/tailor` pytest) green — if touched
- [ ] Lint + format clean

## Provider checklist (new/changed providers only)

- [ ] `id` unique; static index regenerated (`node extension/scripts/gen-provider-index.mjs`)
- [ ] Inventory counts bumped in `extension/test/providers.test.mjs`
- [ ] `providers/tests/{name}.test.mjs` added/updated
- [ ] Docs-site row added/updated in `site/src/components/ProvidersDirectory.astro`
- [ ] No raw `fetch()`, no `node:*` imports, allowlist guards where required (see `ADDING_A_PROVIDER.md`)

## Invariant check

- [ ] This PR does **not** add outbound job-board requests to `server/` (architectural invariant). All board traffic stays in `extension/`.
- [ ] No secrets, API keys, resumes, or personal data in commits.

## Docs

- [ ] User-facing behavior changes are reflected in docs (`README.md` and/or `site/`)
- [ ] `CHANGELOG.md` entry added under `[Unreleased]`
