#!/bin/bash
# coeos-code server headless — sessions partagées LAN (MacBook Pro <-> Neo).
# Meme storage que l'app (~/.local/share/opencode) => memes sessions.
# Config CoeOS extraite du meme fichier que l'app desktop (source unique).
#
# RESOLUTION D'ENGINE (fix 2026-08-02) : COEOS_DEFAULT_CONFIG porte un baseURL
# PLACEHOLDER (http://127.0.0.1:1/v1) — c'est buildCoeosConfig, cote desktop,
# qui le resout au pairing. Ce script dumpait la config BRUTE : toute
# generation echouait en "Cannot connect" et opencode retryait a l'infini
# (sessions gelees, jamais d'appel a l'engine). On resout ici comme le
# desktop : CODEOS_ENGINE_URL sinon ~/.codeos/pairing.json (engines[0]).
set -e
REPO="$HOME/Claude/code/OdyssAI-coeos-code"
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
BUN="$(command -v bun)"
# Config générée par un vrai fichier .ts (plus de JS inline dans une double-quote
# bash — l'échappement cassait le parse, cf. codeos-server-config.ts). Provider
# unique OdyssAI-x peuplé live, comme le sidecar de l'app.
export OPENCODE_CONFIG_CONTENT="$("$BUN" run "$REPO/scripts/codeos-server-config.ts")"
cd "$REPO/packages/opencode"
exec "$BUN" run src/index.ts serve --hostname 0.0.0.0 --port 4096
