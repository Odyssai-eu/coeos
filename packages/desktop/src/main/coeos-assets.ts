// coeos-code — matérialise les assets embarqués (plugin session-doc, wrapper MCP graphify)
// vers ~/.nemo/ à CHAQUE démarrage (idempotent, écrase : la version app fait foi).
// (~/.codeos = legacy du fork coeos-code, migré une fois — voir migrateLegacyDir.)
// Raison : OPENCODE_CONFIG_CONTENT ne résout pas les chemins relatifs
// (resolveLoadedPlugins n'est pas appelé pour les sources virtuelles) → il faut
// un file:// absolu stable sur la machine où tourne le sidecar.
import { copyFileSync, cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import sessionDocSource from "./assets/coeos-session-doc.js?raw"
import memoryCaptureSource from "./assets/coeos-memory-capture.js?raw"
import memoryInjectSource from "./assets/coeos-memory-inject.js?raw"
import sequencerSource from "./assets/codeos-sequencer.js?raw"
import axisSource from "./assets/codeos-axis.js?raw"
import graphifyMcpSource from "./assets/graphify_mcp.py?raw"
import { CODEOS_RULES } from "./coeos-config"

export type CodeosAssets = {
  sessionDocPluginUrl: string
  memoryCapturePluginUrl: string
  memoryInjectPluginUrl: string
  sequencerPluginUrl: string
  axisPluginUrl: string
  graphifyMcpPath: string
  rulesPath: string
}

// Migration du dossier legacy ~/.codeos (hérité du fork coeos-code) vers ~/.nemo.
// Les assets (plugins, MCP, RULES.md) se recréent tout seuls plus bas ; seuls
// pairing.json (secrets, 0600) et le vault mémoire (données user) doivent être
// repris. On COPIE (jamais move) : si coeos-code est aussi installé, il garde
// son ~/.codeos intact. Ne s'exécute qu'une fois — dès que ~/.nemo existe, no-op.
function migrateLegacyDir(next: string): void {
  if (existsSync(next)) return
  const legacy = join(homedir(), ".codeos")
  if (!existsSync(legacy)) return
  mkdirSync(next, { recursive: true })
  try {
    const pairing = join(legacy, "pairing.json")
    if (existsSync(pairing)) copyFileSync(pairing, join(next, "pairing.json"))
  } catch {
    /* best-effort */
  }
  try {
    const mem = join(legacy, "memory")
    if (existsSync(mem)) cpSync(mem, join(next, "memory"), { recursive: true })
  } catch {
    /* best-effort */
  }
}

export function ensureCodeosAssets(): CodeosAssets {
  const root = join(homedir(), ".nemo")
  migrateLegacyDir(root)
  const pluginDir = join(root, "plugins")
  const mcpDir = join(root, "mcp")
  mkdirSync(pluginDir, { recursive: true })
  mkdirSync(mcpDir, { recursive: true })
  const pluginPath = join(pluginDir, "coeos-session-doc.js")
  writeFileSync(pluginPath, sessionDocSource)
  const memoryCapturePath = join(pluginDir, "coeos-memory-capture.js")
  writeFileSync(memoryCapturePath, memoryCaptureSource)
  const memoryInjectPath = join(pluginDir, "coeos-memory-inject.js")
  writeFileSync(memoryInjectPath, memoryInjectSource)
  const sequencerPath = join(pluginDir, "codeos-sequencer.js")
  writeFileSync(sequencerPath, sequencerSource)
  const axisPath = join(pluginDir, "codeos-axis.js")
  writeFileSync(axisPath, axisSource)
  const graphifyPath = join(mcpDir, "graphify_mcp.py")
  writeFileSync(graphifyPath, graphifyMcpSource)
  // Règles globales : le champ v1 `instructions` n'accepte QUE des chemins/URLs
  // (texte inline silencieusement ignoré — bug corrigé le 2026-07-07).
  const rulesPath = join(root, "RULES.md")
  writeFileSync(rulesPath, CODEOS_RULES)
  return {
    sessionDocPluginUrl: pathToFileURL(pluginPath).href,
    memoryCapturePluginUrl: pathToFileURL(memoryCapturePath).href,
    memoryInjectPluginUrl: pathToFileURL(memoryInjectPath).href,
    sequencerPluginUrl: pathToFileURL(sequencerPath).href,
    axisPluginUrl: pathToFileURL(axisPath).href,
    graphifyMcpPath: graphifyPath,
    rulesPath,
  }
}
