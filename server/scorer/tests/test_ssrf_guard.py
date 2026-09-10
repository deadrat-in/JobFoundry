import pytest
import socket
import httpx

from src.ssrf_guard import (
    SSRFBlockedError,
    _pin_request,
    assert_safe_url,
    is_blocked_ip,
    trusted_origins,
)


def test_trusted_origins_defaults_and_env(monkeypatch):
    origins = trusted_origins()
    for origin in (
        "http://127.0.0.1:8318",
        "http://localhost:8318",
        "http://127.0.0.1:11434",
        "http://localhost:11434",
        "http://127.0.0.1:8081",
        "http://localhost:8081",
    ):
        assert origin in origins

    monkeypatch.setenv("ALLOWED_LLM_BASES", "http://10.99.0.5:1234, https://gateway.internal:8443")
    extra = trusted_origins()
    assert "http://10.99.0.5:1234" in extra
    assert "https://gateway.internal:8443" in extra

    monkeypatch.setenv("RESUME_OPS_URL", "http://resume-ops.internal:8081")
    assert "http://resume-ops.internal:8081" in trusted_origins()


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
        "::",
        "::1",
        "::ffff:127.0.0.1",
        "::ffff:10.0.0.1",
        "::ffff:192.168.0.1",
        "::192.168.1.1",
        "::127.0.0.1",
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
    assert_safe_url("http://127.0.0.1:8081/v1")
    assert_safe_url("http://localhost:8081/v1")


def test_assert_safe_url_allows_public_ip_literal():
    assert_safe_url("https://8.8.8.8/v1")
    assert_safe_url("https://1.1.1.1:8080/path")


def test_assert_safe_url_requires_https_for_public_endpoints():
    # A public http endpoint would leak the API key in cleartext
    with pytest.raises(SSRFBlockedError):
        assert_safe_url("http://1.1.1.1:8080/path")
    with pytest.raises(SSRFBlockedError):
        assert_safe_url("http://8.8.8.8/v1")


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1:8080",
        "https://10.0.0.1/",
        "https://169.254.169.254/latest/meta-data/",
        "https://[::1]/",
        "https://[::ffff:192.168.1.1]/",
        "https://[::192.168.1.1]/",
        "https://[::127.0.0.1]/",
    ],
)
def test_assert_safe_url_rejects_blocked_ip(url):
    with pytest.raises(SSRFBlockedError):
        assert_safe_url(url)


def _fake_resolve(public_ip: str):
    def fake(host, port, family=0, type=0, proto=0, flags=0):
        assert host == "api.example.com"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (public_ip, port))]
    return fake


def test_pin_request_rewrites_hostname_to_validated_ip(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _fake_resolve("93.184.216.34"))
    request = httpx.Request(
        "POST", "https://api.example.com/v1/chat", headers={"x-origin": "test"}
    )
    pinned = _pin_request(request)
    assert pinned.url.host == "93.184.216.34"
    assert pinned.url.scheme == "https"
    assert pinned.headers["host"] == "api.example.com"
    assert pinned.extensions.get("sni_hostname") == "api.example.com"
    assert pinned.headers["x-origin"] == "test"


def test_pin_request_raises_when_resolution_is_forbidden(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _fake_resolve("10.0.0.5"))
    request = httpx.Request("POST", "https://api.example.com/v1")
    with pytest.raises(SSRFBlockedError):
        _pin_request(request)


def test_pin_request_leaves_ip_literals_untouched():
    request = httpx.Request("POST", "https://8.8.8.8/v1")
    assert _pin_request(request) is request


def test_pin_request_leaves_trusted_origins_untouched():
    request = httpx.Request("POST", "http://localhost:8318/v1/chat/completions")
    assert _pin_request(request) is request


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