// coeos-code v2 — Mission Control (PLAN.md WU4) : état alimenté par le bus SSE global.
// Les événements arrivent via serverSDK().event.listen — e.name porte la
// directory, e.details le payload typé. On conserve la directory avec chaque
// run : c'est elle qui permet de monter le SDKProvider du transcript.
import { createStore } from "solid-js/store"
import type { TaskFileTask1, TaskRun1 } from "@opencode-ai/sdk/v2"

export type MissionPlan = {
  directory: string
  planSessionID: string
  title: string
  approvedHash?: string
  tasks: TaskFileTask1[]
}

export type MissionRun = {
  /** Clé stable `planSessionID:taskId` — les doublons s'y effondrent naturellement. */
  key: string
  directory: string
  taskId: string
  planSessionID: string
  childSessionID?: string
  role: string
  model?: string
  status: TaskRun1["status"]
  startedAt?: number
  endedAt?: number
  /** Ordre d'arrivée du dernier « started » — pilote l'auto-sélection du transcript. */
  startedSeq: number
}

export type TaskRunEventType = "taskrun.started" | "taskrun.updated" | "taskrun.completed" | "taskrun.blocked"

// Le schéma JSON sérialise parfois les nombres en "NaN"/"Infinity" — on ne garde que le fini.
export const finiteNumber = (value: number | "NaN" | "Infinity" | "-Infinity" | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

export function createMissionControlState() {
  const [store, setStore] = createStore<{
    plan?: MissionPlan
    runs: Record<string, MissionRun>
  }>({ runs: {} })

  let seq = 0

  return {
    store,
    applyTaskFile(
      directory: string,
      properties: { planSessionID: string; title: string; approvedHash?: string; tasks: TaskFileTask1[] },
    ) {
      // Deux plans actifs : le dernier événement reçu gagne, par planSessionID.
      setStore("plan", {
        directory,
        planSessionID: properties.planSessionID,
        title: properties.title,
        approvedHash: properties.approvedHash,
        tasks: properties.tasks,
      })
    },
    applyRun(directory: string, type: TaskRunEventType, run: TaskRun1) {
      const key = `${run.planSessionID}:${run.taskId}`
      const previous = store.runs[key] as MissionRun | undefined
      seq += 1
      setStore("runs", key, {
        key,
        directory,
        taskId: run.taskId,
        planSessionID: run.planSessionID,
        // Un événement partiel (completed sans modèle, etc.) n'efface pas l'acquis.
        childSessionID: run.childSessionID ?? previous?.childSessionID,
        role: run.role || previous?.role || "",
        model: run.model ?? previous?.model,
        status: run.status,
        startedAt: finiteNumber(run.startedAt) ?? previous?.startedAt,
        endedAt: finiteNumber(run.endedAt) ?? previous?.endedAt,
        // Premier contact ou « started » explicite : ce run devient le plus récent.
        startedSeq: type === "taskrun.started" || previous === undefined ? seq : previous.startedSeq,
      })
    },
  }
}

/** Durée compacte `m:ss` (ou `h:mm:ss` au-delà de l'heure). */
export function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number) => value.toString().padStart(2, "0")
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`
  return `${minutes}:${pad(seconds)}`
}
