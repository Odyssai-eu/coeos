// coeos-code v2 — Agents (PLAN.md WU5) : agent builder plein écran.
// Colonne gauche : liste des agents connus (natifs + custom). Panneau droit :
// éditeur frontmatter + prompt, création assistée « describe your agent »
// (app.agentGenerate) et écriture via app.agentSave.

import { Match, Show, Switch, createEffect, createMemo, createResource, createSignal } from "solid-js"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { formatServerError } from "@/utils/server-errors"
import { normalizeAgentList } from "@/context/global-sync/utils"
import { AgentList } from "./agents/agent-list"
import { AgentEditor } from "./agents/agent-editor"
import type { AgentDraft, AgentSelection } from "./agents/types"

export default function AgentsPage() {
  const language = useLanguage()
  const sdk = useServerSDK()

  // La page est top-level (pas de dossier courant) : on interroge le client
  // serveur directement, avec la même normalisation que le bootstrap de
  // global-sync (loadAgentsQuery). Le serveur résout le worktree par défaut.
  const [agents, { refetch }] = createResource(
    () => sdk().client,
    (client) => client.app.agents().then((x) => normalizeAgentList(x.data)),
  )

  // Les agents cachés (internes : compaction, titres…) ne sont pas éditables.
  const visible = createMemo(() => (agents() ?? []).filter((agent) => !agent.hidden))

  const [selection, setSelection] = createSignal<AgentSelection>()
  const selected = createMemo(() => {
    const current = selection()
    if (current?.kind !== "agent") return undefined
    return visible().find((agent) => agent.name === current.name)
  })

  // Sélection par défaut : premier agent une fois la liste chargée.
  createEffect(() => {
    if (selection()) return
    const first = visible()[0]
    if (first) setSelection({ kind: "agent", name: first.name })
  })

  const [saving, setSaving] = createSignal(false)
  const [generating, setGenerating] = createSignal(false)

  const save = async (draft: AgentDraft) => {
    if (saving()) return
    setSaving(true)
    try {
      const result = await sdk().client.app.agentSave({
        name: draft.name,
        description: draft.description || undefined,
        mode: draft.mode,
        model: draft.model || undefined,
        prompt: draft.prompt,
      })
      showToast({ variant: "success", title: "Agent saved", description: result.data?.path })
      await refetch()
      setSelection({ kind: "agent", name: draft.name })
    } catch (error) {
      showToast({
        variant: "error",
        title: "Failed to save agent",
        description: formatServerError(error, language.t),
      })
    } finally {
      setSaving(false)
    }
  }

  // app.agentGenerate peut prendre 10-30 s — le spinner vit dans l'éditeur.
  const generate = async (description: string) => {
    setGenerating(true)
    try {
      const result = await sdk().client.app.agentGenerate({ description })
      return result.data
    } catch (error) {
      showToast({
        variant: "error",
        title: "Failed to generate agent",
        description: formatServerError(error, language.t),
      })
      return undefined
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div class="m-2 min-h-0 flex-1 self-stretch overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]">
      <div class="grid h-full grid-cols-[320px_minmax(0,1fr)]">
        <AgentList
          title={language.t("agentsPage.title")}
          agents={visible()}
          loading={agents.loading}
          selection={selection()}
          onSelect={(name) => setSelection({ kind: "agent", name })}
          onNew={() => setSelection({ kind: "new" })}
        />
        <Switch fallback={<AgentsEmpty loading={agents.loading} />}>
          <Match when={selection()?.kind === "new"}>
            <AgentEditor creating saving={saving()} generating={generating()} onSave={save} onGenerate={generate} />
          </Match>
          {/* keyed : l'éditeur est remonté à chaque agent pour réinitialiser le formulaire. */}
          <Match when={selected()} keyed>
            {(agent) => (
              <AgentEditor
                agent={agent}
                saving={saving()}
                generating={generating()}
                onSave={save}
                onGenerate={generate}
              />
            )}
          </Match>
        </Switch>
      </div>
    </div>
  )
}

function AgentsEmpty(props: { loading: boolean }) {
  return (
    <div class="flex h-full items-center justify-center">
      <Show
        when={!props.loading}
        fallback={<LoaderV2 width={20} height={20} class="text-v2-text-text-muted" />}
      >
        <p class="text-[13px] leading-4 text-v2-text-text-muted">Select an agent, or create a new one.</p>
      </Show>
    </div>
  )
}
