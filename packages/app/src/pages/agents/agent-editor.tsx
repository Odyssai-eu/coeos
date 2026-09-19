// coeos-code v2 — Agents (WU5) : panneau droit.
// Éditeur des champs frontmatter (name / description / mode / model) + prompt,
// avec le flux de création assistée « describe your agent » (app.agentGenerate).
// Les agents natifs sont affichés en lecture seule.

import type { Agent } from "@opencode-ai/sdk/v2/client"
import { Show, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { FieldV2 } from "@opencode-ai/ui/v2/field-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { agentColor } from "@/utils/agent"
import { AGENT_NAME_RE, isNativeAgent, type AgentDraft, type AgentMode, type GeneratedAgent } from "./types"

const MODES: { value: AgentMode; label: string }[] = [
  { value: "subagent", label: "Subagent" },
  { value: "primary", label: "Primary" },
  { value: "all", label: "All" },
]

const ERROR_TEXT = "text-[12px] leading-4 text-v2-state-fg-danger"

function modelToString(agent: Agent | undefined) {
  if (!agent?.model) return ""
  return `${agent.model.providerID}/${agent.model.modelID}`
}

/**
 * Le composant est remonté (keyed) à chaque changement de sélection : le
 * formulaire s'initialise donc une seule fois depuis l'agent reçu.
 */
export function AgentEditor(props: {
  agent?: Agent
  creating?: boolean
  saving: boolean
  generating: boolean
  onSave: (draft: AgentDraft) => void
  onGenerate: (description: string) => Promise<GeneratedAgent | undefined>
}) {
  const native = () => (props.agent ? isNativeAgent(props.agent) : false)

  const [form, setForm] = createStore<AgentDraft>({
    name: props.agent?.name ?? "",
    description: props.agent?.description ?? "",
    mode: props.agent?.mode ?? "subagent",
    model: modelToString(props.agent),
    prompt: props.agent?.prompt ?? "",
  })

  // Validation légère — le serveur refuse les noms hors AGENT_NAME_RE.
  const [submitted, setSubmitted] = createSignal(false)
  const nameError = () => {
    const name = form.name.trim()
    if (!name) return "Name is required."
    if (!AGENT_NAME_RE.test(name)) return "Letters, digits, dashes and underscores only; must start with a letter or digit."
    return undefined
  }
  const promptError = () => (form.prompt.trim() ? undefined : "Prompt is required.")

  const submit = () => {
    if (props.saving || native()) return
    setSubmitted(true)
    if (nameError() || promptError()) return
    props.onSave({
      name: form.name.trim(),
      description: form.description.trim(),
      mode: form.mode,
      model: form.model.trim(),
      prompt: form.prompt,
    })
  }

  // Flux « describe your agent » : le brouillon généré préremplit le formulaire.
  const [describe, setDescribe] = createSignal("")
  const runGenerate = async () => {
    if (props.generating) return
    const description = describe().trim()
    if (!description) return
    const draft = await props.onGenerate(description)
    if (!draft) return
    setForm({
      name: draft.identifier,
      description: draft.whenToUse,
      prompt: draft.systemPrompt,
      mode: "subagent",
    })
    setSubmitted(false)
  }

  return (
    <ScrollView class="h-full min-h-0">
      <div class="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-8 pb-10 pt-8">
        <header class="flex min-w-0 items-center gap-3">
          <span
            class="size-3 shrink-0 rounded-full"
            style={{ background: agentColor(form.name.trim() || "agent", props.agent?.color) }}
            aria-hidden="true"
          />
          <div class="flex min-w-0 items-center gap-2">
            <h2 class="truncate text-[16px] leading-5 tracking-[-0.08px] [font-weight:530] text-v2-text-text-base">
              {props.creating ? form.name.trim() || "New agent" : props.agent?.name}
            </h2>
            <Tag>{form.mode}</Tag>
            <Show when={!props.creating}>
              <Tag>{native() ? "built-in" : "custom"}</Tag>
            </Show>
          </div>
        </header>

        <Show when={native()}>
          <div class="rounded-[8px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 py-2.5">
            <p class="text-[12px] leading-4 text-v2-text-text-muted">
              Built-in agent — its definition ships with coeos-code and cannot be edited here.
            </p>
          </div>
        </Show>

        <Show when={props.creating}>
          <section class="flex flex-col gap-3 rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-4">
            <div class="flex flex-col gap-1">
              <h3 class="text-[13px] leading-4 tracking-[-0.04px] [font-weight:530] text-v2-text-text-base">
                Describe your agent
              </h3>
              <p class="text-[12px] leading-4 text-v2-text-text-muted">
                Explain in plain words what the agent should do — coeos-code drafts the name, description and system prompt
                for you. You can adjust everything before saving.
              </p>
            </div>
            <TextareaV2
              rows={3}
              placeholder="e.g. Reviews my diffs for security issues and suggests minimal fixes"
              value={describe()}
              disabled={props.generating}
              onInput={(event) => setDescribe(event.currentTarget.value)}
            />
            <div class="flex items-center justify-end gap-3">
              <Show when={props.generating}>
                <span class="text-[12px] leading-4 text-v2-text-text-muted">
                  Generating — this can take up to 30 seconds…
                </span>
              </Show>
              <ButtonV2
                variant={props.generating ? "loading" : "contrast"}
                disabled={!props.generating && !describe().trim()}
                style={{ "min-width": "88px" }}
                data-action="agents-generate"
                onClick={() => void runGenerate()}
              >
                <Show when={props.generating} fallback={"Generate"}>
                  <LoaderV2 />
                </Show>
              </ButtonV2>
            </div>
          </section>
        </Show>

        <div class="flex flex-col gap-5">
          <FieldV2 invalid={submitted() && !!nameError()}>
            <FieldV2.Label>Name</FieldV2.Label>
            <TextInputV2
              value={form.name}
              disabled={native()}
              readOnly={native()}
              placeholder="my-agent"
              invalid={submitted() && !!nameError()}
              onInput={(event) => setForm("name", event.currentTarget.value)}
            />
            <Show when={submitted() && nameError()}>
              <p class={ERROR_TEXT}>{nameError()}</p>
            </Show>
          </FieldV2>

          <FieldV2>
            <FieldV2.Label tooltip="Shown to the orchestrator so it knows when to delegate to this agent.">
              Description
            </FieldV2.Label>
            <TextareaV2
              rows={2}
              value={form.description}
              disabled={native()}
              placeholder="When should this agent be used?"
              onInput={(event) => setForm("description", event.currentTarget.value)}
            />
          </FieldV2>

          <div class="grid grid-cols-2 gap-4">
            <FieldV2>
              <FieldV2.Label tooltip="Primary agents drive a session; subagents are spawned for delegated tasks.">
                Mode
              </FieldV2.Label>
              <SelectV2
                class="w-full"
                options={MODES}
                current={MODES.find((mode) => mode.value === form.mode) ?? MODES[0]}
                value={(mode) => mode.value}
                label={(mode) => mode.label}
                disabled={native()}
                onSelect={(mode) => {
                  if (mode) setForm("mode", mode.value)
                }}
              />
            </FieldV2>

            <FieldV2>
              <FieldV2.Label tooltip="provider/model — leave empty to inherit the session model.">
                Model
              </FieldV2.Label>
              <TextInputV2
                value={form.model}
                disabled={native()}
                readOnly={native()}
                placeholder="coeos/CoeOS"
                onInput={(event) => setForm("model", event.currentTarget.value)}
              />
            </FieldV2>
          </div>

          <FieldV2 invalid={submitted() && !!promptError()}>
            <FieldV2.Label tooltip="The system prompt injected when this agent runs.">Prompt</FieldV2.Label>
            <TextareaV2
              rows={16}
              class="[&_textarea]:min-h-[260px]"
              value={form.prompt}
              disabled={native()}
              placeholder="You are…"
              invalid={submitted() && !!promptError()}
              onInput={(event) => setForm("prompt", event.currentTarget.value)}
            />
            <Show when={submitted() && promptError()}>
              <p class={ERROR_TEXT}>{promptError()}</p>
            </Show>
          </FieldV2>
        </div>

        <Show when={!native()}>
          <footer class="flex items-center justify-between gap-4 border-t border-v2-border-border-muted pt-4">
            <span class="text-[12px] leading-4 text-v2-text-text-faint">
              Saved to <span class="[font-weight:530] text-v2-text-text-muted">.opencode/agent/</span> in the current
              worktree.
            </span>
            <ButtonV2
              variant={props.saving ? "loading" : "contrast"}
              style={{ "min-width": "72px" }}
              data-action="agents-save"
              onClick={submit}
            >
              <Show when={props.saving} fallback={"Save"}>
                <LoaderV2 />
              </Show>
            </ButtonV2>
          </footer>
        </Show>
      </div>
    </ScrollView>
  )
}
