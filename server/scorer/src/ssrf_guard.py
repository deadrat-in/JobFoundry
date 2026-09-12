"""
Connection-time SSRF guard for outbound LLM requests.

BYOK lets users supply arbitrary api_base hostnames, so the static provider
allowlist is no longer viable. We block any destination whose host resolves to a
private / loopback / link-local / reserved IP, while exempting operator-trusted
internal gateways (local Ollama :11434, plus anything listed in
the ALLOWED_LLM_BASES env var) so self-hosted deployments keep working.

litellm does not expose a hook to inject a custom httpx transport per call, so we:
  1. assert_safe_url() — resolve + IP-range check immediately before each LLM call
     (the check and the request fire back-to-back, minimising DNS-rebinding windows).
  2. install_transport_guard() — monkeypatches httpx.AsyncHTTPTransport and
     HTTPTransport to run the same check on every outbound request in this process
     (defense-in-depth for any direct httpx usage).
"""

import ipaddress
import logging
import os
import socket
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

# RFC 1918 + link-local (cloud metadata) + loopback + CGNAT + shared/doc/bench/multicast/reserved
BLOCKED_V4 = [
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.0.2.0/24"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("198.51.100.0/24"),
    ipaddress.ip_network("203.0.113.0/24"),
    ipaddress.ip_network("224.0.0.0/4"),
    ipaddress.ip_network("240.0.0.0/4"),
]

