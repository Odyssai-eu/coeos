// coeos-code v2 — Settings > Skills : panneau droit en lecture.
// Affiche le SKILL.md complet (frontmatter + corps) en mono scrollable. Les
// skills non-Custom sont en lecture seule (bannière) ; les Custom offrent « Edit ».

import { Show } from "solid-js"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { isEditableSkill, skillProvenance, type SkillInfo } from "./types"

export function SkillDetail(props: { skill: SkillInfo; onEdit: () => void }) {
  const editable = () => isEditableSkill(props.skill.location)

  return (
    <div class="flex h-full min-h-0 flex-col">
      <header class="flex min-w-0 items-center justify-between gap-3 px-6 pb-3 pt-5">
        <div class="flex min-w-0 items-center gap-2">
          <h2 class="truncate text-[15px] leading-5 tracking-[-0.08px] [font-weight:530] text-v2-text-text-base">
            {props.skill.name}
          </h2>
          <Tag>{skillProvenance(props.skill.location)}</Tag>
        </div>
        <Show when={editable()}>
          <ButtonV2 size="small" icon="edit" data-action="skills-edit" onClick={() => props.onEdit()}>
            Edit
          </ButtonV2>
        </Show>
      </header>

      <div class="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-6">
        <Show when={props.skill.description}>
          <p class="text-[12px] leading-4 text-v2-text-text-muted">{props.skill.description}</p>
        </Show>

        <Show when={!editable()}>
          <div class="rounded-[8px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 py-2.5">
            <p class="text-[12px] leading-4 text-v2-text-text-muted">
              Read-only — this skill ships outside <span class="font-mono">~/.config/opencode/skill</span> and cannot be
              edited here.
            </p>
          </div>
        </Show>

        <div class="min-h-0 flex-1 overflow-hidden rounded-[8px] border border-v2-border-border-muted bg-v2-background-bg-layer-01">
          <ScrollView class="h-full min-h-0">
            <pre class="whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12px] leading-5 text-v2-text-text-base">
              {props.skill.content}
            </pre>
          </ScrollView>
        </div>

        <span class="text-[11px] leading-4 text-v2-text-text-faint">{props.skill.location}</span>
      </div>
    </div>
  )
}
