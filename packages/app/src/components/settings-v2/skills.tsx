// coeos-code v2 — Settings > Skills (2026-08-02).
// Panneau maître-détail : colonne gauche = skills disponibles (SKILL.md) groupées
// par provenance ; panneau droit = lecture du SKILL.md, ou éditeur pour créer /
// ré-éditer une skill Custom (écrite via app.skillSave dans ~/.config/opencode/skill).

import { type Component, Match, Show, Switch, createEffect, createMemo, createResource, createSignal } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { formatServerError } from "@/utils/server-errors"
import { SkillList } from "./skills/skill-list"
import { SkillDetail } from "./skills/skill-detail"
import { SkillEditor } from "./skills/skill-editor"
import { isEditableSkill, skillSkeleton, type SkillInfo, type SkillSelection } from "./skills/types"
import "./settings-v2.css"

export const SettingsSkillsV2: Component = () => {
  const language = useLanguage()
  const sdk = useServerSDK()

  // Le panneau est top-level (pas de dossier courant) : on interroge le client
  // serveur directement. Le serveur résout le worktree par défaut.
  const [skills, { refetch }] = createResource(
    () => sdk().client,
    (client) => client.app.skills().then((x) => x.data ?? []),
  )

  const list = createMemo<SkillInfo[]>(() => skills() ?? [])

  const [selection, setSelection] = createSignal<SkillSelection>()

  const byName = (name: string) => list().find((skill) => skill.name === name)
  const selectedSkill = createMemo(() => {
    const current = selection()
    return current?.kind === "skill" ? byName(current.name) : undefined
  })
  // On ne bascule en édition que sur une skill Custom (garde-fou).
  const editingSkill = createMemo(() => {
    const current = selection()
    if (current?.kind !== "edit") return undefined
    const skill = byName(current.name)
    return skill && isEditableSkill(skill.location) ? skill : undefined
  })

  // Nom mis en surbrillance dans la liste (lecture comme édition).
  const listSelectedName = () => {
    const current = selection()
    return current?.kind === "skill" || current?.kind === "edit" ? current.name : undefined
  }

  // Sélection par défaut : première skill (par nom) une fois la liste chargée.
  createEffect(() => {
    if (selection()) return
    const first = [...list()].sort((a, b) => a.name.localeCompare(b.name))[0]
    if (first) setSelection({ kind: "skill", name: first.name })
  })

  const [saving, setSaving] = createSignal(false)

  const save = async (draft: { name: string; content: string }) => {
    if (saving()) return
    setSaving(true)
    try {
      const result = await sdk().client.app.skillSave({ name: draft.name, content: draft.content })
      showToast({ variant: "success", title: "Skill saved", description: result.data?.path })
      await refetch()
      setSelection({ kind: "skill", name: draft.name })
    } catch (error) {
      showToast({
        variant: "error",
        title: "Failed to save skill",
        description: formatServerError(error, language.t),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div class="flex h-full min-h-0 flex-col bg-v2-background-bg-base">
      <header class="flex items-center justify-between gap-3 px-6 pb-3 pt-6">
        <div class="flex flex-col gap-0.5">
          <h2 class="settings-v2-tab-title">{language.t("settings.skills.title")}</h2>
          <Show when={!skills.loading}>
            <span class="text-[12px] leading-4 text-v2-text-text-muted">
              {list().length === 1 ? "1 skill" : `${list().length} skills`}
            </span>
          </Show>
        </div>
        <ButtonV2 size="small" icon="plus" data-action="skills-new" onClick={() => setSelection({ kind: "new" })}>
          New skill
        </ButtonV2>
      </header>

      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,260px)_minmax(0,1fr)] border-t border-v2-border-border-base">
        <SkillList
          skills={list()}
          loading={skills.loading}
          selectedName={listSelectedName()}
          onSelect={(name) => setSelection({ kind: "skill", name })}
        />
        <Switch fallback={<SkillsEmpty loading={skills.loading} />}>
          <Match when={selection()?.kind === "new"}>
            <SkillEditor
              creating
              initialName=""
              initialContent={skillSkeleton("")}
              saving={saving()}
              onSave={save}
            />
          </Match>
          {/* keyed : l'éditeur est remonté par skill pour réinitialiser le formulaire. */}
          <Match when={editingSkill()} keyed>
            {(skill) => (
              <SkillEditor
                initialName={skill.name}
                initialContent={skill.content}
                saving={saving()}
                onSave={save}
              />
            )}
          </Match>
          <Match when={selectedSkill()} keyed>
            {(skill) => (
              <SkillDetail skill={skill} onEdit={() => setSelection({ kind: "edit", name: skill.name })} />
            )}
          </Match>
        </Switch>
      </div>
    </div>
  )
}

function SkillsEmpty(props: { loading: boolean }) {
  return (
    <div class="flex h-full items-center justify-center">
      <Show
        when={!props.loading}
        fallback={<LoaderV2 width={20} height={20} class="text-v2-text-text-muted" />}
      >
        <p class="text-[13px] leading-4 text-v2-text-text-muted">Select a skill, or create a new one.</p>
      </Show>
    </div>
  )
}