# IPv6 loopback, unspecified, IPv4-compatible, ULA, link-local, documentation and multicast
BLOCKED_V6 = [
    ipaddress.ip_network("::/128"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("::/96"),  # IPv4-compatible, e.g. ::192.168.1.1
    ipaddress.ip_network("2001:db8::/32"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
    ipaddress.ip_network("ff00::/8"),
]

TRUSTED_DEFAULT_ORIGINS = {
    "http://127.0.0.1:11434",
    "http://localhost:11434",
    "http://127.0.0.1:8081",
    "http://localhost:8081",
}


class SSRFBlockedError(Exception):
    """Raised when a destination is not permitted by SSRF policy."""


def _normalize_origin(s: str) -> str | None:
    try:
        p = urlparse(s.strip())
        if p.scheme not in ("http", "https") or not p.hostname:
            return None
        default_port = {"http": 80, "https": 443}.get(p.scheme)
        if p.port and p.port != default_port:
            return f"{p.scheme}://{p.hostname}:{p.port}"
        return f"{p.scheme}://{p.hostname}"
    except Exception:
        return None


def trusted_origins() -> set[str]:
    """Operator-trusted origins allowed to be on private/loopback networks."""
    origins = set(TRUSTED_DEFAULT_ORIGINS)
    tailor_port = os.environ.get("TAILOR_PORT")
    if tailor_port:
        origins.add(f"http://127.0.0.1:{tailor_port}")
        origins.add(f"http://localhost:{tailor_port}")
    sources = os.environ.get("ALLOWED_LLM_BASES", "") + "," + os.environ.get("RESUME_OPS_URL", "")
    extra = {
        origin
        for s in sources.split(",")
        if s.strip()
        for origin in [_normalize_origin(s)]
        if origin
    }
    return origins | extra


def is_blocked_ip(ip_str: str) -> bool:
    """True when an IP literal falls in a forbidden range."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        # Unparseable literals are never allowed
        return True
    if ip.version == 6 and ip.ipv4_mapped is not None:
        # IPv4-mapped IPv6 (::ffff:1.2.3.4) inherits IPv4 policy
        return is_blocked_ip(str(ip.ipv4_mapped))
    networks = BLOCKED_V4 if ip.version == 4 else BLOCKED_V6
    for network in networks:
        if ip in network:
            return True
    return False


def assert_safe_url(url: str) -> None:
    """
    Raises SSRFBlockedError unless the URL is structurally valid and either:
      - its origin is operator-trusted (internal gateway), or
      - its hostname resolves only to public unicast IPs.
    """
    if not url or not url.strip():
        raise SSRFBlockedError("Empty URL")
    stripped = url.strip()
    parsed = urlparse(stripped)
    if parsed.scheme not in ("http", "https"):
        raise SSRFBlockedError(f'URL must use http or https scheme, got "{parsed.scheme}"')
    if not parsed.netloc:
        raise SSRFBlockedError(f"Invalid URL: {url!r}")
    if parsed.username or parsed.password:
        raise SSRFBlockedError("URL must not contain credentials (user:pass@host)")

    origin = _normalize_origin(stripped)
    if origin and origin in trusted_origins():
        return

    if parsed.scheme == "http":
        raise SSRFBlockedError(
            "http:// api_base is only allowed for operator-trusted internal gateways; "
            "use https:// for public endpoints (or add the origin to ALLOWED_LLM_BASES)"
        )

    host = parsed.hostname
    if not host:
        raise SSRFBlockedError(f"Unable to determine host for: {url!r}")

    # Only check literal IPs directly; hostnames go through DNS resolution below.
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if is_blocked_ip(host):
            raise SSRFBlockedError(f"Connection to private/blocked IP is not allowed: {host}")

    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    addresses = _resolve(host, port)
    for addr in addresses:
        if is_blocked_ip(addr):
            raise SSRFBlockedError(
                f"Connection to {host} is blocked: it resolves to non-public IP {addr}"
            )


def _resolve(host: str, port: int, resolver=None) -> list[str]:
    resolver = resolver or socket.getaddrinfo
    try:
        infos = resolver(host, port, family=socket.AF_UNSPEC, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise SSRFBlockedError(f"Unable to resolve host: {host}")
    addresses = sorted({info[4][0] for info in infos})
    if not addresses:
        raise SSRFBlockedError(f"Unable to resolve host: {host}")
    return addresses


def _pin_request(request):
    """
    Rewrites an outbound httpx request so the connection is made to the exact
    IP address validated by the SSRF check, rather than letting httpx re-resolve
    the hostname at connect time.

    This closes the DNS-rebinding (TOCTOU) window between validation and
    connection: the URL host is replaced by the pinned public IP, the original
    Host header is preserved for virtual-host routing, and the TLS SNI hostname
    extension keeps certificate validation bound to the user-supplied name.

    IP-literal and operator-trusted origins are returned unchanged. Direct
    (non-proxied) connections only — outbound-proxy setups would need proxy-level
    enforcement, which this codebase does not use.
    """
    url = str(request.url)
    parsed = urlparse(url)
    host = parsed.hostname
    if not host or parsed.scheme not in ("http", "https"):
        return request
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        return request  # already an IP literal: nothing to pin

    if _normalize_origin(url) in trusted_origins():
        return request  # operator gateways keep their original hostname

    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    addresses = _resolve(host, port)
    for addr in addresses:
        if is_blocked_ip(addr):
            raise SSRFBlockedError(
                f"Connection to {host} is blocked: it resolves to non-public IP {addr}"
            )
    pinned = addresses[0]

    request.url = request.url.copy_with(host=pinned, port=parsed.port)
    request.headers["host"] = f"{host}:{parsed.port}" if parsed.port else host
    if parsed.scheme == "https":
        request.extensions["sni_hostname"] = host
    return request


_orig_async_handle = httpx.AsyncHTTPTransport.handle_async_request
_orig_sync_handle = httpx.HTTPTransport.handle_request


async def _guarded_async_handle(self, request):
    assert_safe_url(str(request.url))
    return await _orig_async_handle(self, _pin_request(request))


def _guarded_sync_handle(self, request):
    assert_safe_url(str(request.url))
    return _orig_sync_handle(self, _pin_request(request))


_PATCHED = False


def install_transport_guard() -> None:
    """
    Patches httpx transports so every outbound request in this process is checked.
    Idempotent; applies to transports created before and after the call.
    """
    global _PATCHED
    if _PATCHED:
        return
    _PATCHED = True
    try:
        httpx.AsyncHTTPTransport.handle_async_request = _guarded_async_handle
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("Failed to install async httpx SSRF guard: %s", e)
    try:
        httpx.HTTPTransport.handle_request = _guarded_sync_handle
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("Failed to install sync httpx SSRF guard: %s", e)
    logger.info("Installed connection-time SSRF guard on httpx transports")
