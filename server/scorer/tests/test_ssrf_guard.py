import pytest

from src.ssrf_guard import SSRFBlockedError, assert_safe_url, is_blocked_ip, trusted_origins


def test_trusted_origins_defaults_and_env():
    origins = trusted_origins()
    for origin in (
        "http://127.0.0.1:8318",
        "http://localhost:8318",
        "http://127.0.0.1:11434",
        "http://localhost:11434",
    ):
        assert origin in origins

    import os

    try:
        os.environ["ALLOWED_LLM_BASES"] = "http://10.99.0.5:1234, https://gateway.internal:8443"
        extra = trusted_origins()
    finally:
        del os.environ["ALLOWED_LLM_BASES"]
    assert "http://10.99.0.5:1234" in extra
    assert "https://gateway.internal:8443" in extra


@pytest.mark.parametrize(
    "ip",
    [
        "0.0.0.0",
        "10.0.0.1",
        "100.64.0.1",
        "127.0.0.1",
        "169.254.169.254",
        "172.16.0.1",
        "172.31.255.255",
        "192.0.0.1",
        "192.0.2.1",
        "192.168.0.1",
        "198.18.0.1",
        "198.51.100.1",
        "203.0.113.1",
        "224.0.0.1",
        "240.0.0.1",
        "::1",
        "::ffff:127.0.0.1",
        "::ffff:10.0.0.1",
        "::ffff:192.168.0.1",
        "2001:db8::1",
        "fc00::1",
        "fe80::1",
        "ff02::1",
        "not-an-ip",
        "",
    ],
)
def test_is_blocked_ip_flags_forbidden(ip):
    assert is_blocked_ip(ip), f"expected {ip} to be blocked"


@pytest.mark.parametrize(
    "ip",
    [
        "1.1.1.1",
        "8.8.8.8",
        "93.184.216.34",
        "172.32.0.1",
        "192.169.0.1",
        "100.128.0.1",
        "2606:4700:4700::1111",
        "::ffff:8.8.8.8",
        "2001:4860:4860::8888",
    ],
)
def test_is_blocked_ip_allows_public(ip):
    assert not is_blocked_ip(ip), f"expected {ip} to be allowed"


def test_assert_safe_url_allows_trusted_gateways():
    assert_safe_url("http://127.0.0.1:8318/v1/chat/completions")
    assert_safe_url("http://localhost:8318/path")
    assert_safe_url("http://127.0.0.1:11434/v1")
    assert_safe_url("http://localhost:11434/v1")


def test_assert_safe_url_allows_public_ip_literal():
    assert_safe_url("https://8.8.8.8/v1")
    assert_safe_url("http://1.1.1.1:8080/path")


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:8080",
        "https://10.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]:8080/",
        "http://[::ffff:192.168.1.1]:8080/",
    ],
)
def test_assert_safe_url_rejects_blocked_ip(url):
    with pytest.raises(SSRFBlockedError):
        assert_safe_url(url)


def test_assert_safe_url_rejects_structural_abuse():
    with pytest.raises(SSRFBlockedError):
        assert_safe_url("")
    with pytest.raises(SSRFBlockedError):
        assert_safe_url("ftp://example.com/")
    with pytest.raises(SSRFBlockedError):
        assert_safe_url("file:///etc/passwd")
    with pytest.raises(SSRFBlockedError):
        assert_safe_url("https://user:pass@example.com/")


def test_assert_safe_url_rejects_unresolvable_host():
    # .invalid TLD is guaranteed not to resolve (RFC 6761)
    with pytest.raises(SSRFBlockedError):
        assert_safe_url("https://definitely-not-a-real-host.invalid/")


def test_assert_safe_url_allows_public_hostname_with_dns():
    # 1.1.1.1 hostname resolves to public IPs only
    assert_safe_url("https://one.one.one.one/")