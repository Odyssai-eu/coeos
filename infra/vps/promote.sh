#!/bin/bash
# Promotion S2.4 : nautilus (build amd64 natif) -> VPS OVH.
# Les bytes testes sur le staging sont les bytes servis en prod : aucun rebuild
# sur le VPS. Build -> smoke staging -> save -> load VPS -> up -> smoke VPS
# (bloquant, via Caddy TLS). Tout echec avant le `up` VPS laisse la prod
# intacte.
#
# Usage :
#   infra/vps/promote.sh              # promeut la version courante du checkout nautilus
#   infra/vps/promote.sh --rollback <tag>   # repointe .env sur un tag deja charge, up
#
# Orchestre depuis la station (ce Mac) via ssh. Prerequis : alias ssh
# `nautilus` et `coeos-vps`, checkout coeos-SE dans ~/coeos-saas sur nautilus.
set -euo pipefail

NAUTILUS=nautilus
VPS=coeos-vps
SAAS_DIR='~/coeos-saas'
VPS_DIR=/opt/coeos
HERE="$(cd -- "$(dirname -- "$0")" && pwd)"

log(){ printf '\n\033[1m== %s\033[0m\n' "$*"; }
die(){ printf '\033[31mx %s\033[0m\n' "$*" >&2; exit 1; }

# ── Rollback ────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--rollback" ]; then
  TAG="${2:?usage: promote.sh --rollback <tag>}"
  log "rollback -> coeos:$TAG"
  ssh "$VPS" "docker image inspect coeos:$TAG >/dev/null 2>&1" \
    || die "image coeos:$TAG absente sur le VPS"
  ssh "$VPS" "cd $VPS_DIR && sed -i 's/^COEOS_TAG=.*/COEOS_TAG=$TAG/' .env && docker compose up -d"
  sleep 5
  curl -sf https://api.coeos.io/health >/dev/null || die "health KO apres rollback"
  log "OK -> rollback sur $TAG, api.coeos.io repond"
  exit 0
fi

# ── 1. Version + tag ────────────────────────────────────────────────────────
log "resolution version"
VERSION=$(ssh "$NAUTILUS" "cd $SAAS_DIR && git pull -q origin main && \
  sed -n 's/^__version__ = \"\\(.*\\)\"/\\1/p' coeos_se/__init__.py")
GITSHA=$(ssh "$NAUTILUS" "cd $SAAS_DIR && git rev-parse --short HEAD")
[ -n "$VERSION" ] && [ -n "$GITSHA" ] || die "version/sha introuvables"
TAG="${VERSION}-${GITSHA}"
echo "  coeos:$TAG"

# ── 2. Build natif amd64 sur nautilus ───────────────────────────────────────
log "build amd64 sur nautilus"
ssh "$NAUTILUS" "cd $SAAS_DIR && docker build -q -t coeos:$TAG ." >/dev/null
ARCH=$(ssh "$NAUTILUS" "docker inspect coeos:$TAG --format '{{.Architecture}}'")
[ "$ARCH" = "amd64" ] || die "image $ARCH, pas amd64 — le VPS ne la lancera pas"

# ── 3. Smoke staging (image fraiche, container jetable) ─────────────────────
log "smoke staging"
ssh "$NAUTILUS" "docker rm -f coeos-promote-check >/dev/null 2>&1 || true
  docker run -d --name coeos-promote-check -p 4699:4600 \
    -e COEOS_CONFIG=/tmp/c.json coeos:$TAG >/dev/null
  sleep 4
  V=\$(curl -sf http://localhost:4699/health | python3 -c 'import sys,json;print(json.load(sys.stdin)[\"version\"])')
  docker rm -f coeos-promote-check >/dev/null
  [ \"\$V\" = \"$VERSION\" ] || { echo bad-version; exit 1; }"
echo "  health $VERSION OK"

# ── 4. Transfert de l'image (pipe via la station, pas de trust nautilus->VPS) ─
log "save nautilus -> load VPS (~280 Mo)"
ssh "$NAUTILUS" "docker save coeos:$TAG" | ssh "$VPS" "docker load" | tail -1

# ── 5. Config VPS : compose + Caddyfile + .env (secrets preserves) ──────────
log "deploiement config VPS"
scp -q "$HERE/docker-compose.yml" "$HERE/Caddyfile" "$VPS:$VPS_DIR/"
# .env : COEOS_TAG epingle ce build ; COEOS_MASTER_KEY genere UNE fois et
# conserve (le coffre S1.2 en depend — le perdre invaliderait les cles).
ssh "$VPS" "cd $VPS_DIR
  touch .env
  grep -q '^COEOS_MASTER_KEY=' .env || \
    echo \"COEOS_MASTER_KEY=\$(python3 -c 'import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())')\" >> .env
  if grep -q '^COEOS_TAG=' .env; then sed -i 's/^COEOS_TAG=.*/COEOS_TAG=$TAG/' .env; else echo 'COEOS_TAG=$TAG' >> .env; fi
  chmod 600 .env"

# ── 5b. Console (plan de controle) : sync des fichiers depuis coeos-agent ────
# La console est du pur stdlib, servie par un container python-slim (pas
# d'image a build). On synchronise ses fichiers depuis le checkout coeos-agent
# de la station. COEOS_AGENT_DIR surcharge le chemin par defaut.
AGENT_DIR="${COEOS_AGENT_DIR:-$HOME/Claude/code/OdyssAI - CoeOS/superagent}"
if [ -d "$AGENT_DIR/console" ]; then
  log "sync console (plan de controle)"
  ssh "$VPS" "mkdir -p $VPS_DIR/console-app/console/images"
  scp -q "$AGENT_DIR/console/server.py" "$AGENT_DIR/console/index.html" \
    "$VPS:$VPS_DIR/console-app/console/"
  scp -q "$AGENT_DIR/console/images/"* "$VPS:$VPS_DIR/console-app/console/images/" 2>/dev/null || true
  scp -q "$AGENT_DIR/compose_agents.py" "$AGENT_DIR/coeos-roles.json" \
    "$AGENT_DIR/TMB-Score-Table.json" "$VPS:$VPS_DIR/console-app/"
else
  echo "  i console non synchronisee (checkout coeos-agent absent: $AGENT_DIR)"
fi

# ── 6. Up + smoke VPS bloquant (via Caddy TLS) ──────────────────────────────
log "up + smoke prod"
ssh "$VPS" "cd $VPS_DIR && docker compose up -d && docker compose restart console 2>/dev/null || true"
sleep 6
for i in 1 2 3 4 5; do
  V=$(curl -sf https://api.coeos.io/health 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("version",""))' 2>/dev/null || true)
  [ "$V" = "$VERSION" ] && break
  sleep 4
done
[ "${V:-}" = "$VERSION" ] || die "api.coeos.io ne sert pas $VERSION (vu: '${V:-rien}') — prod peut-etre KO, verifier"
# contrat sans cle : 401 (auth active) ou 503 (pas de cle) — jamais 200 nu
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST https://api.coeos.io/v1/chat/completions \
  -H 'content-type: application/json' -d '{"model":"coeos","messages":[{"role":"user","content":"x"}],"max_tokens":1}')
echo "  /v1 sans cle -> HTTP $code (401/503 attendu)"

log "OK -> api.coeos.io sert coeos:$TAG (v$VERSION). rollback: promote.sh --rollback <tag-precedent>"
