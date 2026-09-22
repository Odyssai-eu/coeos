// coeos-code v2 — Agents (WU5) : colonne gauche.
// Liste des agents connus, agents custom en tête (éditables) puis les natifs,
// chaque rangée avec pastille couleur, nom, badges mode / origine et description.

import type { Agent } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo } from "solid-js"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { agentColor } from "@/utils/agent"
import { isNativeAgent, type AgentSelection } from "./types"

const ROW =
  "group flex w-full items-start gap-2.5 rounded-[8px] border-0 bg-transparent px-2.5 py-2 text-left cursor-default " +
  "transition-[background-color,box-shadow] duration-[120ms] ease-in-out " +
  "hover:bg-v2-background-bg-layer-01 focus-visible:outline-none focus-visible:bg-v2-background-bg-layer-01 " +
  "data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)]"

export function AgentList(props: {
  title: string
  agents: Agent[]
  loading: boolean
  selection: AgentSelection | undefined
  onSelect: (name: string) => void
  onNew: () => void
}) {
  // Custom d'abord (c'est la matière éditable de la page), natifs ensuite.
  const groups = createMemo(() => {
    const sorted = [...props.agents].sort((a, b) => a.name.localeCompare(b.name))
    return [
      { id: "custom", label: "Custom agents", agents: sorted.filter((agent) => !isNativeAgent(agent)) },
      { id: "native", label: "Built-in agents", agents: sorted.filter(isNativeAgent) },
    ].filter((group) => group.agents.length > 0)
  })

  const selectedName = () => (props.selection?.kind === "agent" ? props.selection.name : undefined)

  return (
    <aside class="flex h-full min-h-0 flex-col border-r border-v2-border-border-base">
      <header class="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
        <div class="flex flex-col gap-0.5">
          <h1 class="text-[15px] leading-5 tracking-[-0.08px] [font-weight:530] text-v2-text-text-base">
            {props.title}
          </h1>
          <Show when={!props.loading}>
            <span class="text-[12px] leading-4 text-v2-text-text-muted">
              {props.agents.length === 1 ? "1 agent" : `${props.agents.length} agents`}
            </span>
          </Show>
        </div>
        <ButtonV2 size="small" icon="plus" data-action="agents-new" onClick={() => props.onNew()}>
          New agent
        </ButtonV2>
      </header>

      <Show
        when={!props.loading || props.agents.length > 0}
        fallback={
          <div class="flex flex-1 items-center justify-center text-v2-text-text-muted">
            <LoaderV2 width={20} height={20} />
          </div>
        }
      >
        <ScrollView class="min-h-0 flex-1">
          <nav class="flex flex-col gap-4 px-2 pb-4 pt-2" aria-label={props.title}>
            <For each={groups()}>
              {(group) => (
                <section class="flex flex-col gap-1">
                  <h2 class="px-2.5 text-[11px] leading-4 uppercase tracking-[0.5px] [font-weight:530] text-v2-text-text-faint">
                    {group.label}
                  </h2>
                  <For each={group.agents}>
                    {(agent) => (
                      <button
                        type="button"
                        class={ROW}
                        data-selected={selectedName() === agent.name ? "" : undefined}
                        onClick={() => props.onSelect(agent.name)}
                      >
                        <span
                          class="mt-[5px] size-2 shrink-0 rounded-full"
                          style={{ background: agentColor(agent.name, agent.color) }}
                          aria-hidden="true"
                        />
                        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span class="flex min-w-0 items-center gap-1.5">
                            <span class="truncate text-[13px] leading-4 tracking-[-0.04px] [font-weight:530] text-v2-text-text-base">
                              {agent.name}
                            </span>
                            <Tag>{agent.mode}</Tag>
                            <Tag>{isNativeAgent(agent) ? "built-in" : "custom"}</Tag>
                          </span>
                          <Show when={agent.description}>
                            <span class="line-clamp-2 text-[12px] leading-4 text-v2-text-text-muted">
                              {agent.description}
                            </span>
                          </Show>
                        </span>
                      </button>
                    )}
                  </For>
                </section>
              )}
            </For>
            <Show when={!props.loading && props.agents.length === 0}>
              <p class="px-2.5 py-2 text-[12px] leading-4 text-v2-text-text-muted">
                No agents available on this server yet.
              </p>
            </Show>
          </nav>
        </ScrollView>
      </Show>
    </aside>
  )
}
