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
