import { tool } from "@opencode-ai/plugin"
// coeos-memory-inject — mémoire L1 personnelle : RETRIEVAL local, embedder local.
//
// À chaque tour :
//   - `chat.message` capte le message user et stashe la requête par sessionID ;
//   - `experimental.chat.system.transform` (qui reçoit sessionID au site
//     request.ts:70) lit le stash, récupère le top-k des notes du vault, et
//     pousse un bloc <memory> dans `system[]`.
//
// Retrieval = HYBRIDE, 100 % local, zéro dépendance :
//   - LEXICAL (toujours) : BM25 pur-JS en mémoire sur les notes du vault ;
//   - SÉMANTIQUE (optionnel) : si `embedURL` est configuré (endpoint OpenAI-compat
//     /embeddings LOCAL que l'utilisatrice installe — ollama, llama-server, LM
//     Studio…), on embed les notes (vecteurs cachés dans `.coeos-embeddings.json`)
//     + la requête, cosine pur-JS, et on FUSIONNE lexical+sémantique par RRF.
//   - `embedURL` vide -> sémantique OFF -> pur BM25. L'endpoint injoignable ->
//     fallback BM25 (jamais de chat cassé).
//
// L'injection est ÉPHÉMÈRE (requête sortante), pas une mutation de l'historique.
// Le préfixe stable (identité + wiki `_index.md` via `instructions`) reste
// `system[0]` ; le bloc top-k volatil est appendé après. Le wiki statique reste
// le fallback TOUJOURS présent : rien trouvé -> rien ajouté, le modèle a la carte.
//
// Node ESM pur : PAS de dépendance, PAS de SQLite (le vault perso est petit ->
// BM25 en mémoire + cosine brute-force sur vecteurs cachés = instantané).

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DEFAULTS = {
  vaultDir: "", // injecté par buildCoeosConfig (memoryVaultDir()). Vide -> plugin inerte.
  topK: 5, // nombre de notes injectées
  maxChars: 16000, // cap total du bloc injecté (~4K tokens)
  perNoteChars: 4000, // cap par note
  // --- sémantique (N1b), OPTIONNEL. embedURL vide -> OFF, pur BM25. ---
  embedURL: "", // endpoint /embeddings LOCAL OpenAI-compat (ex http://127.0.0.1:11434/v1/embeddings)
  embedModel: "", // nom du modèle d'embedding (ex nomic-embed-text)
  embedKey: "", // clé si l'endpoint local en exige une (souvent vide en local)
  rrfK: 60, // constante RRF (fusion lexical + sémantique)
  poolSize: 20, // candidats pris de chaque ranker avant fusion
  embedMaxChars: 8000, // cap du texte d'une note envoyé à l'embedder
}

// Tokenisation FR/EN : minuscules, garde lettres accentuées + chiffres (\p{L}\p{N}),
// filtre les mots < 2 chars et une petite liste de stopwords bilingues.
const STOP = new Set(
  (
    "le la les un une des de du et a au aux en dans pour par sur ce cette ces se sa son ses " +
    "je tu il elle on nous vous ils que qui quoi ne pas plus est sont ete avec ou mais donc " +
    "the a an of to and in for on with is are be this that it as at or from by was were has had"
  ).split(" "),
)

function tokenize(text) {
  const out = []
  for (const raw of String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOP.has(raw)) continue
    out.push(raw)
  }
  return out
}

function stripFrontmatter(md) {
  if (md.startsWith("---")) {
    const end = md.indexOf("\n---", 3)
    if (end !== -1) {
      const nl = md.indexOf("\n", end + 1)
      if (nl !== -1) return md.slice(nl + 1)
    }
  }
  return md
}

function noteTitle(md, file) {
  const body = stripFrontmatter(md)
  const h = body.match(/^#\s+(.+)$/m)
  if (h) return h[1].trim()
  const fm = md.match(/^title:\s*(.+)$/m)
  if (fm) return fm[1].replace(/["']/g, "").trim()
  return (file.split("/").pop() || file).replace(/\.md$/i, "")
}

// --- algèbre vecteurs (cosine brute-force) ---
function norm(a) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * a[i]
  return Math.sqrt(s) || 1
}
function dot(a, b) {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

// Appel /embeddings OpenAI-compat. Renvoie un tableau de vecteurs (1 par input)
// ou null en cas d'échec (endpoint absent, HTTP KO, forme inattendue).
async function embedTexts(opts, texts) {
  if (!opts.embedURL || !texts.length) return null
  try {
    const resp = await fetch(opts.embedURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts.embedKey ? { Authorization: `Bearer ${opts.embedKey}` } : {}),
      },
      body: JSON.stringify({ ...(opts.embedModel ? { model: opts.embedModel } : {}), input: texts }),
    })
    if (!resp.ok) return null
    const data = await resp.json()
    const rows = data?.data
    if (!Array.isArray(rows) || rows.length !== texts.length) return null
    const vecs = rows.map((r) => r?.embedding)
    if (vecs.some((v) => !Array.isArray(v) || !v.length)) return null
    return vecs
  } catch {
    return null
  }
}

