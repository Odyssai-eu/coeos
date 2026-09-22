// coeos-code — résolution de l'engine CoeOS/CoeOS SE SANS hardcode (règle dev OdyssAI).
// Chaîne (chaque palier re-décide) :
//   1. env CODEOS_ENGINE_URL (+CODEOS_ENGINE_TOKEN) — échappatoire / distribution
//   2. provisionné ~/.nemo/pairing.json .engines[] — clés déjà codées (CoeOS SE, "pré-digéré")
//   3. persisté (dernier pair réussi) dans electron-store
//   4. découverte LAN + pair /admin/pair (OdyssAI-x) via enrollSecret provisionné
//   5. rien -> null -> provider dégradé (aucune IP en dur)
// Le secret d'enrôlement et les clés vivent dans ~/.nemo/pairing.json (0600),
// provisionné par-machine comme une clé SSH — RIEN d'extractible n'est embarqué.
import { readFile } from "node:fs/promises"
import { networkInterfaces } from "node:os"
import { join } from "node:path"
import { homedir } from "node:os"
import { randomUUID } from "node:crypto"
import { getStore } from "./store"
import { ENGINE_CLIENT_ID_KEY, ENGINE_TOKEN_KEY, ENGINE_URL_KEY } from "./store-keys"
import { getLocalEngine } from "./windows"
import { normalizeBaseURL } from "./coeos-engines"

export type ResolvedEngine = {
  baseUrl: string // racine, ex. http://engine.lan:8000 (le provider ajoute /v1)
  apiKey: string
  source: "env" | "local" | "provisioned" | "persisted" | "paired"
  // Vrai UNIQUEMENT quand ce lancement vient d'adopter un engine trouvé par
  // le scan LAN (premier lancement, rien de configuré). index.ts le dit à
  // l'utilisatrice : elle doit savoir à quoi Nemo s'est branché.
  adopted?: boolean
}

type ProvisionedEngine = { baseUrl: string; apiKey?: string }
type Provisioned = { enrollSecret?: string; engines?: ProvisionedEngine[] }

const WELL_KNOWN = "/.well-known/inference-engine.json"
const VENDOR = "odyssai.eu"
const PORTS = [8000, 4600] // OdyssAI-x, CoeOS SE
const SCAN_TIMEOUT_MS = 1500
const RESOLVE_BUDGET_MS = 6000 // borne dure : ne jamais figer le lancement

type Logger = { log: (m: string, d?: object) => void; warn: (m: string, d?: unknown) => void }

const trimSlash = (u: string) => u.replace(/\/+$/, "")

async function fetchJson(url: string, timeoutMs: number, init?: RequestInit): Promise<any | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

async function readProvisioned(): Promise<Provisioned> {
  const p = join(homedir(), ".nemo", "pairing.json")
  try {
    return JSON.parse(await readFile(p, "utf8")) as Provisioned
  } catch {
    return {}
  }
}

function stableClientId(): string {
  const store = getStore()
  let id = store.get(ENGINE_CLIENT_ID_KEY) as string | undefined
  if (!id) {
    id = `codeos-${randomUUID()}`
    store.set(ENGINE_CLIENT_ID_KEY, id)
  }
  return id
}

// Sous-réseaux IPv4 privés de l'hôte (RFC1918 only : anti-SSRF).
function getLocalSubnets(): string[] {
  const out = new Set<string>()
  const ifaces = networkInterfaces()
  for (const list of Object.values(ifaces)) {
    for (const ni of list ?? []) {
      if (ni.family !== "IPv4" || ni.internal) continue
      const [a, b] = ni.address.split(".").map(Number)
      const priv = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      if (!priv) continue
      out.add(ni.address.split(".").slice(0, 3).join(".")) // /24
    }
  }
  return [...out]
}

async function probeEngine(ip: string, port: number): Promise<string | null> {
  const meta = await fetchJson(`http://${ip}:${port}${WELL_KNOWN}`, SCAN_TIMEOUT_MS)
  if (meta && meta.vendor === VENDOR) return `http://${ip}:${port}`
  return null
}

// Scan concurrent (cap 64) des /24 x ports. Retourne les racines d'engines OdyssAI.
async function scanForEngines(subnets: string[], logger: Logger): Promise<string[]> {
  const targets: Array<[string, number]> = []
  for (const net of subnets) for (let h = 1; h <= 254; h++) for (const port of PORTS) targets.push([`${net}.${h}`, port])
  const found: string[] = []
  let i = 0
  const worker = async () => {
    while (i < targets.length) {
      const idx = i++
      const [ip, port] = targets[idx]
      const hit = await probeEngine(ip, port)
      if (hit) found.push(hit)
    }
  }
  await Promise.all(Array.from({ length: 64 }, worker))
  logger.log("codeos: scan LAN terminé", { subnets, found })
  // Pick déterministe : port le plus bas (OdyssAI-x=8000) d'abord.
  return found.sort((a, b) => Number(new URL(a).port) - Number(new URL(b).port))
}

