// Tests du plugin de retrieval mémoire L1 (coeos-memory-inject).
// Pur JS (le plugin l'est aussi) -> .test.mjs, hors périmètre tsgo, exécuté par `bun test`.
// Vault temporaire + serveur d'embed mock (bag-of-words hashé) : aucune dépendance réseau réelle.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createServer } from "node:http"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "./coeos-memory-inject.js"

let vault
let embedServer
let embedURL

// Embedding déterministe : cosine ~ recouvrement lexical (assez pour tester la plomberie).
function mockEmbed(text) {
  const D = 64
  const v = new Array(D).fill(0)
  for (const tok of String(text)
    .toLowerCase()
    .split(/[^a-z0-9àâäéèêëïîôöùûüç]+/)) {
    if (tok.length < 2) continue
    let h = 0
    for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0
    v[h % D] += 1
  }
  return v
}

async function ask(hooks, query, sid = "s" + Math.random()) {
  await hooks["chat.message"]({ sessionID: sid }, { parts: [{ type: "text", text: query }] })
  const system = ["STABLE_PREFIX"]
  await hooks["experimental.chat.system.transform"]({ sessionID: sid, model: {} }, { system })
  return system
}

beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), "nemo-vault-"))
  writeFileSync(
    join(vault, "work.md"),
    "---\ntitle: Style de travail\n---\nStyle court et direct, sans flatterie. Evidence first, cheval mort.",
  )
  writeFileSync(join(vault, "docker.md"), "---\ntitle: Docker\n---\nDocker Desktop, jamais colima, sur tout le reseau.")
  writeFileSync(join(vault, "cook.md"), "---\ntitle: Cuisine\n---\nTomates basilic huile olive, recette simple.")
  // _index.md contient un terme unique -> sert à vérifier qu'il est EXCLU du corpus.
  writeFileSync(join(vault, "_index.md"), "# Index\nINDEXSENTINEL: la carte de la memoire.")

  embedServer = createServer((req, res) => {
    if (req.url.includes("/embeddings")) {
      let b = ""
      req.on("data", (c) => (b += c))
      req.on("end", () => {
        const inp = JSON.parse(b).input
        const arr = Array.isArray(inp) ? inp : [inp]
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ data: arr.map((t, i) => ({ embedding: mockEmbed(t), index: i })) }))
      })
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise((r) => embedServer.listen(0, r))
  embedURL = `http://127.0.0.1:${embedServer.address().port}/embeddings`
})

afterAll(() => {
  embedServer?.close()
  if (vault) rmSync(vault, { recursive: true, force: true })
})

describe("coeos-memory-inject", () => {
  test("BM25 : la note pertinente est injectée, préfixe stable intact", async () => {
    const hooks = await plugin.server({}, { vaultDir: vault, topK: 3 })
    const system = await ask(hooks, "mon style de travail court et direct")
    expect(system.length).toBe(2)
    expect(system[0]).toBe("STABLE_PREFIX")
    expect(system[1]).toContain("Style de travail")
    expect(system[1]).toContain("<memory>")
  })

  test("guard : firing sans sessionID (agent.ts:381) -> pas d'injection", async () => {
    const hooks = await plugin.server({}, { vaultDir: vault })
    const system = ["X"]
    await hooks["experimental.chat.system.transform"]({ model: {} }, { system })
    expect(system.length).toBe(1)
  })

  test("requête sans match -> rien injecté (le wiki reste le fallback)", async () => {
    const hooks = await plugin.server({}, { vaultDir: vault })
    const system = await ask(hooks, "zzxqwv plopfoo nonexistentxyz")
    expect(system.length).toBe(1)
  })

  test("_index.md est exclu du corpus (déjà injecté via instructions)", async () => {
    const hooks = await plugin.server({}, { vaultDir: vault })
    const system = await ask(hooks, "INDEXSENTINEL")
    expect(system.length).toBe(1)
  })

  test("hybride : embedder up -> injection + cache vecteurs écrit", async () => {
    const hooks = await plugin.server({}, { vaultDir: vault, topK: 3, embedURL, embedModel: "mock" })
    const system = await ask(hooks, "mon style de travail")
    expect(system.length).toBe(2)
    expect(existsSync(join(vault, ".coeos-embeddings.json"))).toBe(true)
  })

  test("fallback : embedder mort -> BM25 injecte quand même", async () => {
    const hooks = await plugin.server({}, { vaultDir: vault, topK: 3, embedURL: "http://127.0.0.1:1/embeddings" })
    const system = await ask(hooks, "docker colima reseau")
    expect(system.length).toBe(2)
    expect(system[1]).toContain("Docker")
  })

  test("vaultDir vide -> plugin inerte (aucun hook)", async () => {
    const hooks = await plugin.server({}, {})
    expect(Object.keys(hooks).length).toBe(0)
  })
})
