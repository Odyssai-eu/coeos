import { afterEach, describe, expect, test } from "bun:test"
import { Permission } from "../../src/permission"

// Mode YOLO (coeos-code) : OPENCODE_YOLO force allow partout, y compris sur les
// rulesets qui denient. Point d'injection = evaluate + disabled (les deux
// fonctions pures que toute la chaîne de permission traverse).

const denyBash = [{ permission: "bash", pattern: "*", action: "deny" as const }]
const denyEdit = [{ permission: "edit", pattern: "*", action: "deny" as const }]

afterEach(() => {
  delete process.env.OPENCODE_YOLO
})

describe("YOLO permission bypass", () => {
  test("OFF : un deny reste un deny (comportement normal)", () => {
    delete process.env.OPENCODE_YOLO
    expect(Permission.evaluate("bash", "rm -rf /", denyBash).action).toBe("deny")
    expect(Permission.disabled(["edit"], denyEdit).has("edit")).toBe(true)
  })

  test('ON ("1") : tout est allow, même un ruleset deny', () => {
    process.env.OPENCODE_YOLO = "1"
    expect(Permission.evaluate("bash", "rm -rf /", denyBash).action).toBe("allow")
    expect(Permission.evaluate("edit", "*", denyEdit).action).toBe("allow")
    // même sans aucun ruleset (défaut normal = "ask") -> allow
    expect(Permission.evaluate("bash", "anything").action).toBe("allow")
  })

  test('ON ("true") : les outils edit/bash ne sont plus retirés au modèle', () => {
    process.env.OPENCODE_YOLO = "true"
    expect(Permission.disabled(["edit", "write", "apply_patch"], denyEdit).size).toBe(0)
  })

  test("valeur inattendue -> OFF (fail-safe : seuls 1/true activent)", () => {
    process.env.OPENCODE_YOLO = "yes"
    expect(Permission.evaluate("bash", "rm -rf /", denyBash).action).toBe("deny")
    process.env.OPENCODE_YOLO = "0"
    expect(Permission.evaluate("bash", "rm -rf /", denyBash).action).toBe("deny")
  })
})