// Pairing OdyssAI-x : POST /admin/pair + header d'enrôlement pré-partagé.
async function pair(baseUrl: string, enrollSecret: string, logger: Logger): Promise<ResolvedEngine | null> {
  const body = JSON.stringify({ client_id: stableClientId(), client_name: "coeos-code", user_label: "coeos-code" })
  const res = await fetchJson(`${trimSlash(baseUrl)}/admin/pair`, SCAN_TIMEOUT_MS + 2000, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Codeos-Enroll": enrollSecret },
    body,
  })
  if (!res || !res.token) {
    logger.warn("codeos: /admin/pair refusé ou muet", { baseUrl })
    return null
  }
  return { baseUrl: trimSlash(baseUrl), apiKey: res.token, source: "paired" }
}

async function resolveInner(logger: Logger): Promise<ResolvedEngine | null> {
  // 1. env override — le "no hardcode" canonique (valeur en env, pas en source)
  const envUrl = process.env.CODEOS_ENGINE_URL
  if (envUrl) {
    return { baseUrl: trimSlash(envUrl), apiKey: process.env.CODEOS_ENGINE_TOKEN || "dummy", source: "env" }
  }

  // 2. adresse saisie par l'utilisatrice (Settings > Models). Elle PRIME sur le
  // provisionné : taper une adresse à la main, c'est vouloir celle-là — typiquement
  // sa propre box CoeOS. Vider le champ redonne la main à la résolution normale.
  const local = getLocalEngine()
  if (local.url) {
    return { baseUrl: normalizeBaseURL(local.url), apiKey: local.token || "dummy", source: "local" }
  }

  const prov = await readProvisioned()

  // 3. provisionné explicite (clés déjà codées — CoeOS SE, pré-digéré, zéro handshake)
  const explicit = prov.engines?.find((e) => e.baseUrl)
  if (explicit) {
    // valide best-effort mais n'exige pas la découverte (endpoint déjà connu)
    return { baseUrl: trimSlash(explicit.baseUrl), apiKey: explicit.apiKey || "dummy", source: "provisioned" }
  }

  const store = getStore()

  // 4. persisté (fast-path, health court)
  const persistedUrl = store.get(ENGINE_URL_KEY) as string | undefined
  if (persistedUrl) {
    const meta = await fetchJson(`${trimSlash(persistedUrl)}${WELL_KNOWN}`, SCAN_TIMEOUT_MS)
    if (meta && meta.vendor === VENDOR) {
      return {
        baseUrl: trimSlash(persistedUrl),
        apiKey: (store.get(ENGINE_TOKEN_KEY) as string | undefined) || "dummy",
        source: "persisted",
      }
    }
  }

  // 5. découverte LAN + pair (OdyssAI-x) — UNIQUEMENT pour remplir un slot
  // vide (premier lancement, rien de configuré). Une box déjà persistée n'est
  // JAMAIS remplacée par un inconnu du réseau du moment : sur un Wi-Fi public,
  // n'importe quel hôte répondant vendor=odyssai.eu serait devenu le routeur,
  // et l'aurait été pour toujours (constat 2026-09-19). Box injoignable -> on
  // la garde (palier 6) ; l'adresse se change dans Settings > Providers.
  const subnets = persistedUrl ? [] : getLocalSubnets()
  if (subnets.length) {
    const engines = await scanForEngines(subnets, logger)
    for (const baseUrl of engines) {
      let engine: ResolvedEngine | null
      if (prov.enrollSecret) {
        engine = await pair(baseUrl, prov.enrollSecret, logger)
        if (!engine) engine = { baseUrl, apiKey: "dummy", source: "paired" } // /v1 public (OdyssAI-x)
      } else {
        engine = { baseUrl, apiKey: "dummy", source: "paired" } // pas de secret -> engine public seulement
      }
      if (engine) {
        store.set(ENGINE_URL_KEY, engine.baseUrl)
        store.set(ENGINE_TOKEN_KEY, engine.apiKey)
        return { ...engine, adopted: true }
      }
    }
  }

  // 6. dernier persisté même si health KO (best-effort), sinon rien
  if (persistedUrl) {
    return {
      baseUrl: trimSlash(persistedUrl),
      apiKey: (store.get(ENGINE_TOKEN_KEY) as string | undefined) || "dummy",
      source: "persisted",
    }
  }
  return null
}

// Ce que le démarrage a résolu, pour l'afficher dans Settings > Providers
// (« Connecté à … via … »). null tant que rien n'est résolu.
let resolved: ResolvedEngine | null = null
export function getResolvedEngine(): { baseUrl: string; source: ResolvedEngine["source"] } | null {
  return resolved ? { baseUrl: resolved.baseUrl, source: resolved.source } : null
}

// Borne dure : la résolution ne bloque JAMAIS le lancement au-delà du budget.
export async function resolveEngine(logger: Logger): Promise<ResolvedEngine | null> {
  const timeout = new Promise<null>((res) => setTimeout(() => res(null), RESOLVE_BUDGET_MS))
  try {
    const engine = await Promise.race([resolveInner(logger), timeout])
    resolved = engine
    if (engine) logger.log("codeos: engine résolu", { baseUrl: engine.baseUrl, source: engine.source })
    else logger.warn("codeos: aucun engine — set CODEOS_ENGINE_URL ou provisionner ~/.nemo/pairing.json")
    return engine
  } catch (e) {
    logger.warn("codeos: resolveEngine a échoué", e)
    return null
  }
}