// Index mémoire : lexical BM25 (toujours) + sémantique optionnel (vecteurs cachés).
// Reconstruit paresseusement quand le vault change (signature mtime+taille).
class MemoryIndex {
  constructor(opts) {
    this.opts = opts
    this.dir = opts.vaultDir
    this.sig = ""
    this.docs = [] // {file, text, len, tf, sig}
    this.df = new Map()
    this.avgdl = 0
    this.vectors = new Map() // file -> {sig, v, n}
    this.vecPath = join(this.dir, ".coeos-embeddings.json")
    this._loadVectors()
  }

  _loadVectors() {
    try {
      const obj = JSON.parse(readFileSync(this.vecPath, "utf8"))
      for (const [f, e] of Object.entries(obj)) {
        if (e && Array.isArray(e.v) && e.v.length) this.vectors.set(f, { sig: e.sig, v: e.v, n: norm(e.v) })
      }
    } catch {
      /* pas de cache -> on (re)construira à la demande */
    }
  }

  _saveVectors() {
    try {
      const obj = {}
      for (const [f, e] of this.vectors) obj[f] = { sig: e.sig, v: e.v }
      writeFileSync(this.vecPath, JSON.stringify(obj))
    } catch {
      /* best-effort */
    }
  }

  // Notes .md du vault, en ignorant dotfiles/dotdirs (dont `.coeos-embeddings.json`)
  // et `_index.md` (= le wiki, déjà injecté statiquement ; on n'indexe pas la carte).
  _walk() {
    const out = []
    const rec = (d) => {
      let ents
      try {
        ents = readdirSync(d, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of ents) {
        if (e.name.startsWith(".")) continue
        const p = join(d, e.name)
        if (e.isDirectory()) rec(p)
        else if (e.isFile() && e.name.toLowerCase().endsWith(".md") && e.name !== "_index.md") out.push(p)
      }
    }
    rec(this.dir)
    return out
  }

  ensureFresh() {
    const files = this._walk()
    const stats = new Map()
    let sig = ""
    for (const f of files) {
      try {
        const s = statSync(f)
        const fs = `${s.mtimeMs}:${s.size}`
        stats.set(f, fs)
        sig += `${f}:${fs};`
      } catch {
        /* fichier disparu entre walk et stat : ignoré */
      }
    }
    if (sig === this.sig && this.docs.length) return
    this.sig = sig
    const docs = []
    const df = new Map()
    let totalLen = 0
    for (const f of files) {
      let raw
      try {
        raw = readFileSync(f, "utf8")
      } catch {
        continue
      }
      const toks = tokenize(stripFrontmatter(raw))
      if (!toks.length) continue
      const tf = new Map()
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
      for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
      totalLen += toks.length
      docs.push({ file: f, text: raw, len: toks.length, tf, sig: stats.get(f) ?? "" })
    }
    this.docs = docs
    this.df = df
    this.avgdl = docs.length ? totalLen / docs.length : 0
  }

  _bm25(query, pool) {
    const N = this.docs.length
    const qToks = [...new Set(tokenize(query))]
    if (!qToks.length) return []
    const k1 = 1.5
    const b = 0.75
    const scored = []
    for (const d of this.docs) {
      let score = 0
      for (const t of qToks) {
        const f = d.tf.get(t)
        if (!f) continue
        const n = this.df.get(t) ?? 0
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
        score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * d.len) / this.avgdl))
      }
      if (score > 0) scored.push({ doc: d, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, pool)
  }

  // Embed les notes dont le vecteur manque ou est périmé (batch unique). Persiste.
  async ensureVectors() {
    if (!this.opts.embedURL) return false
    const missing = this.docs.filter((d) => {
      const c = this.vectors.get(d.file)
      return !c || c.sig !== d.sig
    })
    if (missing.length) {
      const texts = missing.map((d) => stripFrontmatter(d.text).slice(0, this.opts.embedMaxChars))
      const vecs = await embedTexts(this.opts, texts)
      if (!vecs) return this.vectors.size > 0 // échec embed : on garde le cache existant
      for (let i = 0; i < missing.length; i++) {
        this.vectors.set(missing[i].file, { sig: missing[i].sig, v: vecs[i], n: norm(vecs[i]) })
      }
    }
    // purge des notes disparues
    const live = new Set(this.docs.map((d) => d.file))
    let changed = missing.length > 0
    for (const f of [...this.vectors.keys()]) {
      if (!live.has(f)) {
        this.vectors.delete(f)
        changed = true
      }
    }
    if (changed) this._saveVectors()
    return this.vectors.size > 0
  }

  async _semantic(query, pool) {
    const qv = await embedTexts(this.opts, [query])
    if (!qv) return null
    const q = qv[0]
    const qn = norm(q)
    const scored = []
    for (const d of this.docs) {
      const c = this.vectors.get(d.file)
      if (!c) continue
      scored.push({ doc: d, score: dot(q, c.v) / (qn * c.n) })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, pool)
  }

