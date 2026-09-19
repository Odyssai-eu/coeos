# docling-mcp — wrapper MCP devant docling-service

Tourne sur **.44** (`~/RAG/docling-mcp/`, launchd `com.docling.mcp-server`,
port **8087**, streamable-http `/mcp`). Convertit PDF/DOCX/PPTX/XLSX/CSV/HTML
en Markdown via le docling-service local (`localhost:8083`).

Outils: `docling_parse_url`, `docling_parse_base64` (petits fichiers).
Déploiement: venv uv + `fastmcp httpx`, plist calqué sur com.qdrant.mcp-server.
Câblé dans coeos-code via `coeos-config.ts` (mcp.docling, remote, timeout 300s).
