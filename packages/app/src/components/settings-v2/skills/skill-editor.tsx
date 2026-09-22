// coeos-code v2 — Settings > Skills : panneau droit en édition.
// Création (squelette pré-rempli) ou ré-édition d'une skill Custom. Champ name
// (regex serveur) + grand textarea SKILL.md, validé côté client (name + frontmatter
// name/description obligatoires) avant skillSave.

import { Show, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { FieldV2 } from "@opencode-ai/ui/v2/field-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { SKILL_NAME_RE, frontmatterError, skillSkeleton } from "./types"

const ERROR_TEXT = "text-[12px] leading-4 text-v2-state-fg-danger"

/**
 * Le composant est remonté (keyed) à chaque changement de sélection : le
 * formulaire s'initialise donc une seule fois depuis les props reçues.
 */
export function SkillEditor(props: {
  creating?: boolean
  initialName: string
  initialContent: string
  saving: boolean
  onSave: (draft: { name: string; content: string }) => void
}) {
  const [form, setForm] = createStore({
    name: props.initialName,
    content: props.initialContent,
  })

  // À la création, tant que le corps n'a pas été édité manuellement, la ligne
  // `name:` du frontmatter suit le champ name (le squelette reste cohérent).
  const [contentDirty, setContentDirty] = createSignal(!props.creating)
  const [submitted, setSubmitted] = createSignal(false)

  const nameError = () => {
    const name = form.name.trim()
    if (!name) return "Name is required."
    if (!SKILL_NAME_RE.test(name))
      return "Letters, digits, dashes and underscores only; must start with a letter or digit."
    return undefined
  }
  const contentError = () => frontmatterError(form.content)

  const onNameInput = (value: string) => {
    setForm("name", value)
    if (props.creating && !contentDirty()) setForm("content", skillSkeleton(value))
  }

  const onContentInput = (value: string) => {
    setForm("content", value)
    setContentDirty(true)
  }

  const submit = () => {
    if (props.saving) return
    setSubmitted(true)
    if (nameError() || contentError()) return
    props.onSave({ name: form.name.trim(), content: form.content })
  }

  return (
    <ScrollView class="h-full min-h-0">
      <div class="flex w-full flex-col gap-5 px-6 pb-8 pt-5">
        <header class="flex min-w-0 items-center gap-2">
          <h2 class="truncate text-[15px] leading-5 tracking-[-0.08px] [font-weight:530] text-v2-text-text-base">
            {props.creating ? form.name.trim() || "New skill" : props.initialName}
          </h2>
          <Tag>{props.creating ? "new" : "editing"}</Tag>
        </header>

        <FieldV2 invalid={submitted() && !!nameError()}>
          <FieldV2.Label>Name</FieldV2.Label>
          <TextInputV2
            value={form.name}
            disabled={!props.creating}
            readOnly={!props.creating}
            placeholder="my-skill"
            invalid={submitted() && !!nameError()}
            onInput={(event) => onNameInput(event.currentTarget.value)}
          />
          <Show when={submitted() && nameError()}>
            <p class={ERROR_TEXT}>{nameError()}</p>
          </Show>
        </FieldV2>

        <FieldV2 invalid={submitted() && !!contentError()}>
          <FieldV2.Label tooltip="Full SKILL.md — a YAML frontmatter with name + description, then the skill body.">
            SKILL.md
          </FieldV2.Label>
          <TextareaV2
            rows={18}
            class="[&_textarea]:min-h-[300px] [&_textarea]:font-mono [&_textarea]:text-[12px] [&_textarea]:leading-5"
            value={form.content}
            spellcheck={false}
            invalid={submitted() && !!contentError()}
            onInput={(event) => onContentInput(event.currentTarget.value)}
          />
          <Show when={submitted() && contentError()}>
            <p class={ERROR_TEXT}>{contentError()}</p>
          </Show>
        </FieldV2>

        <footer class="flex items-center justify-between gap-4 border-t border-v2-border-border-muted pt-4">
          <span class="text-[12px] leading-4 text-v2-text-text-faint">
            Saved to <span class="font-mono [font-weight:530] text-v2-text-text-muted">~/.config/opencode/skill/</span>
          </span>
          <ButtonV2
            variant={props.saving ? "loading" : "contrast"}
            style={{ "min-width": "72px" }}
            data-action="skills-save"
            onClick={submit}
          >
            <Show when={props.saving} fallback={"Save"}>
              <LoaderV2 />
            </Show>
          </ButtonV2>
        </footer>
      </div>
    </ScrollView>
  )
}
