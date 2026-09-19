// coeos-nemo (2026-09-19) — moteurs déclarés par l'utilisatrice (Settings >
// Providers). Deux familles, un seul contrat :
//   - le ROUTEUR (provider `coeos`, id fixe) : URL/clé dans LOCAL_ENGINE_*,
//     libellé dans ROUTER_NAME_KEY. Une box CoeOS LAN, api.coeos.io ou tout
//     CoeOS sur un VPS — même API, seule l'adresse change.
//   - les MOTEURS SUPPLÉMENTAIRES (ENGINES_KEY) : OdyssAI-x, une autre box,
//     tout serveur OpenAI-compatible qui publie /v1/models. Les modèles ne sont
//     jamais tapés à la main : ils sont découverts au spawn (buildCoeosConfig)
//     et servis depuis le dernier catalogue connu si le moteur dort.
// Ce module ne touche pas au réseau : validation pure + store. La découverte
// vit dans coeos-config.ts (fetchServableModels / testEngine).
import { getStore } from "./store"
import { ENGINES_KEY, EXTRA_PROVIDERS_KEY, ROUTER_NAME_KEY } from "./store-keys"

export type Engine = { id: string; name: string; baseURL: string; apiKey: string }

/** Id réservé au routeur : un moteur ne peut pas le prendre (il remplacerait
 * en silence l'engine apparié et sa clé). Dupliqué de coeos-config
 * ROUTER_PROVIDER pour ne pas créer d'import circulaire. */
export const ROUTER_ID = "coeos"
export const DEFAULT_ROUTER_NAME = "CoeOS box"

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/

/** Racine d'un moteur : sans slash final, sans `/v1` (le provider l'ajoute).
 * `https://api.coeos.io/v1/` et `https://api.coeos.io` sont la même adresse. */
export function normalizeBaseURL(raw: string): string {
  return (raw || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/i, "")
    .replace(/\/+$/, "")
}

/** Id stable dérivé du nom : « My OdyssAI-x » -> `my-odyssai-x`. */
export function slugify(name: string): string {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
}

/** Valide une liste complète (c'est ce que l'UI renvoie à chaque Save).
 * Retourne "" si tout est bon, sinon l'erreur à afficher. */
export function validateEngines(list: unknown): { error: string; engines: Engine[] } {
  if (!Array.isArray(list)) return { error: "Liste de moteurs invalide.", engines: [] }
  const out: Engine[] = []
  const seen = new Set<string>()
  for (const raw of list) {
    const e = raw as Partial<Engine> | null
    const name = (e?.name || "").trim()
    const id = (e?.id || slugify(name)).trim()
    const baseURL = normalizeBaseURL(e?.baseURL || "")
    const apiKey = (e?.apiKey || "").trim()
    if (!name) return { error: "Chaque moteur doit avoir un nom.", engines: [] }
    if (!ID_RE.test(id)) return { error: `${name} : id « ${id} » invalide (a-z, 0-9, - et _).`, engines: [] }
    if (id === ROUTER_ID) return { error: `${name} : l'id « ${ROUTER_ID} » est réservé au routeur.`, engines: [] }
    if (seen.has(id)) return { error: `Deux moteurs portent l'id « ${id} ».`, engines: [] }
    if (!/^https?:\/\/\S+$/i.test(baseURL)) return { error: `${name} : l'URL doit commencer par http:// ou https://.`, engines: [] }
    seen.add(id)
    out.push({ id, name, baseURL, apiKey })
  }
  return { error: "", engines: out }
}

/** Migration du textarea JSON (EXTRA_PROVIDERS_KEY, format opencode) vers la
 * liste structurée. Les modèles tapés à la main sont abandonnés : ils seront
 * redécouverts sur /v1/models. Pure, testable. */
export function enginesFromLegacy(raw: string): Engine[] {
  const text = (raw || "").trim()
  if (!text) return []
  try {
    const provider = (JSON.parse(text) as { provider?: Record<string, unknown> })?.provider
    if (!provider || typeof provider !== "object") return []
    const out: Engine[] = []
    for (const [id, entry] of Object.entries(provider)) {
      const e = entry as { name?: unknown; options?: { baseURL?: unknown; apiKey?: unknown } }
      const baseURL = typeof e?.options?.baseURL === "string" ? e.options.baseURL : ""
      if (!baseURL || id === ROUTER_ID) continue
      out.push({
        id,
        name: typeof e?.name === "string" && e.name.trim() ? e.name.trim() : id,
        baseURL: normalizeBaseURL(baseURL),
        apiKey: typeof e?.options?.apiKey === "string" && e.options.apiKey !== "dummy" ? e.options.apiKey : "",
      })
    }
    return validateEngines(out).engines
  } catch {
    return []
  }
}

/** Les moteurs tels que déclarés. Au premier accès, si l'ancien textarea JSON
 * porte encore quelque chose et qu'aucune liste n'existe, on migre et on
 * efface l'ancien : une seule source de vérité. */
export function getEngines(): Engine[] {
  const store = getStore()
  const stored = store.get(ENGINES_KEY)
  if (Array.isArray(stored)) return validateEngines(stored).engines
  const legacy = store.get(EXTRA_PROVIDERS_KEY)
  if (typeof legacy === "string" && legacy.trim()) {
    const migrated = enginesFromLegacy(legacy)
    store.set(ENGINES_KEY, migrated)
    store.delete(EXTRA_PROVIDERS_KEY as never)
    return migrated
  }
  return []
}

export function setEngines(list: unknown): { error: string; engines: Engine[] } {
  const res = validateEngines(list)
  if (res.error) return res
  const store = getStore()
  if (res.engines.length) store.set(ENGINES_KEY, res.engines)
  else store.delete(ENGINES_KEY as never)
  return res
}

export function getRouterName(): string {
  const v = getStore().get(ROUTER_NAME_KEY)
  return typeof v === "string" && v.trim() ? v.trim() : DEFAULT_ROUTER_NAME
}

export function setRouterName(name: string) {
  const clean = (name || "").trim()
  const store = getStore()
  if (clean && clean !== DEFAULT_ROUTER_NAME) store.set(ROUTER_NAME_KEY, clean)
  else store.delete(ROUTER_NAME_KEY as never)
}
