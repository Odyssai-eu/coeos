// coeos-code v2 — Settings > Skills : colonne gauche.
// Liste des skills disponibles, groupées par provenance (Custom éditables en
// tête, puis Claude / Project / Built-in), chaque rangée avec badge de provenance
// et description tronquée.

import { For, Show, createMemo } from "solid-js"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { skillProvenance, type SkillInfo, type SkillProvenance } from "./types"

const ROW =
  "group flex w-full items-start gap-2.5 rounded-[8px] border-0 bg-transparent px-2.5 py-2 text-left cursor-default " +
  "transition-[background-color,box-shadow] duration-[120ms] ease-in-out " +
  "hover:bg-v2-background-bg-layer-01 focus-visible:outline-none focus-visible:bg-v2-background-bg-layer-01 " +
  "data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)]"

// Ordre d'affichage des groupes (Custom en premier : la matière éditable).
const GROUP_ORDER: SkillProvenance[] = ["Custom", "Claude", "Project", "Built-in"]
const GROUP_LABEL: Record<SkillProvenance, string> = {
  Custom: "Custom skills",
  Claude: "Claude skills",
  Project: "Project skills",
  "Built-in": "Built-in skills",
}

export function SkillList(props: {
  skills: SkillInfo[]
  loading: boolean
  selectedName: string | undefined
  onSelect: (name: string) => void
}) {
  const groups = createMemo(() => {
    const sorted = [...props.skills].sort((a, b) => a.name.localeCompare(b.name))
    return GROUP_ORDER.map((id) => ({
      id,
      label: GROUP_LABEL[id],
      skills: sorted.filter((skill) => skillProvenance(skill.location) === id),
    })).filter((group) => group.skills.length > 0)
  })

  return (
    <aside class="flex h-full min-h-0 flex-col border-r border-v2-border-border-base">
      <Show
        when={!props.loading || props.skills.length > 0}
        fallback={
          <div class="flex flex-1 items-center justify-center text-v2-text-text-muted">
            <LoaderV2 width={20} height={20} />
          </div>
        }
      >
        <ScrollView class="min-h-0 flex-1">
          <nav class="flex flex-col gap-4 px-2 pb-4 pt-3" aria-label="Skills">
            <For each={groups()}>
              {(group) => (
                <section class="flex flex-col gap-1">
                  <h3 class="px-2.5 text-[11px] leading-4 uppercase tracking-[0.5px] [font-weight:530] text-v2-text-text-faint">
                    {group.label}
                  </h3>
                  <For each={group.skills}>
                    {(skill) => (
                      <button
                        type="button"
                        class={ROW}
                        data-selected={props.selectedName === skill.name ? "" : undefined}
                        onClick={() => props.onSelect(skill.name)}
                      >
                        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span class="flex min-w-0 items-center gap-1.5">
                            <span class="truncate text-[13px] leading-4 tracking-[-0.04px] [font-weight:530] text-v2-text-text-base">
                              {skill.name}
                            </span>
                            <Tag>{skillProvenance(skill.location)}</Tag>
                          </span>
                          <Show when={skill.description}>
                            <span class="line-clamp-2 text-[12px] leading-4 text-v2-text-text-muted">
                              {skill.description}
                            </span>
                          </Show>
                        </span>
                      </button>
                    )}
                  </For>
                </section>
              )}
            </For>
            <Show when={!props.loading && props.skills.length === 0}>
              <p class="px-2.5 py-2 text-[12px] leading-4 text-v2-text-text-muted">
                No skills available on this server yet.
              </p>
            </Show>
          </nav>
        </ScrollView>
      </Show>
    </aside>
  )
}
