// coeos-code v2 — Agents (PLAN.md WU5) : types partagés de la page.

import type { Agent } from "@opencode-ai/sdk/v2/client"

export type AgentMode = Agent["mode"]

/** Sélection courante : un agent existant, ou le mode création. */
export type AgentSelection = { kind: "agent"; name: string } | { kind: "new" }

/** Brouillon éditable — miroir des champs frontmatter acceptés par app.agentSave. */
export type AgentDraft = {
  name: string
  description: string
  mode: AgentMode
  model: string
  prompt: string
}

/** Résultat de app.agentGenerate (« describe your agent »). */
export type GeneratedAgent = {
  identifier: string
  whenToUse: string
  systemPrompt: string
}

/** Un agent est natif quand il est livré avec coeos-code (non éditable ici). */
export const isNativeAgent = (agent: Agent) => agent.native === true

/** Même contrainte que le serveur (agentSave refuse sinon). */
export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-_]*$/i
