import { mock } from "bun:test"

// coeos-config tire Electron par sa chaîne d'imports. On coupe avant.
mock.module("./store", () => ({ getStore: () => ({ get: () => undefined, set: () => {}, has: () => false, delete: () => {} }) }))
mock.module("./windows", () => ({ getExtraProviders: () => "", getTriageModel: () => "" }))
mock.module("./coeos-memory", () => ({
  ensureMemoryVault: () => {}, hasMemoryIndex: () => false, memoryEmbedConfig: () => ({}),
  memoryIndexPath: () => "", memoryVaultDir: () => "",
}))

const { describe, expect, test } = await import("bun:test")
const { extraProvidersOf, resolveTriage, ROUTER_PROVIDER } = await import("./coeos-config")

const BLOC = JSON.stringify({
  provider: {
    "odyssai-x": {
      npm: "@ai-sdk/openai-compatible",
      name: "OdyssAI-X",
      options: { baseURL: "http://engine.lan:8000/v1", apiKey: "dummy" },
      models: { "gemma-4-31b-it": { name: "argo_small_96b — gemma4" } },
    },
  },
})

describe("providers collés dans les Settings", () => {
  test("le bloc de Sophie est accepté tel quel", () => {
    const out = extraProvidersOf(BLOC)
    expect(Object.keys(out)).toEqual(["odyssai-x"])
  })

  test("vide n'ajoute rien", () => {
    expect(extraProvidersOf("")).toEqual({})
  })

  // Un bloc cassé ferait rejeter TOUTE la config du sidecar : plus un seul
  // modèle, y compris CoeOS. Il doit être ignoré, pas propagé.
  test("un JSON cassé est ignoré, il ne fait pas tomber le reste", () => {
    expect(extraProvidersOf("{pas du json")).toEqual({})
    expect(extraProvidersOf('{"provider":{"x":{"npm":"a"}}}')).toEqual({})
  })

  test("on ne peut pas remplacer le routeur en silence", () => {
    const homonyme = JSON.stringify({
      provider: { [ROUTER_PROVIDER]: { npm: "n", options: { baseURL: "http://pirate/v1" }, models: { a: {} } } },
    })
    expect(extraProvidersOf(homonyme)).toEqual({})
  })
})

describe("modèle de triage", () => {
  const provider = extraProvidersOf(BLOC)
  const engine = { baseUrl: "https://api.coeos.io", apiKey: "ck_x", source: "provisioned" as const }

  test("un modèle d'un provider collé est appelé sur SON adresse", () => {
    expect(resolveTriage("odyssai-x/gemma-4-31b-it", provider, engine)).toEqual({
      triageModel: "gemma-4-31b-it",
      triageBaseURL: "http://engine.lan:8000/v1",
      triageApiKey: "dummy",
    })
  })

  test("un modèle du routeur passe par l'engine apparié, avec sa clé", () => {
    const r = resolveTriage("coeos/CoeOS", provider, engine)
    expect(r.triageBaseURL).toBe("https://api.coeos.io/v1")
    expect(r.triageApiKey).toBe("ck_x")
  })

  // Le défaut du 2026-08-19 : `dspartha-gemma` écrit en dur, plus servi depuis
  // des jours, 400 à chaque message. Rien ne doit être appelé à l'aveugle.
  test("vide, ou provider disparu, ne produit aucun appel", () => {
    expect(resolveTriage("", provider, engine).triageModel).toBe("")
    expect(resolveTriage("fantome/x", provider, engine).triageModel).toBe("")
    expect(resolveTriage("coeos/CoeOS", provider, null).triageModel).toBe("")
  })
})

// ── Moteurs déclarés (Settings > Providers, 2026-09-19) ──────────────────────
const { enginesFromLegacy, normalizeBaseURL, slugify, validateEngines } = await import("./coeos-engines")
const { engineModelsFromCatalog, engineProviderBlock } = await import("./coeos-config")

