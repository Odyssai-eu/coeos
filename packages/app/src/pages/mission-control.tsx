// coeos-code v2 — Mission Control (PLAN.md WU4).
// Vue plein écran trois panneaux : Task File live | agents actifs | transcript.
// Alimentée par le bus SSE global (taskfile.updated, taskrun.*) — les
// événements émis avant le montage sont perdus, par choix (v2). La directory
// portée par chaque événement (e.name) sert à monter le transcript dir-scopé.
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { AgentsPanel } from "./mission-control/agents-panel"
import { createMissionControlState, type MissionRun } from "./mission-control/state"
import { TaskFilePanel } from "./mission-control/task-file-panel"
import { TranscriptPanel, type TranscriptTarget } from "./mission-control/transcript-panel"

export default function MissionControlPage() {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const state = createMissionControlState()

  // Sélection manuelle d'un run (clic) ; sinon on suit le dernier run started.
  const [pinnedKey, setPinnedKey] = createSignal<string>()

  // Horloge partagée pour les durées live des runs « doing ».
  const [now, setNow] = createSignal(Date.now())
  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  // Abonnement SSE global (tous répertoires) : un seul listener couvre les
  // cinq types d'événements et fournit directory + payload d'un coup.
  createEffect(() => {
    const unsubscribe = serverSDK().event.listen((e) => {
      const event = e.details
      switch (event.type) {
        case "taskfile.updated":
          state.applyTaskFile(e.name, event.properties)
          break
        case "taskrun.started":
        case "taskrun.updated":
        case "taskrun.completed":
        case "taskrun.blocked":
          state.applyRun(e.name, event.type, event.properties.run)
          break
        default:
          break
      }
    })
    onCleanup(unsubscribe)
  })

  const runs = createMemo(() => Object.values(state.store.runs))

  // Run actif : la sélection manuelle prime, sinon le dernier run « started »
  // qui possède une session enfant montable.
  const active = createMemo(() => {
    const key = pinnedKey()
    if (key) {
      const pinned = state.store.runs[key] as MissionRun | undefined
      if (pinned) return pinned
    }
    let latest: MissionRun | undefined
    for (const run of runs()) {
      if (!run.childSessionID || run.directory === "global") continue
      if (!latest || run.startedSeq > latest.startedSeq) latest = run
    }
    return latest
  })

  // Cible du transcript, stable tant que (directory, session) ne bouge pas,
  // pour ne pas remonter le SDKProvider à chaque événement taskrun.
  const target = createMemo<TranscriptTarget | undefined>(
    () => {
      const run = active()
      if (!run?.childSessionID || run.directory === "global") return undefined
      return { directory: run.directory, sessionID: run.childSessionID }
    },
    undefined,
    { equals: (a, b) => a?.directory === b?.directory && a?.sessionID === b?.sessionID },
  )

  return (
    <div class="grid w-full flex-1 self-stretch grid-cols-[300px_360px_minmax(0,1fr)] min-h-0 min-w-0 bg-v2-background-bg-deep">
      <TaskFilePanel title={language.t("missionControl.title")} plan={state.store.plan} />
      <AgentsPanel runs={runs()} now={now()} activeKey={active()?.key} onSelect={setPinnedKey} />
      <TranscriptPanel run={active()} target={target()} />
    </div>
  )
}
