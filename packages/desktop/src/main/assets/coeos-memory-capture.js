// coeos-memory-capture — plugin Némo : construit la MÉMOIRE USER (vault Obsidian
// local) AU FIL DE L'EAU, façon shared-memory / Hermès. À chaque session.idle
// d'une session RACINE significative, extrait via CoeOS les faits DURABLES
// (profil, préférences, décisions, projets, personnes, relations, outils,
// domaine), écrit des notes catégorisées avec frontmatter, et régénère
// `_index.md`. Format compatible Companion/shared-memory (l'index est injecté
// au démarrage par buildCoeosConfig → le modèle relit sa mémoire).
//
// Node ESM pur : pas de Bun, pas de dépendance. Inerte si baseURL ou vaultDir
// absent. Ne mute JAMAIS la session (anti-boucle). Pas de compile serveur
// (décision N0.2) : l'extraction est une passe LLM locale via l'engine résolu.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

const DEFAULTS = {
  minMessages: 6, // seuil de session "significative"
  minNewMessages: 6, // ne recapture qu'après N nouveaux messages
  baseURL: "", // injecté par buildCoeosConfig (engine résolu). Vide -> inerte.
  model: "", // injecté par buildCoeosConfig (le routeur). Vide -> plugin inerte.
  apiKey: "dummy",
  vaultDir: "", // injecté par buildCoeosConfig (memoryVaultDir()). Vide -> inerte.
  maxTranscriptChars: 60000,
  maxItems: 8, // borne d'entrées par session
}

const CATEGORIES = ["profile", "preferences", "decisions", "domain", "projects", "people", "relationship", "tools"]

const SYSTEM_PROMPT = `Tu maintiens la MÉMOIRE PERSONNELLE de l'utilisatrice — un vault Obsidian que
l'assistant relira aux prochaines sessions. À partir du transcript, extrais UNIQUEMENT les
faits DURABLES et personnels : profil, préférences de travail, décisions d'architecture ou
de produit, projets, personnes, relations, outils, domaine.
EXCLUS : le narratif de la session, les tâches ponctuelles, l'éphémère, tout ce qui est déjà
évident. Si la mémoire actuelle (fournie en index) couvre déjà un fait, ne le redonne PAS —
sauf pour le CORRIGER ou l'ENRICHIR (réutilise alors le même slug).
Réponds par un TABLEAU JSON, et RIEN d'autre (pas de texte autour) :
[{"category":"profile|preferences|decisions|domain|projects|people|relationship|tools","slug":"kebab-case-court","title":"Titre court","summary":"une phrase","body":"markdown, 1 à 3 courts paragraphes"}]
Tableau vide [] si rien de durable. Maximum {MAX} entrées. Français.`

