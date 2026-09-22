import { Effect } from "effect"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import z from "zod"
import { effectCmd } from "../effect-cmd"

// Le SDK MCP (zod-compat) et le zod du catalog (4.1.8) sont deux instances zod
// v4 distinctes → mismatch d'identité de type sur `inputSchema` qui casse
// l'inférence du callback de registerTool (runtime OK, les deux valident
// pareil). On confine le pont d'identité à UN binding typé et on annote les
// args des handlers à la main — pas de `any` dans la logique métier.
type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean }
type ToolConfig = { title?: string; description?: string; inputSchema?: Record<string, unknown> }
type RegisterTool = (name: string, config: ToolConfig, cb: (args: Record<string, unknown>) => Promise<ToolResult>) => void

type ReviewArgs = { plan: string; context?: string; repo_dir?: string; include_critics?: boolean }
type AskArgs = { question: string; context?: string; repo_dir?: string; include_critics?: boolean }

// coeos-code v2 — serveur MCP natif (PLAN.md MCP, WU1+WU2).
// Sous-commande stdio : Claude Code s'y branche par
//   claude mcp add codeos -- <bin> mcp-serve
// Elle NE boote PAS d'instance opencode : elle proxifie vers le serveur HTTP
// coeos-code déjà configuré (CODEOS_SERVER_URL). Le seul outil de cette itération,
// `panel_review`, fait réviser un plan par le panel à 3 de CoeOS (via /panel,
// hôté par l'agent read-only `panel-host`). Le nom `mcp` est déjà pris par la
// commande client d'auth MCP — d'où `mcp-serve`.

const SERVER_URL = () => process.env.CODEOS_SERVER_URL ?? "http://127.0.0.1:4096"
const SERVER_PASSWORD = () => process.env.CODEOS_SERVER_PASSWORD
const SERVER_USERNAME = () => process.env.CODEOS_SERVER_USERNAME ?? "opencode"

function authHeader(): Record<string, string> {
  const password = SERVER_PASSWORD()
  if (!password) return {}
  const token = Buffer.from(`${SERVER_USERNAME()}:${password}`).toString("base64")
  return { authorization: `Basic ${token}` }
}

function isConnRefused(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${(err.cause as Error)?.message ?? ""}` : String(err)
  return /ECONNREFUSED|fetch failed|Unable to connect|ENOTFOUND|EHOSTUNREACH|network|socket/i.test(msg)
}

const RETRY_DELAYS_MS = [5_000, 10_000, 20_000]

// F7 / N3 : retry/backoff sur le serveur down, puis erreur claire — jamais de
// spinner infini qui gèle le tool call côté hôte MCP.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!isConnRefused(err) || attempt === RETRY_DELAYS_MS.length) break
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
    }
  }
  throw new Error(
    `coeos-code server unreachable at ${SERVER_URL()} after ${RETRY_DELAYS_MS.length + 1} attempts. ` +
      `Start it (opencode serve --port 4096) or set CODEOS_SERVER_URL. Cause: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
  )
}

function withDir(path: string, dir?: string): string {
  const base = `${SERVER_URL()}${path}`
  if (!dir) return base
  const sep = base.includes("?") ? "&" : "?"
  return `${base}${sep}directory=${encodeURIComponent(dir)}`
}

async function api<T>(method: string, path: string, dir?: string, body?: unknown): Promise<T> {
  return withRetry(async () => {
    // Pas de timeout : /command est SYNCHRONE — le serveur ne renvoie les
    // headers qu'à la fin du run du panel (3 agents), ce qui dépasse largement
    // le défaut fetch. Bun accepte `timeout: false` (le SDK v2 fait pareil).
    const init = {
      method,
      headers: { "content-type": "application/json", ...authHeader() },
      body: body === undefined ? undefined : JSON.stringify(body),
      timeout: false,
    } as RequestInit
    const res = await fetch(withDir(path, dir), init)
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`coeos-code ${method} ${path} -> HTTP ${res.status} ${text.slice(0, 300)}`)
    }
    return (await res.json()) as T
  })
}

type Part = { type: string; text?: string; state?: { status?: string } }
type Message = { info?: { role?: string; time?: { completed?: number } }; parts?: Part[] }
type SessionInfo = { id: string; agent?: string; title?: string }

const VERDICT_RE = /^VERDICT:\s*(APPROVED|REVISE)\b/im

function lastText(parts: Part[] | undefined): string {
  const texts = (parts ?? []).filter((p) => p.type === "text" && p.text)
  return texts.length ? (texts[texts.length - 1].text as string) : ""
}

const FORMAT_INSTRUCTION = [
  "",
  "---",
  "IMPÉRATIF DE FORMAT : après ta synthèse, termine par EXACTEMENT une ligne :",
  "`VERDICT: APPROVED` (aucune faille bloquante — les reviewers convergent)",
  "ou `VERDICT: REVISE` suivie de la liste numérotée des points bloquants.",
].join("\n")

