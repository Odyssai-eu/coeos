#!/bin/sh
# CoeOS — installer. Creates the v2 venv, installs deps, checks the engine.
#   ./install.sh                    # default engine http://127.0.0.1:8000/v1
#   COEOS_ENGINE_BASE=http://host:8000/v1 ./install.sh
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
BASE="${COEOS_ENGINE_BASE:-http://127.0.0.1:8000/v1}"

# pydantic-ai requires Python >= 3.10; macOS system python3 is often 3.9.
# Pick the newest suitable interpreter (override with COEOS_PYTHON).
PY="${COEOS_PYTHON:-}"
if [ -z "$PY" ]; then
  for cand in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$cand" >/dev/null 2>&1 \
       && "$cand" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)'; then
      PY="$cand"; break
    fi
  done
fi
if [ -z "$PY" ]; then
  echo "[coeos] ERROR: no Python >= 3.10 found (tried python3.13..python3.10, python3)."
  echo "        Install one (e.g. brew install python@3.12 / apt install python3.12)"
  echo "        or point COEOS_PYTHON at a suitable interpreter."
  exit 1
fi
echo "[coeos] using $PY ($("$PY" -V 2>&1))"

echo "[coeos] creating venv…"
"$PY" -m venv "$DIR/v2/.venv"
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
