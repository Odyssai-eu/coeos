import { describe, expect, test } from "bun:test"
import { cronMatches, parseEntry } from "../../src/schedule/index"

describe("cronMatches", () => {
  const at = (h: number, m: number, dow = 3, day = 15, month = 7) => new Date(2026, month - 1, day, h, m)
  // 2026-07-15 est un mercredi (dow=3)

  test("exact minute+heure", () => {
    expect(cronMatches("0 3 * * *", at(3, 0))).toBe(true)
    expect(cronMatches("0 3 * * *", at(3, 1))).toBe(false)
    expect(cronMatches("0 3 * * *", at(4, 0))).toBe(false)
  })

  test("wildcard et pas */n", () => {
    expect(cronMatches("*/15 * * * *", at(9, 30))).toBe(true)
    expect(cronMatches("*/15 * * * *", at(9, 20))).toBe(false)
    expect(cronMatches("* * * * *", at(23, 59))).toBe(true)
  })

  test("listes et plages", () => {
    expect(cronMatches("0 9,18 * * *", at(18, 0))).toBe(true)
    expect(cronMatches("0 9-11 * * *", at(10, 0))).toBe(true)
    expect(cronMatches("0 9-11 * * *", at(12, 0))).toBe(false)
  })

  test("jour de semaine", () => {
    expect(cronMatches("0 3 * * 3", new Date(2026, 6, 15, 3, 0))).toBe(true) // mercredi
    expect(cronMatches("0 3 * * 1", new Date(2026, 6, 15, 3, 0))).toBe(false)
  })

  test("expression invalide -> false, jamais de crash", () => {
    expect(cronMatches("pas un cron", at(3, 0))).toBe(false)
    expect(cronMatches("0 3 * *", at(3, 0))).toBe(false)
  })
})

describe("parseEntry", () => {
  test("frontmatter complet", () => {
    const entry = parseEntry("/x/nightly.md", "---\ncron: 0 3 * * *\nagent: coeos\n---\nFais le rapport de nuit.")
    expect(entry).toMatchObject({ cron: "0 3 * * *", agent: "coeos", enabled: true, prompt: "Fais le rapport de nuit." })
  })

  test("agent par défaut build, enabled: false respecté", () => {
    const entry = parseEntry("/x/s.md", "---\ncron: * * * * *\nenabled: false\n---\nPrompt.")
    expect(entry).toMatchObject({ agent: "build", enabled: false })
  })

  test("sans cron ou sans prompt -> undefined", () => {
    expect(parseEntry("/x/a.md", "---\nagent: build\n---\nPrompt.")).toBeUndefined()
    expect(parseEntry("/x/b.md", "---\ncron: * * * * *\n---\n")).toBeUndefined()
    expect(parseEntry("/x/c.md", "pas de frontmatter")).toBeUndefined()
  })
})