// Deux instruments, deux hôtes (décision Sophie 2026-07-23) :
// - grill_review -> grill-host : @grill-reviewer (modèle grill, MiniMax
//   cross-modèle) + @sceptique (modèle sceptique, routé score-table). Le
//   system prompt de grill-host EST le protocole : un simple message suffit.
// - panel_ask -> panel-host : le panel à 3 (command /panel), l'instrument des
//   décisions ouvertes.
async function runReview(input: {
  host: "grill-host" | "panel-host"
  reviewers: number
  plan: string
  context?: string
  repoDir?: string
  requireVerdict: boolean
  includeCritics?: boolean
}): Promise<{ text: string; verdict: "APPROVED" | "REVISE" | null; incomplete: boolean }> {
  const session = await api<SessionInfo>("POST", "/session", input.repoDir, {
    title: input.host === "grill-host" ? "MCP grill review" : "MCP panel ask",
    agent: input.host,
  })
  const args = [
    input.context ? `CONTEXTE :\n${input.context}\n` : "",
    `PLAN À RÉVISER :\n${input.plan}`,
    input.requireVerdict ? FORMAT_INSTRUCTION : "",
  ]
    .filter(Boolean)
    .join("\n")

  // Les deux chemins sont SYNCHRONES : la réponse arrive quand la synthèse de
  // l'hôte est finie (donc après le run de tous les reviewers).
  const result =
    input.host === "grill-host"
      ? await api<Message>("POST", `/session/${session.id}/message`, input.repoDir, {
          agent: "grill-host",
          parts: [{ type: "text", text: args }],
        })
      : await api<Message>("POST", `/session/${session.id}/command`, input.repoDir, {
          command: "panel",
          arguments: args,
          agent: "panel-host",
        })
  const synthesis = lastText(result.parts)

  // F2 / N1 : une review incomplète ne doit JAMAIS donner un APPROVED. On
  // exige `reviewers` sessions enfants dont l'assistant a terminé
  // (time.completed). Sinon (reviewer manquant, timeout, erreur) → REVISE.
  let incomplete = false
  try {
    const children = await api<SessionInfo[]>("GET", `/session/${session.id}/children`, input.repoDir)
    if (children.length < input.reviewers) incomplete = true
    else {
      for (const child of children) {
        const msgs = await api<Message[]>("GET", `/session/${child.id}/message`, input.repoDir)
        const done = msgs.some((m) => m.info?.role === "assistant" && m.info?.time?.completed)
        if (!done) {
          incomplete = true
          break
        }
      }
    }
  } catch {
    incomplete = true // impossible de prouver la complétude → prudence
  }

  let critics = ""
  if (input.includeCritics) {
    try {
      const children = await api<SessionInfo[]>("GET", `/session/${session.id}/children`, input.repoDir)
      for (const child of children) {
        const msgs = await api<Message[]>("GET", `/session/${child.id}/message`, input.repoDir)
        const last = lastText(msgs[msgs.length - 1]?.parts)
        if (last) critics += `\n\n### ${child.title ?? child.agent ?? child.id}\n${last}`
      }
    } catch {
      /* best-effort */
    }
  }

  let verdict: "APPROVED" | "REVISE" | null = null
  if (input.requireVerdict) {
    // F1 : le verdict garanti ne dépend PAS du prompt. On lit la synthèse ;
    // pas de VERDICT extractible → REVISE par défaut (jamais un APPROVED
    // supposé). Un panel incomplet écrase tout APPROVED en REVISE.
    const match = synthesis.match(VERDICT_RE)
    verdict = incomplete ? "REVISE" : match ? (match[1].toUpperCase() as "APPROVED" | "REVISE") : "REVISE"
  }

  const text = [
    input.requireVerdict && incomplete ? "> Review incomplète (un reviewer n'a pas abouti) — REVISE forcé.\n" : "",
    synthesis,
    input.requireVerdict && verdict && !VERDICT_RE.test(synthesis) ? `\n\nVERDICT: ${verdict}` : "",
    critics,
  ]
    .filter(Boolean)
    .join("")

  return { text, verdict, incomplete }
}

