// coeos-code v2 — Schedules (PLAN.md WU6, façon Eve).
// Des agents planifiés déclarés en fichiers markdown, cron + agent + prompt :
//
//   ~/.config/opencode/schedules/nightly-review.md
//   ---
//   cron: 0 3 * * *
//   agent: coeos
//   enabled: true
//   ---
//   Passe en revue les commits du jour sur ce repo et écris le rapport…
//
// Périmètre v2 (gate de scope tracé, PLAN.md) : NIVEAU UTILISATEUR SEULEMENT
// (~/.config/opencode/schedules — hors repo, non modifiable par une
// branche/PR). Les schedules repo-level (.opencode/schedules/) ne sont PAS
// implémentés : un fichier de repo peut venir d'une branche tierce, leur
// activation exigera un mécanisme de trust explicite hors repo — branche
// suivante. Le scheduler vit dans le processus serveur : il tourne app
// ouverte (sidecar) ou serveur lancé à la main (`opencode serve`) ; le
// launchd automatique est sorti du scope v2 (bootstrap standalone de la
// config CoeOS non trivial : ensureCodeosAssets/userData, OPENCODE_CONFIG_CONTENT).

import path from "path"
import { Context, Effect, Layer, Schedule as EffectSchedule, Scope } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { Provider } from "@/provider/provider"
import { MessageID } from "@/session/schema"

export interface Entry {
  file: string
  cron: string
  agent: string
  enabled: boolean
  prompt: string
}

export interface Interface {
  readonly list: () => Effect.Effect<Entry[]>
  // exposé pour les tests ; le ticker l'appelle chaque minute
  readonly tick: (now: Date) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AgentSchedules") {}

// Parseur cron 5 champs (minute heure jour-du-mois mois jour-de-semaine).
// Supporte: * , - */n et valeurs simples. Volontairement sans dépendance.
export function cronMatches(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return false
  const values = [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()]
  return fields.every((field, i) => fieldMatches(field, values[i]))
}

function fieldMatches(field: string, value: number): boolean {
  return field.split(",").some((part) => {
    const step = part.match(/^(\*|\d+-\d+)\/(\d+)$/)
    if (step) {
      const n = Number(step[2])
      if (!n) return false
      if (step[1] === "*") return value % n === 0
      const [lo, hi] = step[1].split("-").map(Number)
      return value >= lo && value <= hi && (value - lo) % n === 0
    }
    if (part === "*") return true
    const range = part.match(/^(\d+)-(\d+)$/)
    if (range) return value >= Number(range[1]) && value <= Number(range[2])
    return Number(part) === value
  })
}

export function parseEntry(file: string, raw: string): Entry | undefined {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return undefined
  const meta: Record<string, string> = {}
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+)\s*:\s*(.+)$/)
    if (kv) meta[kv[1]] = kv[2].trim()
  }
  if (!meta.cron) return undefined
  const prompt = match[2].trim()
  if (!prompt) return undefined
  return {
    file,
    cron: meta.cron,
    agent: meta.agent ?? "build",
    enabled: meta.enabled !== "false",
    prompt,
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const sessions = yield* Session.Service
    const promptSvc = yield* SessionPrompt.Service
    const provider = yield* Provider.Service
    const scope = yield* Scope.Scope
    const dir = path.join(Global.Path.config, "schedules")
    // anti double-run : dernière minute déclenchée par fichier
    const lastRun = new Map<string, number>()

    const list = Effect.fn("AgentSchedules.list")(function* () {
      const entries = yield* fsys
        .readDirectoryEntries(dir)
        .pipe(Effect.catch(() => Effect.succeed([] as { name: string }[])))
      const out: Entry[] = []
      for (const item of entries) {
        if (!item.name.endsWith(".md")) continue
        const file = path.join(dir, item.name)
        const raw = yield* fsys.readFileStringSafe(file).pipe(Effect.orDie)
        if (!raw) continue
        const entry = parseEntry(file, raw)
        if (entry) out.push(entry)
      }
      return out
    })

    const fire = Effect.fn("AgentSchedules.fire")(function* (entry: Entry) {
      yield* Effect.logInfo("firing schedule", { file: entry.file, agent: entry.agent })
      const model = yield* provider.defaultModel()
      const session = yield* sessions.create({
        title: `[schedule] ${path.basename(entry.file, ".md")}`,
        agent: entry.agent,
      })
      yield* promptSvc.prompt({
        messageID: MessageID.ascending(),
        sessionID: session.id,
        agent: entry.agent,
        model: { modelID: model.modelID, providerID: model.providerID },
        parts: [{ type: "text", text: entry.prompt }],
      })
    })

    const tick = Effect.fn("AgentSchedules.tick")(function* (now: Date) {
      const minute = Math.floor(now.getTime() / 60_000)
      const entries = yield* list()
      for (const entry of entries) {
        if (!entry.enabled) continue
        if (lastRun.get(entry.file) === minute) continue
        if (!cronMatches(entry.cron, now)) continue
        lastRun.set(entry.file, minute)
        // fork : un run long ne bloque pas le ticker ; échec loggué, jamais fatal
        yield* fire(entry).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("schedule run failed", { file: entry.file, cause: String(cause) }),
          ),
          Effect.forkIn(scope),
        )
      }
    })

    yield* tick(new Date()).pipe(
      Effect.catchCause(() => Effect.void),
      Effect.repeat(EffectSchedule.spaced("30 seconds")),
      Effect.delay("30 seconds"),
      Effect.forkIn(scope),
    )

    return Service.of({ list, tick })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [FSUtil.node, Session.node, SessionPrompt.node, Provider.node],
})

export * as AgentSchedules from "./index"
