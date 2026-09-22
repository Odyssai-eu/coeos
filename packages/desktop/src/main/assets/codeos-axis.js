// codeos-axis — plugin v1 coeos-code (chargé via OPENCODE_CONFIG_CONTENT).
// Étape 6 du superagent : les agents appellent le modèle virtuel CoeOS et le
// moteur route par requête. Ce plugin porte le hint d'axe par AGENT via le
// hook chat.headers (fusionné APRÈS model.headers — request.ts:134-146) :
// un seul modèle CoeOS au picker, pas d'alias par axe.
//
// Le mapping {agent -> axe} est construit par buildCoeosConfig depuis la
// console superagent (assignment[role].axis, uniquement pour les rôles dont
// le modèle est le routeur). Mapping vide -> plugin inerte. Le header sur un
// modèle concret est ignoré par le moteur (coeos_resolve ne s'applique qu'au
// routeur), mais on ne l'émet que pour les agents du mapping.
//
// Node ESM pur, même forme que codeos-sequencer.js.

const DEFAULTS = {
  header: "x-coeos-axis",
  axes: {}, // {agentName: axisKey} — injecté par buildCoeosConfig
}

export default {
  id: "codeos-axis",
  server: async (_input, options) => {
    const opts = { ...DEFAULTS, ...(options ?? {}) }
    const axes = opts.axes ?? {}
    if (!Object.keys(axes).length) {
      return {} // pas de mapping (console injoignable / rôles non routés) -> inerte
    }
    return {
      "chat.headers": async (input, output) => {
        const axis = axes[input.agent]
        if (axis) output.headers[opts.header] = axis
      },
    }
  },
}
