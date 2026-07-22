# AGENTS.md — for the agent installing or operating CoeOS

You are an AI coding agent asked to install, verify, or operate CoeOS on this
machine. Everything you need is below. Follow it in order; verify each step
before moving to the next; never claim success without its check passing.

## What you are installing

CoeOS is a **superagent pipeline**, not a server. A task submitted to
`./coeos-run` flows through dedicated agents — triage → [planner] → [grill]
→ executor → [skeptic loop] — each role served by the model proven best on
its competency pair. Two runnable pieces:

1. **The pipeline** (`coeos-run` → `v2/main.py`, pydantic-ai) — runs on the
   host, talks to an OpenAI-compatible engine.
2. **The console** (`console/server.py`, stdlib, port 4800) — a web UI to
   assign each role to a model from the engine's fleet. Optional but the
   normal way to produce `coeos-agents.json`.

## Hard prerequisite — the engine

CoeOS does NOT ship models. It requires an **OpenAI-compatible engine**
already serving the user's fleet:

- `GET  <base>/models` must return the model list
- `POST <base>/chat/completions` must accept standard chat requests

Any of these qualifies: a local pool (MLX, vLLM, Ollama with the OpenAI
compat layer), LiteLLM, a gateway, or a relay to open-weight providers.
Default base: `http://127.0.0.1:8000/v1`. Override everywhere with the
`COEOS_ENGINE_BASE` env var (or `--base` on the console).

**Check FIRST, before installing anything:**

```sh
curl -sf "${COEOS_ENGINE_BASE:-http://127.0.0.1:8000/v1}/models" | head -c 300
```

No answer → STOP. Ask the user where their engine runs. Do not invent a
base URL, do not install an engine on your own initiative.

## Install (exact steps)

```sh
git clone https://github.com/Odyssai-eu/coeos.git && cd coeos
./install.sh          # or: COEOS_ENGINE_BASE=http://host:8000/v1 ./install.sh
```

`install.sh` does, in order: venv at `v2/.venv` → `pip install -r
v2/requirements.txt` (pydantic-ai) → `chmod +x coeos-run` → seeds
`coeos-agents.json` from the example if absent → engine check.

Requires: `python3` ≥ 3.10, `curl`, network access to pypi. No sudo, no
system packages, nothing written outside the repo directory.

## The two data files (contracts)

- **`coeos-roles.json`** — the role manifest: for each role, its competency
  pair (axes) and speed weight. Ships in the repo. Do not edit during install.
- **`coeos-agents.json`** — the role→model assignment for THIS machine's
  fleet. Seeded from `coeos-agents.example.json` (placeholder), meant to be
  regenerated against the real fleet. Two ways:
  - **Console** (preferred): `python3 console/server.py` →
    `http://localhost:4800` → check suggestions per role → export. The
    console computes suggestions from `TMB-Score-Table.json` (published
    benchmark data) × the fleet discovered at `<base>/models`, best
    competency-pair score, speed-weighted for the executor, cost tiebreak.
  - **Manual**: edit `coeos-agents.json`, set `assignment.<role>.model` to a
    model id that `<base>/models` actually lists, and set `"base"` at the
    root of the file to the engine URL.

The example's model ids will NOT exist on the user's engine. **The pipeline
is not operational until `coeos-agents.json` references real fleet models.**
This is the step naive installs miss — do not skip it.

## Verify the install (in this order)

```sh
# 1. venv + deps
v2/.venv/bin/python3 -c "import pydantic_ai; print(pydantic_ai.__version__)"

# 2. engine reachable
curl -sf "${COEOS_ENGINE_BASE:-http://127.0.0.1:8000/v1}/models" >/dev/null && echo engine-ok

# 3. assignment references real models (every assigned model must be in /models)
python3 - <<'EOF'
import json, urllib.request
cfg = json.load(open("coeos-agents.json"))
base = cfg.get("base", "http://127.0.0.1:8000/v1").rstrip("/")
served = {m["id"] for m in json.load(urllib.request.urlopen(base + "/models"))["data"]}
missing = {r: a["model"] for r, a in cfg["assignment"].items()
           if a.get("model") and a["model"].split("/")[-1] not in
           {s.split("/")[-1] for s in served} and a["model"] not in served}
print("missing from fleet:", missing or "none - OK")
EOF

# 4. end-to-end smoke (the real proof)
./coeos-run "write fizzbuzz(20) in python to /tmp/fb.py and prove fizzbuzz(15) == 'FizzBuzz'"
```

The smoke must end with the skeptic accepting and the done-check passing.
If you cannot run step 4 (no assignment yet), say so explicitly — steps 1–3
alone are NOT a completed install.

## Console via Docker (optional)

```sh
docker compose up -d        # console on :4800
```

The compose file mounts the repo at /app (assignment persists on the host)
and defaults the engine to `http://host.docker.internal:8000/v1` — an engine
on the docker host. On Linux without `host.docker.internal`, set
`COEOS_ENGINE_BASE` explicitly. The PIPELINE itself is not containerized by
design: it executes tasks (writes files, runs commands) on the host, next to
the working directory it operates on.

## Failure modes you will actually meet

| Symptom | Cause | Fix |
|---|---|---|
| `curl /models` fails | engine down / wrong base | ask the user for the engine URL; export `COEOS_ENGINE_BASE` |
| pipeline errors `unknown role` | edited `coeos-roles.json` | restore it from git |
| `role without assignment` | role missing in `coeos-agents.json` | re-export from the console (or add the role manually) |
| model errors 404/503 on run | assignment references a model the engine doesn't serve | verify step 3; reassign in the console |
| triage output rejected repeatedly | triage model too weak for structured output | assign a format-reliable model to triage (small instruct models work; this is a format-reliability role, not a reasoning one) |
| executor never writes | task phrasing lacks write intent | phrase the task with an explicit artifact ("write X to path Y") |

## Rules for you, the installing agent

- Never edit `coeos-roles.json`, `agents/*.md`, or anything in `v2/` to make
  an install pass. Install problems are environment problems.
- Never hardcode an engine URL into the code — env/config only.
- `coeos-agents.json` is machine-local state (gitignored). Do not commit it.
- If the engine serves no models fit for a role, report it to the user —
  do not assign a random model to make the console look green.
- The executor is the only role with write access. That restriction is the
  product's safety design. Never grant write tools to other roles.
