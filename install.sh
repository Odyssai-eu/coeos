#!/bin/sh
# CoeOS — installer. Creates the v2 venv, installs deps, checks the engine.
#   ./install.sh                    # default engine http://127.0.0.1:8000/v1
#   COEOS_ENGINE_BASE=http://host:8000/v1 ./install.sh
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
BASE="${COEOS_ENGINE_BASE:-http://127.0.0.1:8000/v1}"

echo "[coeos] creating venv…"
python3 -m venv "$DIR/v2/.venv"
"$DIR/v2/.venv/bin/pip" install --quiet --upgrade pip
"$DIR/v2/.venv/bin/pip" install --quiet -r "$DIR/v2/requirements.txt"

chmod +x "$DIR/coeos-run"

if [ ! -f "$DIR/coeos-agents.json" ]; then
  cp "$DIR/coeos-agents.example.json" "$DIR/coeos-agents.json"
  echo "[coeos] coeos-agents.json seeded from the example — open the console"
  echo "        (:4800) to compose the assignment against YOUR engine's fleet."
fi

echo "[coeos] checking engine at $BASE …"
if curl -sf "$BASE/models" >/dev/null 2>&1; then
  echo "[coeos] engine OK."
else
  echo "[coeos] WARNING: no OpenAI-compatible engine answered at $BASE"
  echo "        Set COEOS_ENGINE_BASE or start your engine, then re-run the check:"
  echo "        curl $BASE/models"
fi

echo "[coeos] done. Try:  ./coeos-run \"write a fizzbuzz in python and test it\""
echo "[coeos] console:    python3 console/server.py   (http://localhost:4800)"
