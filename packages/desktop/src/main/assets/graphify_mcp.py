#!/usr/bin/env python3
"""MCP stdio server pour graphify (explain + path). Stdlib uniquement.
Protocole MCP minimal: initialize / notifications/initialized / ping / tools/list / tools/call.
Framing stdio = JSON-RPC newline-delimited ; ne JAMAIS écrire autre chose sur stdout."""
import json
import os
import subprocess
import sys

GRAPH = os.environ.get("GRAPHIFY_GRAPH", os.path.expanduser("~/.graphify/stack/graph.json"))
BIN = os.environ.get("GRAPHIFY_BIN", os.path.expanduser("~/.local/bin/graphify"))
TIMEOUT = int(os.environ.get("GRAPHIFY_TIMEOUT", "100"))
MAX_OUT = 40000
SUPPORTED = {"2024-11-05", "2025-03-26", "2025-06-18"}

TOOLS = [
    {
        "name": "graphify_explain",
        "description": (
            "Explique un symbole/fichier du graphe de code du stack (localisation, "
            "voisinage d'appels, docstring). A utiliser AVANT tout grep aveugle."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"symbol": {"type": "string", "description": "Nom du symbole ou fichier"}},
            "required": ["symbol"],
        },
    },
    {
        "name": "graphify_path",
        "description": "Plus court chemin entre deux symboles du graphe de code (qui appelle quoi).",
        "inputSchema": {
            "type": "object",
            "properties": {"from_symbol": {"type": "string"}, "to_symbol": {"type": "string"}},
            "required": ["from_symbol", "to_symbol"],
        },
    },
]


def run_graphify(args):
    try:
        p = subprocess.run(
            [BIN, *args, "--graph", GRAPH], capture_output=True, text=True, timeout=TIMEOUT
        )
        out = p.stdout or ""
        if p.returncode != 0:
            out += "\n[stderr] " + (p.stderr or "").strip()
        if len(out) > MAX_OUT:
            out = out[:MAX_OUT] + "\n[...tronque...]"
        return out.strip() or "(sortie vide)", p.returncode != 0
    except subprocess.TimeoutExpired:
        return f"graphify: timeout apres {TIMEOUT}s", True
    except FileNotFoundError:
        return f"graphify introuvable: {BIN} (machine sans graphify ?)", True


def reply(id_, result=None, error=None):
    msg = {"jsonrpc": "2.0", "id": id_}
    if error is not None:
        msg["error"] = error
    else:
        msg["result"] = result
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def handle(req):
    method, id_ = req.get("method"), req.get("id")
    if method == "initialize":
        v = (req.get("params") or {}).get("protocolVersion", "2025-03-26")
        reply(
            id_,
            {
                "protocolVersion": v if v in SUPPORTED else "2025-03-26",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "graphify", "version": "1.0.0"},
            },
        )
    elif method == "notifications/initialized" or (method or "").startswith("notifications/"):
        return  # notifications: pas de reponse
    elif method == "ping":
        reply(id_, {})
    elif method == "tools/list":
        reply(id_, {"tools": TOOLS})
    elif method == "tools/call":
        params = req.get("params") or {}
        name, args = params.get("name"), params.get("arguments") or {}
        if name == "graphify_explain":
            text, err = run_graphify(["explain", str(args.get("symbol", ""))])
        elif name == "graphify_path":
            text, err = run_graphify(["path", str(args.get("from_symbol", "")), str(args.get("to_symbol", ""))])
        else:
            reply(id_, error={"code": -32602, "message": f"outil inconnu: {name}"})
            return
        reply(id_, {"content": [{"type": "text", "text": text}], "isError": err})
    elif id_ is not None:
        reply(id_, error={"code": -32601, "message": f"methode non supportee: {method}"})


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        try:
            handle(req)
        except Exception as e:  # jamais crasher la boucle
            if isinstance(req, dict) and req.get("id") is not None:
                reply(req["id"], error={"code": -32603, "message": str(e)})


if __name__ == "__main__":
    main()
