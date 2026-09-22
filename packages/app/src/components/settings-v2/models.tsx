import { useFilteredList } from "@opencode-ai/ui/hooks"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { type Component, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { usePlatform } from "@/context/platform"
import { popularProviders } from "@/hooks/use-providers"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

// coeos-nemo (2026-09-19) : l'adresse de la CoeOS box et les moteurs
// supplémentaires vivent dans Settings > Providers (providers.tsx). Ici : les
// modèles des modes et le triage.
// coeos-code — affectation locale du modèle des modes visibles Plan / Build
// (Sophie 2026-08-03). Le picker liste les modèles du provider `coeos` (peuplé
// par buildCoeosConfig depuis /v1/models de l'engine), plus une entrée « défaut ».
// Rien n'est ajouté à CoeOS : le choix est persisté côté desktop (electron-store)
// et injecté dans agent.build/plan.model au prochain spawn (restart-to-apply).
type ModeModelOption = { id: string; name: string }
const COEOS_MODE_DEFAULT: ModeModelOption = { id: "", name: "Default — CoeOS" }
// Pas de triage : le pipeline part sur son défaut prudent. Mieux qu'un modèle
// écrit en dur qui peut ne plus être servi.
const TRIAGE_NONE: ModeModelOption = { id: "", name: "None" }

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]

const PROVIDER_ICON_SIZE = 16