describe("moteurs déclarés", () => {
  test("l'URL est ramenée à sa racine, sans /v1 ni slash final", () => {
    expect(normalizeBaseURL("https://api.coeos.io/v1/")).toBe("https://api.coeos.io")
    expect(normalizeBaseURL("http://engine.lan:8000/")).toBe("http://engine.lan:8000")
    expect(normalizeBaseURL("  http://engine.lan:8000/V1 ")).toBe("http://engine.lan:8000")
  })

  test("l'id vient du nom", () => {
    expect(slugify("My OdyssAI-x (LAN)")).toBe("my-odyssai-x-lan")
    const v = validateEngines([{ name: "OdyssAI-x", baseURL: "http://engine.lan:8000/v1", apiKey: "" }])
    expect(v.error).toBe("")
    expect(v.engines).toEqual([{ id: "odyssai-x", name: "OdyssAI-x", baseURL: "http://engine.lan:8000", apiKey: "" }])
  })

  // Le routeur porte l'engine apparié et sa clé : un moteur ne peut pas
  // prendre son id, il le remplacerait en silence.
  test("l'id du routeur est réservé, les doublons refusés, l'URL exigée", () => {
    expect(validateEngines([{ name: "coeos", baseURL: "http://x/" , apiKey: "" }]).error).toContain(ROUTER_PROVIDER)
    expect(
      validateEngines([
        { name: "A", id: "a", baseURL: "http://a", apiKey: "" },
        { name: "B", id: "a", baseURL: "http://b", apiKey: "" },
      ]).error,
    ).toContain("a")
    expect(validateEngines([{ name: "A", baseURL: "engine.lan:8000", apiKey: "" }]).error).toContain("http")
    expect(validateEngines("nope").error).not.toBe("")
  })

  // Le textarea JSON d'avant : ses entrées deviennent des moteurs, les
  // modèles tapés à la main sont abandonnés (redécouverts sur /v1/models).
  test("le bloc JSON legacy migre vers la liste", () => {
    expect(enginesFromLegacy(BLOC)).toEqual([
      { id: "odyssai-x", name: "OdyssAI-X", baseURL: "http://engine.lan:8000", apiKey: "" },
    ])
    expect(enginesFromLegacy("")).toEqual([])
    expect(enginesFromLegacy("{pas du json")).toEqual([])
    const pirate = JSON.stringify({ provider: { coeos: { options: { baseURL: "http://pirate" }, models: { a: {} } } } })
    expect(enginesFromLegacy(pirate)).toEqual([])
  })

  test("un moteur expose TOUT ce que /v1/models publie, enrichi", () => {
    const models = engineModelsFromCatalog([
      { id: "gemma-4-31b-it", context: 131072, output: 8192, tools: true },
      { id: "or:kimi-k3" },
      { id: "no-tools", tools: false },
    ])
    expect(Object.keys(models)).toEqual(["gemma-4-31b-it", "or:kimi-k3", "no-tools"])
    expect(models["gemma-4-31b-it"].limit).toEqual({ context: 131072, output: 8192 })
    expect(models["or:kimi-k3"].name).toBe("Kimi K3")
    expect(models["no-tools"].tool_call).toBe(false)
    expect("tool_call" in models["gemma-4-31b-it"]).toBe(false)
  })

  test("le bloc provider d'un moteur ajoute /v1 et une clé factice si absente", () => {
    const block = engineProviderBlock({ id: "odyssai-x", name: "OdyssAI-x", baseURL: "http://engine.lan:8000", apiKey: "" }, [
      { id: "gemma-4-31b-it" },
    ])
    expect(block.npm).toBe("@ai-sdk/openai-compatible")
    expect(block.options).toEqual({ baseURL: "http://engine.lan:8000/v1", apiKey: "dummy" })
    expect(Object.keys(block.models)).toEqual(["gemma-4-31b-it"])
  })
})
