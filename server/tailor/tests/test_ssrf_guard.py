from resume_ops_api.services.ssrf_guard import trusted_origins


def test_legacy_resume_ops_url_is_not_trusted(monkeypatch):
    """The removed legacy variable cannot trust a remote Tailor origin."""

    remote_origin = "http://resume-ops.internal:8081"
    monkeypatch.delenv("ALLOWED_LLM_BASES", raising=False)
    monkeypatch.setenv("RESUME_OPS_URL", remote_origin)

    assert remote_origin not in trusted_origins()
