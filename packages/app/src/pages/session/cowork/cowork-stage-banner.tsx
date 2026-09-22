import { COWORK_STAGES, type CoworkStage } from "@/pages/session/cowork/stages"

/**
 * Bandeau qui ouvre le tour d'un étage cowork dans le chat (#47).
 *
 * Les findings du Reviewer et du Validator restent des tours d'agent normaux —
 * ils continuent de streamer dans le chat, c'est voulu. Ce qui manquait, c'est
 * de savoir QUI parle et AVEC QUELLE LENTILLE. Le bandeau attribue le tour ;
 * il ne reformate pas son contenu (une extraction structurée dépendrait du
 * formatage du modèle, donc casserait).
 */
export function CoworkStageBanner(props: { stage: CoworkStage }) {
  const meta = () => COWORK_STAGES[props.stage]
  return (
    <div
      data-slot="cowork-stage-banner"
      data-stage={props.stage}
      class="mb-2 flex items-baseline gap-2 border-l-2 pl-2.5"
      style={{ "border-color": meta().accent }}
    >
      <span class="text-12-medium" style={{ color: meta().accent }}>
        {meta().label}
      </span>
      <span class="text-11-regular" style={{ color: "var(--v2-text-text-muted)" }}>
        {meta().lens}
      </span>
    </div>
  )
}
