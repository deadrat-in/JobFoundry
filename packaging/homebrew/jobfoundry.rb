# typed: false
# frozen_string_literal: true

# JobFoundry Homebrew formula.
#
# This file lives in the tap repository (Covai-Labs/homebrew-tap) as
# Formula/jobfoundry.rb — it is versioned here as the source of truth and
# copied over on each release (manually for v0.4.x, via the bump workflow
# once HOMEBREW_TAP_GITHUB_TOKEN is configured; see packaging/homebrew/README.md).
#
# To cut a release: update `version`, the darwin-arm64 `url`, and its `sha256`
# (from the jobfoundry-*-darwin-arm64.tar.gz.sha256 asset attached to the
# GitHub release by the build-macos-tarballs CI job).
class Jobfoundry < Formula
  desc "Local-first AI resume tailor, job application tracker, and scoring core"
  homepage "https://github.com/Covai-Labs/JobFoundry"
  version "0.4.1"
  license "AGPL-3.0-only"

  on_macos do
    on_arm do
      url "https://github.com/Covai-Labs/JobFoundry/releases/download/v0.4.1/jobfoundry-0.4.1-darwin-arm64.tar.gz"
      sha256 "REPLACE_WITH_DARWIN_ARM64_SHA256"
    end
  end

  # NOTE: Linux users are served today by the AppImage and the container
  # image (see install.sh). Add an `on_linux` stanza here once the release
  # pipeline publishes linux tarballs; until then the formula is macOS-only
  # so `brew install` fails loudly instead of fetching a 404.

  def install
    # The tarball layout is bin/jobfoundry (dispatcher) + usr/{bin,lib,share}.
    # Keep everything under libexec and symlink only the entry point.
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/jobfoundry"
  end

  # `brew services start jobfoundry` runs the launcher in the foreground
  # under launchd; logs go to Homebrew's var/log.
  service do
    run [opt_bin/"jobfoundry"]
    keep_alive true
    log_path var/"log/jobfoundry.log"
    error_log_path var/"log/jobfoundry.error.log"
    environment_variables PORT: "8080", JOBFOUNDRY_NO_BROWSER: "1"
  end

  test do
    # `status` always exits 0 and names each service — a safe smoke test
    # that never starts daemons.
    assert_match "jobfoundry", shell_output("#{bin}/jobfoundry status")
  end
end
