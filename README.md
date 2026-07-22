# CoeOS

**A superagent that reaches the closed frontier with open-weight models — by
routing every competency to the model proven best at it.**

No single model is best at everything. The best coder is not the best legal
writer, planner, or reasoner. CoeOS routes each competency to its proven
specialist and orchestrates a pipeline of dedicated agents around it — so the
aggregate tracks the *envelope* of the best models, at a fraction of frontier
pricing.

Measured on the TMB benchmark (32 tests, 5 suites, 18 skill axes, 30+ model
panel, judged by Opus 4.8 under a hardened protocol):

| # | Model | Global /100 | Cost/test |
|---|---|---|---|
| **1** | **CoeOS v1.3** | **97.2** | **$0.087** |
| 2 | Fable 5 | 96.9 | $0.426 — 4.9× more |
| 3 | Opus 4.8 | 96.0 | $0.141 — 1.6× more |

The residual biases run *against* CoeOS (the judge scores its own answers as a
competitor; the runner-up is missing a test), so this margin is a floor, not a
ceiling.

## How it works

### 1. Competency routing
Each request is classified onto a **pair of skill axes** (pairs don't saturate
where single axes do), then served by the model holding the benchmark record
on that pair. Bindings are **data, not code**: `TMB-Score-Table.json` — model
× axis × {score, cost, tok/s} — regenerated from the benchmark panel, imported
in the console, resolved against *your* fleet.

### 2. A pipeline of dedicated agents

| Role | Function | Tools (restricted) | Competency pair |
|---|---|---|---|
| **triage** | judges complexity, prescribes the flow | — | format-reliable model |
| **planner** | closed, executable plan | read-only | plan_decompo × plan_spec × reasoning |
| **grill** | tightens the plan *before* execution | read-only | plan_judgment × reasoning |
| **skeptic** | attacks the *result* after execution | + bash (verify) | debug × plan_judgment |
| **executor** | applies to the letter, fast | **only role with write** | agent_exec × code_general × speed |

Separation is **structural, not prompt-based**: only the executor can write.
A role cannot exceed its mandate because its tools don't allow it. Adaptivity
comes from the triage (typed `TriageDecision`, pydantic-ai — no brittle JSON
parsing); rigor floors are enforced in code (`apply_floors`): a task carrying
a verifiable done-check always gets the skeptic, whatever the triage judged.

### 3. Hybrid by role
High-frequency execution loops run on **local models** (zero marginal cost);
low-frequency plan/critique steps go to the best model for the job. That mix
is where the 1.6–4.9× cost gap comes from: frontier APIs bill premium tokens
on *every* step, including the ones a cheaper specialist does just as well.

## The judging protocol (why the numbers are trustworthy)

LLM judges fail in two known ways: verdict-writing is inconsistent (same
answer graded differently across runs) and LLM arithmetic is wrong (187/892
totals mismeasured by a previous judge). The TMB protocol removes both:

- the judge scores each grading criterion in isolation — **notes-only**, no
  totals, no prose;
- the harness sums every total **mechanically** in code;
- judge runs at temperature 0, thinking off → deterministic.

When a test bundles several competencies, axes bind to the relevant
**criteria subset**, not the composite (e.g. `creative` = the five creative
criteria of the fiction test, excluding the length-compliance criterion).

## Install

Requires an **OpenAI-compatible engine** serving your model fleet
(`GET /v1/models`, `POST /v1/chat/completions`) — a local pool
(MLX, vLLM, Ollama…), a gateway, or any relay to open-weight providers.

```bash
git clone https://github.com/Odyssai-eu/coeos.git && cd coeos
./install.sh                       # venv + deps + engine check
# COEOS_ENGINE_BASE=http://your-engine:8000/v1 ./install.sh
```

Run a task through the full pipeline:

```bash
./coeos-run "fix the failing test in ./src and prove it passes"
./coeos-run --json "…"             # machine-readable report
```

### The console (:4800)

Assigns each role to a model from your fleet, suggestions computed from the
score table (best competency-pair score, speed-weighted for the executor,
ties broken by cost):

```bash
python3 console/server.py                    # http://localhost:4800
# or, containerized:
docker compose up -d
```

Import a `TMB-Score-Table.json`, review per-role suggestions, override
freely (any servable model is assignable, scored or not), export — the
pipeline reads `coeos-agents.json` on every run.

## Repository layout

```
agents/            role definitions (prompt + tool contract per role)
v2/                the pipeline runtime (pydantic-ai)
console/           assignment console (stdlib, single file)
compose_agents.py  role→model suggestion engine (score table × fleet)
coeos-roles.json   role manifest: competency pair + speed weight per role
coeos-run          entrypoint
TMB-Score-Table.json   published benchmark data (model × axis)
```

## CoeOS SE

Want the one-file taste of this? [CoeOS SE](https://github.com/Odyssai-eu/coeos-SE)
is the Simple Edition: one OpenAI-compatible endpoint, per-request skill
routing over OpenRouter, one `docker compose up`. This repository is the full
system: the multi-agent pipeline, the console, and the benchmark-composed
routing data.

## License

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).
If you run a modified CoeOS as a network service, the AGPL requires you to
offer its source to your users. Commercial licensing: contact
[odyssai.eu](https://odyssai.eu).
