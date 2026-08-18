import pytest
import httpx
from src.tailor_bridge import TailorBridge, TailorResult


@pytest.mark.asyncio
async def test_tailor_bridge_skips_when_no_base_url():
    bridge = TailorBridge(base_url=None)
    result = await bridge.tailor(
        job={"id": "job-1", "description": "Backend engineer"},
        master_resume={"name": "Alex", "skills": ["Python"]},
    )
    assert result is None


@pytest.mark.asyncio
async def test_tailor_bridge_success():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/tailor"
        assert request.method == "POST"
        return httpx.Response(
            200,
            json={
                "resume": {"name": "Alex Smith", "label": "Backend Engineer"},
                "pdf_base64": "JVBERi0xLjQKJeLjz9MK...",
                "theme": "jsonresume-theme-folio",
                "plain_text": "Name: Alex Smith\nTitle: Backend Engineer",
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        bridge = TailorBridge(base_url="http://testserver", client=client)
        result = await bridge.tailor(
            job={"id": "job-1", "description": "Backend engineer"},
            master_resume={"name": "Alex", "skills": ["Python"]},
            theme="jsonresume-theme-folio",
        )

        assert result is not None
        assert isinstance(result, TailorResult)
        assert result.resume["name"] == "Alex Smith"
        assert result.theme == "jsonresume-theme-folio"
        assert result.pdf_base64 == "JVBERi0xLjQKJeLjz9MK..."
        assert "Name: Alex Smith" in result.plain_text


@pytest.mark.asyncio
async def test_tailor_bridge_handles_server_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"detail": "Internal error in pipeline"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        bridge = TailorBridge(base_url="http://testserver", client=client)
        result = await bridge.tailor(
            job={"id": "job-1", "description": "Backend engineer"},
            master_resume={"name": "Alex", "skills": ["Python"]},
        )
        assert result is None
