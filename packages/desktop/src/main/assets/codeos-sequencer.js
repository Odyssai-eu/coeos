// codeos-sequencer — plugin v1 coeos-code (chargé via OPENCODE_CONFIG_CONTENT).
// Porte la discipline de orchestrator.py (le superagent headless) DANS la
// session interactive : la RIGUEUR se decide en CODE, pas en prompt (constat
// répété 2026-07-15 : un triage bien FORME peut encore juger skeptic=false
// sur un done-check explicite — le code garde le dernier mot).
//
// 1. Au premier message d'une session racine, un appel direct (pas le modele
//    de l'agent en cours) classe la tache via le MEME prompt triage.md que le
//    superagent, sur gemma local (fiabilite-format). Echec de parse -> defaut
//    prudent (skeptic+plan+grill+loop=true), jamais un crash.
// 2. Les memes planchers qu'orchestrator.py (_DONE_SIGNALS/_WRITE_SIGNALS,
//    copies verbatim) forcent skeptic (et plan) si la tache le justifie,
//    independamment du jugement du triage.
// 3. Si decision.skeptic est vrai et qu'un outil d'ecriture a tourne, force
//    UN tour /review (jamais choisi par le modele — injecte via POST
//    /session/:id/command, le mecanisme prouve en P0a 2026-07-15) des que la
//    session redevient idle. reviewRequested verrouille l'injection a UNE
//    fois par session (anti-boucle : le tour de review lui-meme redeclenche
//    session.idle a sa fin, sans le garde on boucle a l'infini).
//
// Node ESM pur, meme forme que codeos-session-doc.js. Ne mute jamais l'etat
// d'une AUTRE session ; n'agit jamais sur une sous-session (parentID != null)
// — les subagents (panel, task) restent hors de son ressort.

const DEFAULTS = {
  baseURL: "", // injecté par buildCoeosConfig (engine résolu). Vide -> no-op.
  apiKey: "dummy",
  // Tous trois injectés par buildCoeosConfig depuis Settings. Le triage peut
  // tourner sur un AUTRE provider que le routeur (petit modèle local, choisi
  // pour la fiabilité du format). Vide -> pas de triage, défaut prudent.
  triageModel: "",
  triageBaseURL: "",
  triageApiKey: "dummy",
  reviewCommand: "review",
  reviewAgent: "reviewer",
}

const TRIAGE_SYSTEM_PROMPT = `Tu es le TRIAGE — le premier maillon du superagent CoeOS. Ton UNIQUE rôle :
lire la demande, évaluer sa nature, et prescrire quelles étapes du pipeline
sont nécessaires. Tu ne planifies pas, tu ne codes pas, tu ne vérifies pas.

## Ce que tu décides

- **plan** — un plan explicite est-il nécessaire ? (dès que la tâche touche
  du code existant, plusieurs fichiers, ou a une logique non triviale : oui.)
- **grill** — faut-il griller le plan AVANT exécution ? (oui si : irréversible,
  multi-fichiers, hypothèse forte sur l'existant, ambiguïté possible.)
- **skeptic** — faut-il une vérification adverse APRÈS exécution ? (oui dès
  qu'il y a un critère de correction vérifiable, du code exécutable, ou un
  risque de régression. L'auto-vérification de l'exécuteur ne compte pas.)
- **loop** — faut-il itérer si le sceptique rejette ? (oui pour toute tâche
  où « à peu près juste » ne suffit pas.)

## Règle de prudence

Dans le doute, prescris PLUS de rigueur, pas moins. « trivial » est réservé
aux tâches vraiment sans risque (créer un fichier d'une ligne, renommer,
répondre à une question). Une tâche de code réelle n'est jamais « trivial ».

## Sortie — STRICTE

Réponds avec CE JSON et RIEN d'autre (pas de texte autour, pas de bloc de
code markdown) :

{"complexity": "trivial|standard|hard", "plan": true|false, "grill": true|false, "skeptic": true|false, "loop": true|false, "reason": "une phrase"}`

// Copiees verbatim depuis superagent/v2/main.py (elles-memes copiees
// d'orchestrator.py v1) — meme plancher, deux runtimes.
const DONE_SIGNALS =
  /crit[eè]re de done|done[- ]check|doit\s+(afficher|retourner|passer|imprimer)|assert|\btests?\b|\btester\b|python3?\s+-c|pytest|npm\s+(test|run)|v[eé]rifie(r|z)?\s+que|expected|attendu|s'attend/i
const WRITE_SIGNALS =
  /[eé]cri[stvr]|\bcr[eé]e[rz]?\b|fichier|impl[eé]mente|corrige|modifie|refactor|patch|\.(py|js|jsx|ts|tsx|sh|json|ya?ml|md|html|css|swift|rs|go|c|cpp|java)\b/i

const WRITE_TOOLS = new Set(["write", "edit", "apply_patch", "patch"])

function extractText(parts) {
  return (parts ?? [])
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join("\n")
}

