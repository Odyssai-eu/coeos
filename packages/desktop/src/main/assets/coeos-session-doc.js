// codeos-session-doc — plugin v1 coeos-code (chargé via OPENCODE_CONFIG_CONTENT).
// À chaque session.idle d'une session RACINE "significative" (>= minMessages),
// (re)génère <projet>/docs/sessions/SESSION-<date>-<id>.md au format
// Done / Difficulties / To-do (points Fibonacci), via CoeOS en direct.
// Node ESM pur : pas de Bun, pas de dépendance. Ne mute JAMAIS la session (anti-boucle).

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const DEFAULTS = {
  minMessages: 6, // seuil de "session significative" (messages user+assistant)
  minNewMessages: 4, // ne régénère que si >= N nouveaux messages depuis la dernière doc
  baseURL: "", // injecté par buildCoeosConfig (engine résolu, zéro hardcode). Vide -> no-op.
  model: "", // injecté par buildCoeosConfig (le routeur). Vide -> plugin inerte.
  apiKey: "dummy",
  maxTranscriptChars: 60000, // on garde la FIN du transcript si dépassement
  subdir: "docs/sessions",
  memoryFile: ".nemo/MEMORY.md", // mémoire persistante par projet (chargée via instructions)
  memoryMaxLines: 80,
}

const SYSTEM_PROMPT = `Tu rédiges le document de session coeos-code pour le travail ci-dessous,
format OdyssAI strict, en français, technique et direct, sans flatterie ni emojis :
## Done — N points
- [pts] réalisations concrètes, avec fichiers/commits cités
## Difficulties
- murs rencontrés, fausses pistes, leçons
## To do — N points
1. [pts] prochaines étapes ordonnées
## Metrics
- totaux de points, commits, décisions clés
Points en Fibonacci (1,2,3,5,8,13,21), JAMAIS d'estimation en temps.
Cite verbatim les phrases importantes de l'utilisatrice. Réponds UNIQUEMENT par le markdown du document.`

const MEMORY_PROMPT = `Tu maintiens la MÉMOIRE PERSISTANTE d'un projet de code : les leçons
durables qu'un agent doit connaître à la PROCHAINE session sur ce dépôt. On te donne la
mémoire actuelle et le transcript d'une session. Rends la mémoire MISE À JOUR, complète
(elle REMPLACE l'ancienne) :
- Conserve les entrées encore vraies, corrige/supprime les périmées, fusionne les doublons.
- Ajoute UNIQUEMENT des faits durables et actionnables découverts dans la session :
  gotchas (ex: "le schéma v1 ignore le texte inline dans instructions"), commandes
  vérifiées, conventions du dépôt, pièges d'environnement, décisions d'architecture.
- EXCLUS : le narratif de session, les tâches ponctuelles, tout ce qui est déjà évident
  en lisant le code.
- Format : "# Mémoire projet" puis des puces denses "- fait — pourquoi ça compte".
- MAXIMUM {MAX} lignes. Réponds UNIQUEMENT par le markdown du fichier.`

export default {
  id: "codeos-session-doc",
  server: async (input, options) => {
    const opts = { ...DEFAULTS, ...(options ?? {}) }
    const documented = new Map() // sessionID -> nb de messages à la dernière génération
    let busy = false

    // Pas d'endpoint résolu, ou pas de modèle injecté -> plugin inerte. Aucun
    // nom de modèle n'est écrit ici : il vient de buildCoeosConfig.
    if (!opts.baseURL || !opts.model) {
      return { event: async () => {} }
    }

    function renderTranscript(messages) {
      const lines = []
      for (const m of messages) {
        const role = m.info?.role ?? "unknown"
        const chunks = []
        for (const p of m.parts ?? []) {
          if (p.type === "text" && p.text) chunks.push(p.text)
          else if (p.type === "tool" && p.tool) chunks.push(`[tool:${p.tool}]`)
        }
        if (chunks.length) lines.push(`${role.toUpperCase()}:\n${chunks.join("\n")}`)
      }
      let text = lines.join("\n---\n")
      if (text.length > opts.maxTranscriptChars)
        text = "[...transcript tronqué...]\n" + text.slice(-opts.maxTranscriptChars)
      return text
    }

    async function generate(sessionID) {
      const session = await input.client.session.get({ path: { id: sessionID } })
      const info = session.data
      if (!info || info.parentID) return // sous-sessions subagents : jamais de doc

      const res = await input.client.session.messages({ path: { id: sessionID } })
      const messages = res.data ?? []
      if (messages.length < opts.minMessages) return
      const last = documented.get(sessionID) ?? 0
      if (messages.length - last < (last === 0 ? 0 : opts.minNewMessages)) return

      const resp = await fetch(`${opts.baseURL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `Titre de session : ${info.title ?? sessionID}\n\nTRANSCRIPT :\n${renderTranscript(messages)}`,
            },
          ],
          temperature: 0.3,
        }),
      })
      if (!resp.ok) throw new Error(`CoeOS ${resp.status}: ${await resp.text().then((t) => t.slice(0, 200))}`)
      const data = await resp.json()
      const body = data?.choices?.[0]?.message?.content
      if (!body) return

      const dir = join(input.directory, opts.subdir)
      await mkdir(dir, { recursive: true })
      const date = new Date(info.time?.created ?? Date.now()).toISOString().slice(0, 10)
      const file = join(dir, `SESSION-${date}-${sessionID.slice(-8)}.md`)
      const header = [
        "---",
        `session: ${sessionID}`,
        `title: ${JSON.stringify(info.title ?? "")}`,
        `updated: ${new Date().toISOString()}`,
        `messages: ${messages.length}`,
        "generator: codeos-session-doc",
        "---",
        "",
      ].join("\n")
      await writeFile(file, header + body + "\n", "utf8")
      documented.set(sessionID, messages.length)

      // Mémoire persistante du projet — best-effort, jamais bloquant pour la doc.
      try {
        await updateMemory(info, messages)
      } catch (e) {
        console.error("[codeos-session-doc] memory:", e?.message ?? e)
      }
    }

    async function updateMemory(info, messages) {
      const memPath = join(input.directory, opts.memoryFile)
      const current = await readFile(memPath, "utf8").catch(() => "")
      const resp = await fetch(`${opts.baseURL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            { role: "system", content: MEMORY_PROMPT.replace("{MAX}", String(opts.memoryMaxLines)) },
            {
              role: "user",
              content: `MÉMOIRE ACTUELLE :\n${current || "(vide)"}\n\nSESSION (${info.title ?? ""}) :\n${renderTranscript(messages)}`,
            },
          ],
          temperature: 0.2,
        }),
      })
      if (!resp.ok) return
      const data = await resp.json()
      let body = data?.choices?.[0]?.message?.content
      if (!body || !body.trim()) return
      // strip d'un éventuel fence markdown englobant
      body = body.trim().replace(/^```(?:markdown)?\n([\s\S]*?)\n```$/m, "$1")
      const lines = body.split("\n").slice(0, opts.memoryMaxLines)
      await mkdir(join(input.directory, ".nemo"), { recursive: true })
      await writeFile(memPath, lines.join("\n") + "\n", "utf8")
    }

    return {
      event: async ({ event }) => {
        if (event.type !== "session.idle") return
        const sessionID = event.properties?.sessionID
        if (!sessionID || busy) return
        busy = true
        try {
          await generate(sessionID)
        } catch (e) {
          console.error("[codeos-session-doc]", e?.message ?? e)
        } finally {
          busy = false
        }
      },
    }
  },
}
