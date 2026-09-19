# Nemo — the CoeOS client

> A desktop AI operating system for one person. Chat, cowork on documents, code with a
> panel of agents — every model call routed by CoeOS, confidential work kept local.

`macOS · Apple Silicon` · `Signed + notarized .dmg` · `Built on opencode` · `MIT`

**Nemo** is the client of **CoeOS**; the **[CoeOS box](https://github.com/Odyssai-eu/coeos-box)** is
the smart router behind it. Install the app, point it at a CoeOS box or at an
[OdyssAI-X](https://github.com/Odyssai-eu/OdyssAI-X) engine on your network, and every
request is routed to the right model for the task — local when it has to stay local,
cloud when that is the better tool — with the decision shown to you, never hidden.

## Install

Nemo is installed from the `.dmg` only, and runs on **Apple Silicon Macs only** (arm64:
M1 and later). There is no Intel build, no Windows or Linux build, and no App Store or
Homebrew distribution.

1. Download the latest `nemo-mac-arm64.dmg` from **[Releases](../../releases)**.
2. Open it and drag **Nemo** to Applications. The app is signed with a Developer ID and
   notarized by Apple: it opens without Gatekeeper warnings.
3. On first launch macOS asks for **Local Network** access — Nemo needs it to find your
   engine or box. Allow it.
4. Point Nemo at your CoeOS box in **Settings → Providers**: name, URL and API key. A box
   on your network, `https://api.coeos.io`, or any CoeOS on a server all work the same
   way; **Test** shows what the box publishes before you save. Leave the URL empty and
   Nemo looks for a box on its own: an `OdyssAI-X` engine (port 8000) or a CoeOS box
   (port 4600) on the LAN, a provisioned pairing file (`~/.nemo/pairing.json`), or the
   `CODEOS_ENGINE_URL` environment variable. Discovery only fills an empty slot: it
   never replaces a box you already use, and Nemo tells you when it adopts one.
   Nothing is hardcoded in the binary.
5. Add more engines in the same tab: an `OdyssAI-X` engine, a second box, or any
   OpenAI-compatible server. Nemo reads the models each one publishes (`/v1/models`) at
   every start; nothing is typed by hand. Provider changes apply after a restart.

Requirements: macOS on Apple Silicon, and one of the two backends above. Nothing else.

## What you get

| Mode | What it does |
|---|---|
| **Nemo** | The everyday assistant: chat with streaming and visible reasoning, presets and saved prompts, personal memory kept in a local vault. |
| **Cowork** | Work *with* the model on a document: a WYSIWYG editor where the model edits alongside you, with a sentinel agent watching what goes out. |
| **Code** | The coding mode inherited from CodeOS: an orchestrator that plans into a task file, a three-mandate decision panel (direct / alternative / sceptic), an adversarial plan grill by a different model family, executor, reviewer, debugger and explore agents. |

Across all modes:

- **Routing you can see.** A Decisions view shows, turn by turn, which competence axis was
  chosen and which model served it. That transparency is the point of CoeOS.
- **Guardian.** Confidential content is detected and kept on a local model when one is
  available; when it is not, Nemo says so instead of degrading silently.
- **Memory.** A personal memory in a local vault (Markdown, Obsidian-compatible), injected
  at startup, plus read access to project and company corpora when a box provides them.
- **Parser and producer.** Documents in (PDF, Office, via Docling when configured),
  documents out.
- **MCP.** Native MCP client; optional RAG and Docling servers are configured by
  environment (`NEMO_RAG_MCP_URL`, `NEMO_DOCLING_MCP_URL`), never baked in.

## The OdyssAI stack

| Component | Repo | Role |
|---|---|---|
| **OdyssAI-X** | [Odyssai-eu/OdyssAI-X](https://github.com/Odyssai-eu/OdyssAI-X) | The engine: distributed MLX inference on Apple Silicon clusters, OpenAI- and Anthropic-compatible API. |
| **Nemo** | this repo | The CoeOS client. |
| **CoeOS box** | [Odyssai-eu/coeos-box](https://github.com/Odyssai-eu/coeos-box) | The smart router: competence axes, provider table, local-vs-cloud policy. |
| CodeOS | [Odyssai-eu/CodeOS](https://github.com/Odyssai-eu/CodeOS) | A 100 % coding app, a version of opencode that keeps following upstream: planner, coder, reviewer and sceptic on four different models, routed by the CoeOS box. |
| Guardian | [Odyssai-eu/odyssai-guardian](https://github.com/Odyssai-eu/odyssai-guardian) | The PII / confidentiality detector Nemo and the box rely on. |

## Build from source

```bash
bun install
cd packages/desktop && bun run dev            # development app ("Nemo Dev")
```

A signed, notarized release build is produced by `scripts/build-nemo.sh` (reads `VERSION`,
auto-increments `.build-number`, injects both into the bundle, notarizes with Apple and
verifies the result). It needs a Developer ID certificate and an App Store Connect API
key on the build machine; neither is in this repository.

## Built on opencode

Nemo started as a fork of **[opencode](https://github.com/sst/opencode)** (MIT). The agent
runtime, the desktop shell and the tool plumbing are theirs; the modes, agents, routing,
guardian and memory are ours. Nemo has diverged far enough that **upstream opencode
releases are not merged** here. If you want a coding app that keeps following opencode,
use [CodeOS](https://github.com/Odyssai-eu/CodeOS).

## License

**MIT** — see [LICENSE](LICENSE). Copyright © 2025 opencode, © 2026 OdyssAI — Nemo.