export const McpServeCommand = effectCmd({
  command: "mcp-serve",
  describe: "serve the coeos-code panel-review MCP over stdio (branch a host with `claude mcp add codeos -- <bin> mcp-serve`)",
  instance: false,
  handler: Effect.fn("Cli.mcpServe")(function* () {
    const server = new McpServer({ name: "codeos", version: "0.5.0" })
    const registerTool = server.registerTool.bind(server) as unknown as RegisterTool

    registerTool(
      "grill_review",
      {
        title: "CoeOS grill review",
        description:
          "Adversarially review an implementation PLAN with the two CoeOS review mandates: the grill (cross-model reviewer — a different model family than the plan's author) and the skeptic (competency-routed red-team mandate). Both explore the repo read-only; the verdict is unanimous: a single line `VERDICT: APPROVED` only if BOTH approve, else `VERDICT: REVISE` with numbered blocking points. An incomplete review (a reviewer that did not finish) is forced to REVISE, never a false APPROVED. Do not put secrets in the plan — it is logged in the coeos-code session store.",
        inputSchema: {
          plan: z.string().describe("The full implementation plan to review (e.g. the contents of PLAN.md)."),
          context: z
            .string()
            .optional()
            .describe("Optional domain context: glossary, ADRs (e.g. CONTEXT.md) the reviewers should hold the plan against."),
          repo_dir: z
            .string()
            .optional()
            .describe("Absolute path of the repo the reviewers should explore read-only. Defaults to the server's worktree."),
          include_critics: z
            .boolean()
            .optional()
            .describe("Append each reviewer's full output below the synthesis."),
        },
      },
      async (args) => {
        const { plan, context, repo_dir, include_critics } = args as ReviewArgs
        try {
          const { text } = await runReview({
            host: "grill-host",
            reviewers: 2,
            plan,
            context,
            repoDir: repo_dir,
            requireVerdict: true,
            includeCritics: include_critics,
          })
          return { content: [{ type: "text" as const, text }] }
        } catch (err) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
          }
        }
      },
    )

    // Variante générique : le panel sur une décision libre, sans contrainte de
    // verdict structuré (renvoie la synthèse brute).
    registerTool(
      "panel_ask",
      {
        title: "CoeOS panel — open decision",
        description:
          "Put an open decision or design question to the CoeOS three-mandate panel and get its synthesized answer (no structured verdict). Read-only.",
        inputSchema: {
          question: z.string().describe("The decision or question to put to the panel."),
          context: z.string().optional().describe("Optional supporting context."),
          repo_dir: z.string().optional().describe("Absolute path of the repo the panel may explore read-only."),
          include_critics: z.boolean().optional().describe("Append each critic's full output."),
        },
      },
      async (args) => {
        const { question, context, repo_dir, include_critics } = args as AskArgs
        try {
          const { text } = await runReview({
            host: "panel-host",
            reviewers: 3,
            plan: question,
            context,
            repoDir: repo_dir,
            requireVerdict: false,
            includeCritics: include_critics,
          })
          return { content: [{ type: "text" as const, text }] }
        } catch (err) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
          }
        }
      },
    )

    // stdio : le serveur reste vivant tant que l'hôte garde stdin ouvert. Il
    // démarre inconditionnellement (tools/list marche même si le serveur coeos-code
    // est momentanément down) — la connexion et son retry vivent dans les tool
    // calls (F7/N3).
    //
    // RACINE DU LEAK (fix 2026-08-01) : le StdioServerTransport du SDK n'écoute
    // que 'data'/'error' sur stdin — il ne détecte PAS l'EOF quand l'hôte MCP
    // (Claude Code) meurt. L'ancien `Effect.never` parquait donc le fiber à vie
    // et le process bun fuyait, reparenté à launchd (~70 Mo pièce — 200+ orphelins
    // = ~15 Go RSS observés). On attend explicitement la fermeture de stdin et on
    // sort.
    yield* Effect.promise(async () => {
      const transport = new StdioServerTransport()
      await server.connect(transport)
      await new Promise<void>((resolve) => {
        const shutdown = () => resolve()
        // Chemin secondaire : EOF stdin. Fiable sous Node, mais bun n'émet PAS
        // 'end'/'close' sur process.stdin de façon fiable (vérifié 2026-08-01) —
        // à lui seul il ne suffit donc pas à empêcher le leak.
        process.stdin.once("end", shutdown)
        process.stdin.once("close", shutdown)
        transport.onclose = shutdown
        // Détecteur robuste (bun + Node) : quand l'hôte MCP (Claude Code) meurt,
        // ce process est reparenté à launchd et process.ppid passe à 1 (c'EST la
        // signature du leak observé). process.ppid est dynamique sous bun — on le
        // sonde et on sort. C'est ce signal qui garantit l'absence de fuite.
        const parent = process.ppid
        const timer = setInterval(() => {
          if (process.ppid !== parent) {
            clearInterval(timer)
            shutdown()
          }
        }, 2000)
        timer.unref?.()
      })
    })
    // L'hôte est parti : le pipe stdio est déjà fermé, aucun finalizer critique.
    // Sortie dure pour garantir qu'aucun process bun ne reste jamais parqué.
    process.exit(0)
  }),
})
