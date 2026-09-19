// coeos-memory — la mémoire user de Némo : un vault Obsidian LOCAL (markdown).
//
// Principe (décision N0.2 + « comme Hermès / shared-memory ») : un store LOCAL
// et simple, PAS de compile serveur. Le vault est :
//   - importable : on merge les .md d'un vault source (un vault existant est
//     conservé, on AJOUTE les fichiers absents) ;
//   - lu au démarrage : `_index.md` est injecté dans les instructions (le
//     modèle voit la carte de la mémoire) ;
//   - enrichi au fil de l'eau : la capture (extraction LLM en fin de session →
//     écriture de notes + régénération de l'index) est le lot SUIVANT.
//
// Format compatible Companion / shared-memory : frontmatter + catégories
// (decisions/domain/profile/people/projects/relationship/tools…) + `_index.md`.
import { copyFileSync, type Dirent, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, relative } from "node:path"
import { getStore } from "./store"

const VAULT_PATH_KEY = "coeos.memory.vaultPath"
const DEFAULT_DIR = join(homedir(), ".nemo", "memory")

/** Emplacement du vault (surchargable — electron-store). Défaut ~/.nemo/memory. */
export function memoryVaultDir(): string {
  const stored = getStore().get(VAULT_PATH_KEY)
  return typeof stored === "string" && stored.trim() ? stored : DEFAULT_DIR
}

export function setMemoryVaultDir(dir: string): void {
  getStore().set(VAULT_PATH_KEY, dir)
}

// Config de l'embedder du retrieval sémantique (N1b), OPTIONNEL et 100 % LOCAL.
// Endpoint /embeddings OpenAI-compat que l'utilisatrice installe (ollama,
// llama-server, LM Studio…). Vide -> sémantique OFF, retrieval = pur BM25 lexical.
// La mémoire perso ne sort JAMAIS de la machine : l'embedder est local ou rien.
const EMBED_URL_KEY = "coeos.memory.embedURL"
const EMBED_MODEL_KEY = "coeos.memory.embedModel"
const EMBED_KEY_KEY = "coeos.memory.embedKey"

export function memoryEmbedConfig(): { embedURL: string; embedModel: string; embedKey: string } {
  const s = getStore()
  const str = (k: string): string => {
    const v = s.get(k)
    return typeof v === "string" ? v.trim() : ""
  }
  return { embedURL: str(EMBED_URL_KEY), embedModel: str(EMBED_MODEL_KEY), embedKey: str(EMBED_KEY_KEY) }
}

export function setMemoryEmbedConfig(cfg: { embedURL?: string; embedModel?: string; embedKey?: string }): void {
  const s = getStore()
  if (cfg.embedURL !== undefined) s.set(EMBED_URL_KEY, cfg.embedURL.trim())
  if (cfg.embedModel !== undefined) s.set(EMBED_MODEL_KEY, cfg.embedModel.trim())
  if (cfg.embedKey !== undefined) s.set(EMBED_KEY_KEY, cfg.embedKey.trim())
}

export function ensureMemoryVault(): string {
  const dir = memoryVaultDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

/** `_index.md` du vault — la carte injectée au démarrage (peut ne pas exister). */
export function memoryIndexPath(): string {
  return join(memoryVaultDir(), "_index.md")
}

export function hasMemoryIndex(): boolean {
  const p = memoryIndexPath()
  try {
    return existsSync(p) && readFileSync(p, "utf8").trim().length > 0
  } catch {
    return false
  }
}

/** Liste récursive des .md, en ignorant les dotdirs (.obsidian, .trash) et les
 * fichiers cachés. Chemins absolus. */
function listMarkdown(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    let entries: Dirent[]
    try {
      entries = readdirSync(d, { withFileTypes: true }) as Dirent[]
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(p)
    }
  }
  walk(dir)
  return out
}

export type ImportResult = { imported: number; skipped: number; total: number; vault: string }

/** Importe/merge un vault : copie les .md de `sourceDir` dans le vault en
 * préservant l'arborescence relative. Sémantique « on ajoute » : un fichier
 * DÉJÀ présent (même chemin relatif) est CONSERVÉ tel quel (skip) — on ne
 * clobbe jamais la mémoire que Némo a construite. Seuls les fichiers absents
 * sont ajoutés. Réimporter est donc idempotent. */
export function importVault(sourceDir: string): ImportResult {
  const dest = ensureMemoryVault()
  const files = listMarkdown(sourceDir)
  let imported = 0
  let skipped = 0
  for (const src of files) {
    const rel = relative(sourceDir, src)
    if (!rel || rel.startsWith("..")) continue // hors périmètre
    const target = join(dest, rel)
    if (existsSync(target)) {
      skipped++
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(src, target)
    imported++
  }
  return { imported, skipped, total: files.length, vault: dest }
}
