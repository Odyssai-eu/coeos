// coeos-code v2 — Settings > Skills : types et helpers partagés du panneau.

import type { AppSkillsResponse } from "@opencode-ai/sdk/v2/client"

// Élément renvoyé par app.skills() : { name, description?, location, content }.
export type SkillInfo = AppSkillsResponse[number]

// Sélection courante du panneau : lecture d'une skill, édition, ou création.
export type SkillSelection =
  | { kind: "skill"; name: string }
  | { kind: "edit"; name: string }
  | { kind: "new" }

// Provenance déduite du chemin du SKILL.md (location).
export type SkillProvenance = "Custom" | "Claude" | "Project" | "Built-in"

// L'ordre des tests compte : « Custom » (~/.config/opencode/skill) d'abord car
// son chemin contient « opencode/skill » sans jamais matcher « .opencode/skill ».
export function skillProvenance(location: string): SkillProvenance {
  const path = location.replace(/\\/g, "/")
  if (path.includes("/.config/opencode/skill")) return "Custom"
  if (path.includes("/.claude/skills")) return "Claude"
  if (path.includes("/.opencode/skill")) return "Project"
  return "Built-in"
}

// Seules les skills « Custom » (écrites par skillSave) sont éditables ici.
export const isEditableSkill = (location: string) => skillProvenance(location) === "Custom"

// Même contrainte que le champ name côté serveur (dossier <name>/SKILL.md).
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-_]*$/i

// Squelette valide pré-rempli à la création : frontmatter name + description
// obligatoires (sinon le scanner ignore la skill) puis un corps de départ.
export function skillSkeleton(name: string): string {
  const safe = name.trim()
  return [
    "---",
    `name: ${safe}`,
    "description: Describe when this skill should be used — one sentence.",
    "---",
    "",
    `# ${safe || "New skill"}`,
    "",
    "Write the skill instructions here…",
    "",
  ].join("\n")
}

export type Frontmatter = { name?: string; description?: string }

// Extraction légère du frontmatter YAML de tête (name / description uniquement).
// Volontairement tolérante (guillemets, espaces) — on valide la présence, pas la
// conformité YAML complète.
export function parseFrontmatter(content: string): Frontmatter | null {
  // Retire un éventuel BOM (U+FEFF) avant d'analyser le bloc de tête.
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  const match = text.match(/^\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!match) return null
  const block = match[1]
  const read = (key: string) => {
    const line = block.match(new RegExp(`^[ \\t]*${key}[ \\t]*:[ \\t]*(.*)$`, "m"))
    if (!line) return undefined
    const value = line[1]
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim()
    return value || undefined
  }
  return { name: read("name"), description: read("description") }
}

// Message d'erreur clair si le content n'a pas de frontmatter name + description.
export function frontmatterError(content: string): string | undefined {
  const fm = parseFrontmatter(content)
  if (!fm) return "The SKILL.md must start with a YAML frontmatter block delimited by ---."
  if (!fm.name) return "The frontmatter is missing a non-empty name: field."
  if (!fm.description) return "The frontmatter is missing a non-empty description: field."
  return undefined
}
