import { createStore } from "solid-js/store"
import { createEffect, type Accessor } from "solid-js"
import type { FollowupDraft } from "@/components/prompt-input/submit"
import type { Prompt } from "@/context/prompt"

// Mode Cowork — pipeline gaté generer -> verifier -> valider (Sophie 2026-08-13,
// doc/COWORK-MODE.md). Les 3 etages tournent dans UNE seule session : chaque tour
// porte son propre `agent` et voit les tours precedents en contexte (donc pas
// besoin de repiper la sortie). Le GATE est CODE-enforced : on attend que l'etage
// passe busy puis idle, et on S'ARRETE — jamais on ne compte sur le modele pour
// s'arreter. L'humain est l'autorite : rien n'avance sans un clic.

import { COWORK_STAGE_ORDER, coworkStageLabel, type CoworkStage } from "@/pages/session/cowork/stages"

type Stage = CoworkStage

const STAGE_ORDER = COWORK_STAGE_ORDER

// Etage 1 = la demande de l'utilisateur telle quelle. Etages 2 et 3 = une
// instruction fixe (le contenu a examiner est deja dans la session).
const STAGE_INSTRUCTION: Partial<Record<Stage, string>> = {
  reviewer:
    "Relis le fichier `cowork-doc.md` (le document de travail) et les changements du tour précédent. Lentille FIDÉLITÉ DE SENS : flague les changements qui font dériver le sens (négation, modalité shall/may, partie, montant, date/délai, périmètre). Ne réécris pas, n'approuve pas — remonte à l'humain.",
  validator:
    "Valide le fichier `cowork-doc.md`. Lentille CONFORMITÉ / COMPLÉTUDE (distincte de la fidélité de sens) : la demande est-elle couverte, les éléments obligatoires présents, le format et les règles respectés ? Liste les manques, priorisés. Tu n'es pas l'approbateur — la décision revient à l'humain.",
}

function textPrompt(content: string): Prompt {
  return [{ type: "text", content, start: 0, end: content.length }]
}

type CoworkPipelineDeps = {
  busy: (sessionID: string) => boolean
  blocked: Accessor<boolean>
  sendDraft: (draft: FollowupDraft) => Promise<boolean> | void
  abort: (sessionID: string) => void
}

export type CoworkPipeline = ReturnType<typeof createCoworkPipeline>

export function createCoworkPipeline(deps: CoworkPipelineDeps) {
  const [state, setState] = createStore<{
    stage: Stage | null
    phase: "running" | "gate" | "idle"
    sawBusy: boolean
    sessionID: string | null
    base: FollowupDraft | null
  }>({ stage: null, phase: "idle", sawBusy: false, sessionID: null, base: null })

  const draftForStage = (stage: Stage): FollowupDraft => {
    const base = state.base as FollowupDraft
    if (stage === "composer") return { ...base, agent: "composer" }
    return { ...base, agent: stage, prompt: textPrompt(STAGE_INSTRUCTION[stage] ?? "") }
  }

  const runStage = (stage: Stage) => {
    setState({ stage, phase: "running", sawBusy: false })
    void deps.sendDraft(draftForStage(stage))
  }

  const start = (draft: FollowupDraft) => {
    if (state.phase !== "idle") return
    setState({ sessionID: draft.sessionID, base: draft })
    runStage("composer")
  }

  const next = () => {
    if (state.phase !== "gate" || !state.stage) return
    const nextStage = STAGE_ORDER[STAGE_ORDER.indexOf(state.stage) + 1]
    if (!nextStage) return stop()
    runStage(nextStage)
  }

  const stop = () => {
    const id = state.sessionID
    if (id && state.phase === "running" && deps.busy(id)) deps.abort(id)
    setState({ stage: null, phase: "idle", sawBusy: false, sessionID: null, base: null })
  }

  // Gate code-enforced : busy -> idle => on s'arrete et on montre le gate.
  createEffect(() => {
    const id = state.sessionID
    if (!id || state.phase !== "running") return
    if (deps.busy(id)) {
      if (!state.sawBusy) setState("sawBusy", true)
      return
    }
    if (state.sawBusy && !deps.blocked()) setState("phase", "gate")
  })

  return {
    active: () => state.phase !== "idle",
    awaitingGate: () => state.phase === "gate",
    stageLabel: () => (state.stage ? coworkStageLabel(state.stage) : ""),
    /** L'étage qui suit — pour que le gate dise ce qu'il s'apprête à lancer. */
    nextStage: () => (state.stage ? STAGE_ORDER[STAGE_ORDER.indexOf(state.stage) + 1] : undefined),
    isLast: () => state.stage === "validator",
    start,
    next,
    stop,
  }
}