  // Reciprocal Rank Fusion de deux listes rankées -> topK.
  _rrf(lists, topK) {
    const k = this.opts.rrfK
    const acc = new Map() // file -> {doc, s}
    for (const list of lists) {
      list.forEach((item, i) => {
        const cur = acc.get(item.doc.file) ?? { doc: item.doc, s: 0 }
        cur.s += 1 / (k + i + 1)
        acc.set(item.doc.file, cur)
      })
    }
    return [...acc.values()].sort((a, b) => b.s - a.s).slice(0, topK)
  }

  async search(query, topK) {
    this.ensureFresh()
    if (!this.docs.length || !tokenize(query).length) return []
    const pool = Math.max(topK, this.opts.poolSize)
    const lexical = this._bm25(query, pool)

    if (!this.opts.embedURL) return lexical.slice(0, topK)
    let semantic = null
    try {
      await this.ensureVectors()
      semantic = await this._semantic(query, pool)
    } catch {
      semantic = null
    }
    if (!semantic || !semantic.length) return lexical.slice(0, topK)
    return this._rrf([lexical, semantic], topK)
  }
}

export default {
  id: "coeos-memory-inject",
  server: async (_input, options) => {
    const opts = { ...DEFAULTS, ...(options ?? {}) }
    if (!opts.vaultDir) return {} // pas de vault -> plugin inerte

    const index = new MemoryIndex(opts)
    const lastQuery = new Map() // sessionID -> texte de la dernière requête user

    return {
      // Pré-tour : mémorise la requête (le dernier message user) par session.
      "chat.message": async (input, output) => {
        const parts = output?.parts ?? []
        const text = parts
          .filter((p) => p?.type === "text" && p.text)
          .map((p) => p.text)
          .join("\n")
          .trim()
        if (input?.sessionID && text) lastQuery.set(input.sessionID, text)
      },

      // Construction de la requête LLM : injecte le top-k pertinent dans le system.
      "experimental.chat.system.transform": async (input, output) => {
        const sid = input?.sessionID
        if (!sid || !output || !Array.isArray(output.system)) return // firing sans sessionID (agent.ts:381) -> skip
        const query = lastQuery.get(sid)
        if (!query) return

        let hits
        try {
          hits = await index.search(query, opts.topK)
        } catch {
          return
        }
        if (!hits || !hits.length) return // rien trouvé -> le wiki statique reste le fallback

        const blocks = []
        let budget = opts.maxChars
        for (const h of hits) {
          const title = noteTitle(h.doc.text, h.doc.file)
          let snippet = stripFrontmatter(h.doc.text).trim()
          if (snippet.length > opts.perNoteChars) snippet = snippet.slice(0, opts.perNoteChars) + "…"
          const block = `### ${title}\n${snippet}`
          if (block.length > budget) break
          budget -= block.length
          blocks.push(block)
        }
        if (!blocks.length) return

        output.system.push(
          "<memory>\n" +
            "Rappels tirés de la mémoire locale de l'utilisatrice, récupérés pour ce message. " +
            "Utilise-les s'ils aident, ignore-les sinon.\n\n" +
            blocks.join("\n\n") +
            "\n</memory>",
        )
      },

      // Outil APPELABLE (agentic RAG) : l'agent memory interroge le vault L1 par
      // pertinence (BM25 + sémantique optionnel), à la demande — distinct de
      // l'auto-inject ci-dessus. Réutilise le MÊME index. Toujours sourcé.
      tool: {
        memory_search: tool({
          description:
            "Recherche dans la mémoire personnelle locale (vault L1) par pertinence. " +
            "Rends des extraits sourcés (titre + fichier). Pour la mémoire perso ; " +
            "les corpus projet/company passent par les MCP rag/graphify.",
          args: {
            query: tool.schema.string().describe("ce qu'on cherche, en langage naturel"),
            limit: tool.schema.number().optional().describe("nombre max d'extraits (défaut 6)"),
          },
          async execute(args) {
            const k = Math.max(1, Math.min(args.limit ?? 6, 20))
            let hits
            try {
              hits = await index.search(args.query, k)
            } catch (e) {
              return { title: "memory_search: erreur", output: "Recherche mémoire impossible: " + (e?.message ?? e) }
            }
            if (!hits || !hits.length) {
              return { title: "memory_search: 0", output: "Aucun résultat dans la mémoire locale pour: " + args.query }
            }
            const parts = hits.map((h) => {
              const title = noteTitle(h.doc.text, h.doc.file)
              let snip = stripFrontmatter(h.doc.text).trim()
              if (snip.length > 700) snip = snip.slice(0, 700) + "…"
              return `### ${title}\n(source: ${h.doc.file} · score ${h.score.toFixed(2)})\n${snip}`
            })
            return {
              title: `memory_search: ${hits.length} extrait(s)`,
              output: parts.join("\n\n"),
              metadata: { count: hits.length, files: hits.map((h) => h.doc.file) },
            }
          },
        }),
      },
    }
  },
}