export default {
  id: "coeos-memory-capture",
  server: async (input, options) => {
    const opts = { ...DEFAULTS, ...(options ?? {}) }
    const seen = new Map() // sessionID -> nb de messages à la dernière capture
    let busy = false

    // Engine non appairé, vault absent, ou modèle non injecté -> plugin inerte.
    if (!opts.baseURL || !opts.vaultDir || !opts.model) {
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
      if (text.length > opts.maxTranscriptChars) text = "[...tronqué...]\n" + text.slice(-opts.maxTranscriptChars)
      return text
    }

    const fm = (v) => JSON.stringify(String(v ?? ""))

    async function currentIndex() {
      return await readFile(join(opts.vaultDir, "_index.md"), "utf8").catch(() => "")
    }

    async function writeNote(item) {
      const cat = CATEGORIES.includes(item.category) ? item.category : "domain"
      const slug =
        String(item.slug || "")
          .replace(/[^a-z0-9-]/gi, "-")
          .toLowerCase()
          .replace(/^-+|-+$/g, "") || "note"
      const rel = `${cat}/${slug}.md`
      const path = join(opts.vaultDir, rel)
      const header = [
        "---",
        `title: ${fm(item.title || slug)}`,
        `path: ${fm(rel)}`,
        `category: ${cat}`,
        `summary: ${fm(item.summary)}`,
        `updated: ${new Date().toISOString()}`,
        "source: coeos-nemo",
        "---",
        "",
      ].join("\n")
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, header + String(item.body || item.summary || "").trim() + "\n", "utf8")
    }

    // Régénère `_index.md` : la carte lue au démarrage. Scanne toutes les notes
    // (hors _index/_README/dotfiles), lit title+summary du frontmatter.
    async function regenIndex() {
      const rows = []
      const walk = async (dir) => {
        let entries
        try {
          entries = await readdir(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const e of entries) {
          if (e.name.startsWith(".") || e.name.startsWith("_")) continue
          const p = join(dir, e.name)
          if (e.isDirectory()) await walk(p)
          else if (e.name.toLowerCase().endsWith(".md")) {
            const txt = await readFile(p, "utf8").catch(() => "")
            const rel = p.slice(opts.vaultDir.length + 1).replace(/\.md$/i, "")
            const title = (txt.match(/^title:\s*"?(.+?)"?\s*$/m) || [])[1] || rel
            // summary: frontmatter (nos notes) ; sinon 1re ligne de contenu
            // (les notes importées — ex. Companion — n'ont pas ce champ).
            let summary = (txt.match(/^summary:\s*"?(.+?)"?\s*$/m) || [])[1] || ""
            if (!summary) {
              const afterFm = txt.replace(/^---[\s\S]*?---\s*/, "").trim()
              summary = (afterFm.split("\n").find((l) => l.trim() && !l.startsWith("#")) || "").slice(0, 200)
            }
            rows.push({ rel, title, summary })
          }
        }
      }
      await walk(opts.vaultDir)
      rows.sort((a, b) => a.rel.localeCompare(b.rel))
      const table = [
        "# Index",
        "",
        "_Mémoire de Némo — régénérée à chaque capture._",
        "",
        "| Article | Résumé |",
        "|---------|--------|",
        ...rows.map((r) => `| [[${r.rel}]] | ${(r.summary || r.title || "").replace(/\|/g, "\\|")} |`),
      ].join("\n")
      await writeFile(join(opts.vaultDir, "_index.md"), table + "\n", "utf8")
    }

    async function capture(sessionID) {
      const session = await input.client.session.get({ path: { id: sessionID } })
      const info = session.data
      if (!info || info.parentID) return // jamais sur les sous-sessions subagents
      const res = await input.client.session.messages({ path: { id: sessionID } })
      const messages = res.data ?? []
      if (messages.length < opts.minMessages) return
      const last = seen.get(sessionID) ?? 0
      if (messages.length - last < (last === 0 ? 0 : opts.minNewMessages)) return

      const resp = await fetch(`${opts.baseURL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model: opts.model,
          temperature: 0.2,
          messages: [
            { role: "system", content: SYSTEM_PROMPT.replace("{MAX}", String(opts.maxItems)) },
            {
              role: "user",
              content: `MÉMOIRE ACTUELLE (index) :\n${(await currentIndex()) || "(vide)"}\n\nTRANSCRIPT :\n${renderTranscript(messages)}`,
            },
          ],
        }),
      })
      if (!resp.ok) return
      const data = await resp.json()
      const out = data?.choices?.[0]?.message?.content
      if (!out) return
      // Extraire le tableau JSON (fence ```json ... ``` ou premier [ ... ]).
      const fence = out.match(/```(?:json)?\s*([\s\S]*?)```/)
      let raw = fence ? fence[1] : out
      const bracket = raw.indexOf("[")
      const lastBracket = raw.lastIndexOf("]")
      if (bracket >= 0 && lastBracket > bracket) raw = raw.slice(bracket, lastBracket + 1)
      let items
      try {
        items = JSON.parse(raw.trim())
      } catch {
        return
      }
      if (!Array.isArray(items)) return
      let wrote = 0
      for (const it of items.slice(0, opts.maxItems)) {
        if (it && typeof it === "object" && it.slug && (it.body || it.summary)) {
          try {
            await writeNote(it)
            wrote++
          } catch {}
        }
      }
      if (wrote) {
        try {
          await regenIndex()
        } catch {}
      }
      seen.set(sessionID, messages.length)
    }

    return {
      event: async ({ event }) => {
        if (event.type !== "session.idle") return
        const sessionID = event.properties?.sessionID
        if (!sessionID || busy) return
        busy = true
        try {
          await capture(sessionID)
        } catch (e) {
          console.error("[coeos-memory-capture]", e?.message ?? e)
        } finally {
          busy = false
        }
      },
    }
  },
}
