# JobFoundry Homebrew tap

Distributes the macOS `darwin-arm64` tarball (built by the
`build-macos-tarballs` job in `release-server.yml`) via Homebrew.
No Apple Developer account, signing, or notarization needed — tools
installed through Homebrew are not tagged with the browser quarantine
flag that triggers Gatekeeper pop-ups for downloaded `.dmg` files.

## One-time tap setup

1. Create a public repo `Covai-Labs/homebrew-tap` (the `homebrew-` prefix
   is the naming convention `brew tap covai-labs/tap` expects).
2. Copy `packaging/homebrew/jobfoundry.rb` into it at
   `Formula/jobfoundry.rb`.
3. After the first release that includes a
   `jobfoundry-<version>-darwin-arm64.tar.gz` asset, fill in `version`,
   `url`, and `sha256` in the formula (the `.sha256` sidecar asset is
   published next to the tarball).

## Test the formula before pushing

```bash
# From a Mac with Homebrew installed:
brew tap covai-labs/tap  # once the repo exists
brew install --build-from-source covai-labs/tap/jobfoundry
brew audit --strict covai-labs/tap/jobfoundry
brew test covai-labs/tap/jobfoundry
jobfoundry status
```

## User install / upgrade / service

```bash
brew install covai-labs/tap/jobfoundry
jobfoundry status          # smoke test, never starts daemons
jobfoundry start           # background start (dashboard: http://localhost:8080)
brew services start jobfoundry   # launchd service, survives reboots
brew update && brew upgrade jobfoundry
```

## Automating formula bumps (recommended, after the tap exists)

1. Create a fine-grained PAT with `Contents: write` and
   `Pull requests: write` on `Covai-Labs/homebrew-tap` (the bump action
   opens a PR in the tap repo) and store it as the
   `HOMEBREW_TAP_GITHUB_TOKEN` secret on the `JobFoundry` repo.
2. Add this job to `release-server.yml` (needs the tarball jobs above
   to have published the release first):

```yaml
bump-homebrew-formula:
  runs-on: ubuntu-latest
  needs: build-macos-tarballs
  if: startsWith(github.ref, 'refs/tags/')
  steps:
    - name: Update Homebrew formula
      uses: dawidd6/action-homebrew-bump-formula@v3
      with:
        token: ${{ secrets.HOMEBREW_TAP_GITHUB_TOKEN }}
        tap: Covai-Labs/homebrew-tap
        formula: jobfoundry
        tag: ${{ github.ref_name }}
        no_fork: true
```

Until then, bump `Formula/jobfoundry.rb` by hand on each release.

## Manual testing without a tag (do this first)

`release-server.yml` already has `workflow_dispatch`, so no patch
release is needed to validate the pipeline:

1. Push this branch and run the **Release Server** workflow manually
   from the Actions tab.
2. Download the `jobfoundry-macos-darwin-arm64` run artifact,
   extract it on a Mac, and run `./bin/jobfoundry status`.
3. Only then cut the real tag (e.g. `v0.4.2`) and fill in the formula
   SHA-256 from the published `.sha256` sidecar.