export const SettingsModelsV2: Component = () => {
  const language = useLanguage()
  const models = useModels()
  const platform = usePlatform()
  const desktop = createMemo(() => platform.platform === "desktop")

  // Modèles servis par le provider coeos (peuplé depuis /v1/models). Le pick
  // est stocké/appliqué en `coeos/<id>`, donc on ne propose QUE ce provider —
  // un id d'un autre provider serait rejeté « Model not found ».
  const coeosModeOptions = createMemo<ModeModelOption[]>(() => [
    COEOS_MODE_DEFAULT,
    ...models
      .list()
      .filter((m) => m.provider.id === "coeos")
      .map((m) => ({ id: m.id, name: m.name })),
  ])

  // Le modèle qui classe la tâche au premier message. `<provider>/<modèle>` :
  // il peut tourner ailleurs que sur le routeur.
  const [declaredModels] = createResource(
    () => (desktop() && platform.listDeclaredModels ? true : false),
    () => (platform.listDeclaredModels ? platform.listDeclaredModels().catch(() => []) : Promise.resolve([])),
    { initialValue: [] as string[] },
  )
  const [triageModel, { mutate: setTriageLocal }] = createResource(
    () => (desktop() && platform.getTriageModel ? true : false),
    () => Promise.resolve(platform.getTriageModel?.() ?? "").catch(() => ""),
    { initialValue: "" },
  )
  const triageOptions = createMemo<ModeModelOption[]>(() => [
    TRIAGE_NONE,
    ...(declaredModels.latest ?? []).map((id) => ({ id, name: id })),
  ])
  const onTriageChange = async (id: string) => {
    await platform.setTriageModel?.(id)
    setTriageLocal(id)
    showToast({ variant: "success", title: "Triage model saved", description: "Restart to apply." })
  }

  // Persisté côté desktop, restart-to-apply (buildCoeosConfig lit au spawn).
  const [planModel, { mutate: setPlanLocal }] = createResource(
    () => (desktop() && platform.getPlanModel ? true : false),
    () => Promise.resolve(platform.getPlanModel?.() ?? "").catch(() => ""),
    { initialValue: "" },
  )
  const [buildModel, { mutate: setBuildLocal }] = createResource(
    () => (desktop() && platform.getBuildModel ? true : false),
    () => Promise.resolve(platform.getBuildModel?.() ?? "").catch(() => ""),
    { initialValue: "" },
  )

  const onModeModelChange = (
    mode: "plan" | "build",
    option: ModeModelOption | null,
    mutate: (v: string) => void,
    setter?: (modelID: string) => Promise<void> | void,
  ) => {
    if (!option) return
    const id = option.id
    mutate(id)
    if (setter) void Promise.resolve(setter(id)).catch(() => void 0)
    showToast({
      variant: "default",
      title: id ? `Modèle ${mode} : ${option.name}` : `Modèle ${mode} remis au défaut CoeOS`,
      description: "Redémarre coeos-code pour appliquer.",
    })
  }

  const list = useFilteredList<ModelItem>({
    items: (_filter) => models.list(),
    key: (x) => `${x.provider.id}:${x.id}`,
    filterKeys: ["provider.name", "name", "id"],
    sortBy: (a, b) => a.name.localeCompare(b.name),
    groupBy: (x) => x.provider.id,
    sortGroupsBy: (a, b) => {
      const aIndex = popularProviders.indexOf(a.category)
      const bIndex = popularProviders.indexOf(b.category)
      const aPopular = aIndex >= 0
      const bPopular = bIndex >= 0

      if (aPopular && !bPopular) return -1
      if (!aPopular && bPopular) return 1
      if (aPopular && bPopular) return aIndex - bIndex

      const aName = a.items[0].provider.name
      const bName = b.items[0].provider.name
      return aName.localeCompare(bName)
    },
  })

  return (
    <>
      <div class="settings-v2-tab-header settings-v2-tab-header--stacked">
        <h2 class="settings-v2-tab-title">{language.t("settings.models.title")}</h2>
        <div class="settings-v2-tab-search">
          <TextInputV2
            type="search"
            appearance="base"
            value={list.filter()}
            onInput={(event) => list.onInput(event.currentTarget.value)}
            placeholder={language.t("dialog.model.search.placeholder")}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            aria-label={language.t("dialog.model.search.placeholder")}
          />
          <Show when={list.filter()}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              class="settings-v2-tab-search-clear"
              icon={<IconV2 name="close" size="large" class="text-v2-icon-icon-muted" />}
              onClick={() => list.clear()}
            />
          </Show>
        </div>
      </div>

      <div class="settings-v2-tab-body settings-v2-models">
        <Show when={desktop() && platform.getPlanModel}>
          <div class="settings-v2-section" data-component="settings-models-modes">
            <div class="settings-v2-models-group-header">
              <h3 class="settings-v2-section-title">CoeOS modes</h3>
            </div>
            <SettingsListV2>
              <SettingsRowV2
                title="Plan mode model"
                description="Model used by Plan mode. Default: CoeOS. Restart required."
              >
                <SelectV2
                  appearance="inline"
                  data-action="settings-plan-model"
                  options={coeosModeOptions()}
                  current={coeosModeOptions().find((o) => o.id === (planModel.latest ?? "")) ?? COEOS_MODE_DEFAULT}
                  placement="bottom-end"
                  gutter={6}
                  value={(o) => o.id}
                  label={(o) => o.name}
                  onSelect={(option) => onModeModelChange("plan", option, setPlanLocal, platform.setPlanModel)}
                />
              </SettingsRowV2>
              <SettingsRowV2
                title="Build mode model"
                description="Model used by Build mode. Default: CoeOS. Restart required."
              >
                <SelectV2
                  appearance="inline"
                  data-action="settings-build-model"
                  options={coeosModeOptions()}
                  current={coeosModeOptions().find((o) => o.id === (buildModel.latest ?? "")) ?? COEOS_MODE_DEFAULT}
                  placement="bottom-end"
                  gutter={6}
                  value={(o) => o.id}
                  label={(o) => o.name}
                  onSelect={(option) => onModeModelChange("build", option, setBuildLocal, platform.setBuildModel)}
                />
              </SettingsRowV2>
              <SettingsRowV2
                title="Triage model"
                description="Model that classifies the task on the first message of a session. Empty means no triage — the pipeline runs at its cautious default. Restart required."
              >
                <SelectV2
                  appearance="inline"
                  data-action="settings-triage-model"
                  options={triageOptions()}
                  current={triageOptions().find((o) => o.id === (triageModel.latest ?? "")) ?? TRIAGE_NONE}
                  placement="bottom-end"
                  gutter={6}
                  value={(o) => o.id}
                  label={(o) => o.name}
                  onSelect={(option) => void onTriageChange(option?.id ?? "")}
                />
              </SettingsRowV2>
            </SettingsListV2>
          </div>
        </Show>
        <Show
          when={!list.grouped.loading}
          fallback={
            <div class="settings-v2-models-status">
              {language.t("common.loading")}
              {language.t("common.loading.ellipsis")}
            </div>
          }
        >
          <Show
            when={list.flat().length > 0}
            fallback={
              <div class="settings-v2-models-status">
                <span>{language.t("dialog.model.empty")}</span>
                <Show when={list.filter()}>
                  <span class="settings-v2-models-status-filter">&quot;{list.filter()}&quot;</span>
                </Show>
              </div>
            }
          >
            <For each={list.grouped.latest}>
              {(group) => (
                <div class="settings-v2-section" data-component="settings-models-provider">
                  <div class="settings-v2-models-group-header">
                    <ProviderIcon
                      id={group.category}
                      width={PROVIDER_ICON_SIZE}
                      height={PROVIDER_ICON_SIZE}
                      class="settings-v2-models-provider-icon shrink-0"
                    />
                    <h3 class="settings-v2-section-title">{group.items[0].provider.name}</h3>
                  </div>
                  <SettingsListV2>
                    <For each={group.items}>
                      {(item) => {
                        const key = { providerID: item.provider.id, modelID: item.id }
                        return (
                          <SettingsRowV2 title={item.name} description="">
                            <div>
                              <Switch
                                checked={models.visible(key)}
                                onChange={(checked) => {
                                  models.setVisibility(key, checked)
                                }}
                                hideLabel
                              >
                                {item.name}
                              </Switch>
                            </div>
                          </SettingsRowV2>
                        )
                      }}
                    </For>
                  </SettingsListV2>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </>
  )
}
