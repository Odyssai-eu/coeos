"""MCP streamable-http wrapper devant docling-service (localhost:8083). Port 8087.
Formats acceptes par docling: .pdf .docx .doc .pptx .xlsx .csv .md .html"""
import base64
import os

import httpx
from fastmcp import FastMCP

DOCLING = os.environ.get("DOCLING_URL", "http://localhost:8083")
mcp = FastMCP("docling")


async def _parse(filename: str, content: bytes) -> str:
    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.post(f"{DOCLING}/parse", files={"file": (filename, content)})
        resp.raise_for_status()
        data = resp.json()
        md = data.get("markdown", "")
        return md if md else "(document vide apres conversion)"


@mcp.tool()
async def docling_parse_url(url: str) -> str:
    """Telecharge un document (PDF, DOCX, PPTX, XLSX, CSV, HTML) depuis une URL
    et le convertit en Markdown via Docling."""
    async with httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
        r = await client.get(url)
        r.raise_for_status()
        name = url.rstrip("/").split("/")[-1] or "document.pdf"
        return await _parse(name, r.content)


@mcp.tool()
async def docling_parse_base64(filename: str, content_base64: str) -> str:
    """Convertit un document fourni en base64 (petits fichiers uniquement, < ~2 MB)
    en Markdown via Docling. Pour les gros fichiers, utiliser docling_parse_url."""
    return await _parse(filename, base64.b64decode(content_base64))


if __name__ == "__main__":
    # fastmcp >= 2: transport "http" = streamable-http
    mcp.run(transport="http", host="0.0.0.0", port=8087, path="/mcp")