function parseDecision(raw) {
  const match = raw.match(/\{[\s\S]*\}/)
  try {
    const d = JSON.parse(match ? match[0] : raw)
    return {
      complexity: d.complexity ?? "standard",
      plan: d.plan !== false,
      grill: !!d.grill,
      skeptic: d.skeptic !== false,
      loop: d.loop !== false,
      reason: d.reason ?? "",
    }
  } catch {
    // triage muet / non-JSON -> défaut PRUDENT : tout le pipeline (même
    // filet qu'orchestrator.py parse_decision).
    return { complexity: "hard", plan: true, grill: true, skeptic: true, loop: true,
             reason: "triage illisible -> prudence" }
  }
}

function applyFloors(dec, task) {
  const floors = []
  if (!dec.skeptic) {
    if (DONE_SIGNALS.test(task)) {
      dec.skeptic = true
      floors.push("sceptique (critère de done détecté)")
    } else if (WRITE_SIGNALS.test(task)) {
      dec.skeptic = true
      floors.push("sceptique (la tâche écrit des fichiers -> vérifier)")
    }
  }
  if (dec.skeptic && !dec.plan) {
    dec.plan = true
    floors.push("plan (vérification exigée -> plan ferme comme référence)")
  }
  if (floors.length) dec.floored = floors
  return dec
}

export default {
  id: "codeos-sequencer",
  server: async (input, options) => {
    const opts = { ...DEFAULTS, ...(options ?? {}) }
    const state = new Map() // sessionID -> {decision, wrote, reviewRequested}

    if (!opts.baseURL) {
      return { event: async () => {} } // engine non apparié -> plugin inerte
    }

    async function isRootSession(sessionID) {
      try {
        const res = await input.client.session.get({ path: { id: sessionID } })
        return !res.data?.parentID
      } catch {
        return false // session introuvable/sous-session incertaine -> ne pas agir
      }
    }

    async function triage(taskText) {
      const resp = await fetch(`${opts.triageBaseURL || opts.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.triageApiKey || opts.apiKey}`,
        },
        body: JSON.stringify({
          model: opts.triageModel,
          messages: [
            { role: "system", content: TRIAGE_SYSTEM_PROMPT },
            { role: "user", content: taskText },
          ],
          temperature: 0,
        }),
      })
      if (!resp.ok) throw new Error(`triage HTTP ${resp.status}`)
      const data = await resp.json()
      const raw = data?.choices?.[0]?.message?.content ?? ""
      return applyFloors(parseDecision(raw), taskText)
    }

    async function forceReview(sessionID) {
      // Le mécanisme prouvé en P0a (2026-07-15) : POST /session/:id/command
      // injecte un nouveau tour, indépendamment de ce que le modèle a
      // demandé. serverUrl est fourni par le runtime plugin (PluginInput).
      const url = new URL(`/session/${sessionID}/command`, input.serverUrl)
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: opts.reviewCommand, agent: opts.reviewAgent, arguments: "" }),
      })
      if (!resp.ok) throw new Error(`command HTTP ${resp.status}: ${await resp.text().then((t) => t.slice(0, 200))}`)
    }

    return {
      "chat.message": async (input_, output) => {
        const sessionID = input_.sessionID
        if (!sessionID || state.has(sessionID)) return // triage = UNE fois par session
        if (!(await isRootSession(sessionID))) return // jamais sur une sous-session
        const taskText = extractText(output.parts)
        if (!taskText.trim()) return
        state.set(sessionID, { decision: null, wrote: false, reviewRequested: false }) // pose le verrou AVANT l'appel réseau
        // Aucun modèle de triage choisi (Settings) -> on ne sonde pas : défaut
        // prudent, exactement comme un triage illisible. Mieux vaut ça qu'un
        // appel à un modèle écrit en dur qui a disparu du catalogue.
        if (!opts.triageModel) {
          state.get(sessionID).decision = applyFloors(
            { complexity: "hard", plan: true, grill: true, skeptic: true, loop: true,
              reason: "aucun modèle de triage configuré -> prudence" },
            taskText,
          )
          return
        }
        try {
          const decision = await triage(taskText)
          state.get(sessionID).decision = decision
        } catch (e) {
          console.error("[codeos-sequencer] triage:", e?.message ?? e)
          state.get(sessionID).decision = applyFloors(
            { complexity: "hard", plan: true, grill: true, skeptic: true, loop: true, reason: "triage indisponible -> prudence" },
            taskText,
          )
        }
      },
      "tool.execute.after": async (input_) => {
        const s = state.get(input_.sessionID)
        if (!s || !WRITE_TOOLS.has(input_.tool)) return
        s.wrote = true
      },
      event: async ({ event }) => {
        if (event.type !== "session.idle") return
        const sessionID = event.properties?.sessionID
        const s = sessionID && state.get(sessionID)
        if (!s || !s.decision) return
        if (!s.decision.skeptic || !s.wrote || s.reviewRequested) return
        // Verrou anti-boucle : posé de façon optimiste avant l'injection (le
        // tour forcé redéclenche session.idle à sa fin), mais RELÂCHÉ si le
        // POST échoue — sinon un échec réseau gèle la review de la session
        // pour toujours (v2 WU3, round 2 finding 14).
        s.reviewRequested = true
        try {
          await forceReview(sessionID)
        } catch (e) {
          s.reviewRequested = false
          console.error("[codeos-sequencer] forceReview (verrou relâché, retentera au prochain idle):", e?.message ?? e)
        }
      },
    }
  },
}
