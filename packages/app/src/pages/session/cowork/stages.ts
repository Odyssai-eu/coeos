// Les trois étages du mode Cowork — source unique. Le pipeline s'en sert pour
// piloter, la timeline pour attribuer chaque tour à sa lentille.
//
// Le point de #47 : les findings du Reviewer et du Validator partaient dans le
// chat comme des tours d'agent ordinaires. « je ne sais pas ce qu'il fait. »
// Trois lentilles distinctes qui se ressemblent à l'écran ne valent pas mieux
// qu'une seule — d'où le libellé ET la lentille, portés par chaque bandeau.

export type CoworkStage = "composer" | "reviewer" | "validator"

export const COWORK_STAGE_ORDER: CoworkStage[] = ["composer", "reviewer", "validator"]

export type CoworkStageMeta = {
  /** Nom de l'étage, tel qu'affiché sur le gate et le bandeau. */
  label: string
  /** Ce que CET étage regarde — ce qui le distingue des deux autres. */
  lens: string
  /** Couleur d'accent (CSS color), pour distinguer les trois d'un coup d'œil. */
  accent: string
}

export const COWORK_STAGES: Record<CoworkStage, CoworkStageMeta> = {
  composer: {
    label: "Composer",
    lens: "drafting — produces the document",
    accent: "#58a6ff",
  },
  reviewer: {
    label: "Reviewer",
    lens: "meaning fidelity — negation, modality, party, amount, date, scope",
    accent: "#d29922",
  },
  validator: {
    label: "Validator",
    lens: "compliance / completeness — request coverage, required items, format",
    accent: "#3fb950",
  },
}

/** Le libellé long du gate, ex. « Composer — drafting ». */
export function coworkStageLabel(stage: CoworkStage): string {
  const meta = COWORK_STAGES[stage]
  return `${meta.label} — ${meta.lens.split(" — ")[0]}`
}

/** Le nom d'agent d'un message est-il un étage cowork ? */
export function coworkStageOf(agent: string | undefined | null): CoworkStage | undefined {
  const name = (agent ?? "").trim().toLowerCase()
  return (COWORK_STAGE_ORDER as string[]).includes(name) ? (name as CoworkStage) : undefined
}
