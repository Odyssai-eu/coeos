import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { showToast } from "@/utils/toast"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { createMemo, createResource, createSignal, type Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { DialogConnectProvider } from "../dialog-connect-provider"
import { DialogSelectProvider } from "../dialog-select-provider"
import { DialogCustomProvider } from "../dialog-custom-provider"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type ProviderSource = "env" | "api" | "config" | "custom"
type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number]

// Nemo (2026-09-19) : sur desktop, l'onglet Providers est celui de Nemo — le
// routeur CoeOS box (nom / URL / clé) et les moteurs OdyssAI déclarés, avec
// découverte des modèles sur /v1/models. Les sections upstream (Popular /
// Custom) écrivent la config globale d'opencode, que le sidecar filtre par
// `enabled_providers` : elles n'aboutissent à rien dans Nemo tant que ce
// verrou existe. On ne les montre pas mortes ; ce booléen les rend quand le
// verrou sera levé (décision séparée).
const NEMO_SHOW_UPSTREAM_PROVIDERS = false

type EngineDraft = { id?: string; name: string; baseURL: string; apiKey: string }
type TestResult = { ok: boolean; models: string[]; vendor?: string; error?: string }

const EMPTY_DRAFT: EngineDraft = { name: "", baseURL: "", apiKey: "" }

const PROVIDER_NOTES = [
  { match: (id: string) => id === "opencode", key: "dialog.provider.opencode.note" },
  { match: (id: string) => id === "opencode-go", key: "dialog.provider.opencodeGo.tagline" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
] as const

const PROVIDER_ICON_SIZE = 16

const testSummary = (r: TestResult | null | undefined) => {
  if (!r) return ""
  if (!r.ok) return r.error ?? "Unreachable."
  const head = r.models.slice(0, 6).join(", ")
  const more = r.models.length > 6 ? ` … (+${r.models.length - 6})` : ""
  const vendor = r.vendor ? ` — ${r.vendor}` : ""
  return `${r.models.length} model${r.models.length > 1 ? "s" : ""}${vendor}: ${head}${more}`
}

export const SettingsProvidersV2: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const serverSdk = useServerSDK()
  const serverSync = useServerSync()
  const providers = useProviders()

  const nemo = createMemo(() => platform.platform === "desktop" && !!platform.getEngines && !!platform.getLocalEngine)

  // ── Routeur : la CoeOS box ─────────────────────────────────────────────────
  const [localEngine, { mutate: setLocalEngineLocal }] = createResource(
    () => nemo(),
    () => Promise.resolve(platform.getLocalEngine?.() ?? { url: "", token: "" }).catch(() => ({ url: "", token: "" })),
  )
  const [routerName, { mutate: setRouterNameLocal }] = createResource(
    () => nemo(),
    () => Promise.resolve(platform.getRouterName?.() ?? "CoeOS box").catch(() => "CoeOS box"),
  )
  const [resolved] = createResource(
    () => nemo(),
    () => Promise.resolve(platform.getResolvedEngine?.() ?? null).catch(() => null),
  )
  const [nameDraft, setNameDraft] = createSignal<string | null>(null)
  const [urlDraft, setUrlDraft] = createSignal<string | null>(null)
  const [keyDraft, setKeyDraft] = createSignal<string | null>(null)
  const nameValue = () => nameDraft() ?? routerName.latest ?? "CoeOS box"
  const urlValue = () => urlDraft() ?? localEngine.latest?.url ?? ""
  const keyValue = () => keyDraft() ?? localEngine.latest?.token ?? ""
  const [routerTest, setRouterTest] = createSignal<TestResult | null>(null)
  const [routerTesting, setRouterTesting] = createSignal(false)

  // Quelque chose a changé : la config du sidecar est lue au spawn, il faut
  // relancer. Un seul bouton, visible tant que ce n'est pas fait.
  const [dirty, setDirty] = createSignal(false)

  const testRouter = async () => {
    const url = urlValue().trim()
    if (!url) {
      setRouterTest({ ok: false, models: [], error: "Enter the box URL first." })
      return
    }
    setRouterTesting(true)
    setRouterTest(null)
    const r = await platform.testEngine?.(url, keyValue().trim()).catch(() => null)
    setRouterTesting(false)
    setRouterTest(r ?? { ok: false, models: [], error: "Test failed." })
  }

  const saveRouter = async () => {
    const url = urlValue().trim()
    const token = keyValue().trim()
    const name = nameValue().trim()
    if (url && !/^https?:\/\//i.test(url)) {
      showToast({ variant: "error", title: "Invalid URL", description: "Must start with http:// or https://" })
      return
    }
    await platform.setLocalEngine?.(url, token)
    await platform.setRouterName?.(name)
    setLocalEngineLocal({ url, token })
    setRouterNameLocal(name || "CoeOS box")
    setNameDraft(null)
    setUrlDraft(null)
    setKeyDraft(null)
    setDirty(true)
    showToast({
      variant: "success",
      title: url ? "CoeOS box saved" : "CoeOS box address cleared",
      description: url ? `${url} — restart to apply.` : "Back to automatic discovery. Restart to apply.",
    })
  }

  // ── Moteurs déclarés (OdyssAI-x, autre box, OpenAI-compatible) ────────────
  const [engines, { refetch: refetchEngines }] = createResource(
    () => nemo(),
    () => Promise.resolve(platform.getEngines?.() ?? []).catch(() => []),
    { initialValue: [] as Array<EngineDraft & { id: string; models: number }> },
  )
  const [draft, setDraft] = createSignal<EngineDraft>({ ...EMPTY_DRAFT })
  const editing = () => draft().id
  const [draftTest, setDraftTest] = createSignal<TestResult | null>(null)
  const [draftTesting, setDraftTesting] = createSignal(false)
  const setField = (key: keyof EngineDraft, value: string) => setDraft((d) => ({ ...d, [key]: value }))
  const resetDraft = () => {
    setDraft({ ...EMPTY_DRAFT })
    setDraftTest(null)
  }

  const testDraft = async () => {
    const url = draft().baseURL.trim()
    if (!url) {
      setDraftTest({ ok: false, models: [], error: "Enter the engine URL first." })
      return
    }
    setDraftTesting(true)
    setDraftTest(null)
    const r = await platform.testEngine?.(url, draft().apiKey.trim()).catch(() => null)
    setDraftTesting(false)
    setDraftTest(r ?? { ok: false, models: [], error: "Test failed." })
  }

  const persistEngines = async (next: EngineDraft[], done: string) => {
    const res = await platform.setEngines?.(next)
    if (!res) return
    if (res.error) {
      showToast({ variant: "error", title: "Not saved", description: res.error })
      return
    }
    await refetchEngines()
    setDirty(true)
    showToast({ variant: "success", title: done, description: "Restart to apply." })
    resetDraft()
  }

  const submitDraft = async () => {
    const d = draft()
    const current = engines.latest ?? []
    const entry: EngineDraft = { id: d.id, name: d.name.trim(), baseURL: d.baseURL.trim(), apiKey: d.apiKey.trim() }
    if (!entry.name) {
      showToast({ variant: "error", title: "Name required", description: "Give the engine a name." })
      return
    }
    if (!/^https?:\/\//i.test(entry.baseURL)) {
      showToast({ variant: "error", title: "Invalid URL", description: "Must start with http:// or https://" })
      return
    }
    const next = d.id
      ? current.map((e) => (e.id === d.id ? entry : { id: e.id, name: e.name, baseURL: e.baseURL, apiKey: e.apiKey }))
      : [...current.map((e) => ({ id: e.id, name: e.name, baseURL: e.baseURL, apiKey: e.apiKey })), entry]
    await persistEngines(next, d.id ? `${entry.name} updated` : `${entry.name} added`)
  }

  const removeEngine = async (id: string, name: string) => {
    const next = (engines.latest ?? []).filter((e) => e.id !== id).map((e) => ({ id: e.id, name: e.name, baseURL: e.baseURL, apiKey: e.apiKey }))
    await persistEngines(next, `${name} removed`)
  }

  const editEngine = (e: EngineDraft & { id: string }) => {
    setDraft({ id: e.id, name: e.name, baseURL: e.baseURL, apiKey: e.apiKey })
    setDraftTest(null)
  }

  // ── Upstream (masqué sur desktop tant que le verrou existe) ───────────────
  const connected = createMemo(() => {
    return providers
      .connected()
      .filter((p) => p.id !== "opencode" || Object.values(p.models).find((m) => m.cost?.input))
  })

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    const items = providers
      .popular()
      .filter((p) => !connectedIDs.has(p.id))
      .slice()
    items.sort((a, b) => popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id))
    return items
  })

  const source = (item: ProviderItem): ProviderSource | undefined => {
    if (!("source" in item)) return
    const value = item.source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  const type = (item: ProviderItem) => {
    const current = source(item)
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "config") {
      if (isConfigCustom(item.id)) return language.t("settings.providers.tag.custom")
      return language.t("settings.providers.tag.config")
    }
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const canDisconnect = (item: ProviderItem) => source(item) !== "env"

  const note = (id: string) => PROVIDER_NOTES.find((item) => item.match(id))?.key

  const isConfigCustom = (providerID: string) => {
    const provider = serverSync().data.config.provider?.[providerID]
    if (!provider) return false
    if (provider.npm !== "@ai-sdk/openai-compatible") return false
    if (!provider.models || Object.keys(provider.models).length === 0) return false
    return true
  }

  const disableProvider = async (providerID: string, name: string) => {
    const before = serverSync().data.config.disabled_providers ?? []
    const next = before.includes(providerID) ? before : [...before, providerID]
    serverSync().set("config", "disabled_providers", next)

    await serverSync()
      .updateConfig({ disabled_providers: next })
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        serverSync().set("config", "disabled_providers", before)
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  const disconnect = async (providerID: string, name: string) => {
    if (isConfigCustom(providerID)) {
      await serverSdk()
        .client.auth.remove({ providerID })
        .catch(() => undefined)
      await disableProvider(providerID, name)
      return
    }
    await serverSdk()
      .client.auth.remove({ providerID })
      .then(async () => {
        await serverSdk().client.global.dispose()
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  const showUpstream = () => !nemo() || NEMO_SHOW_UPSTREAM_PROVIDERS

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.providers.title")}</h2>
      </div>

      <div class="settings-v2-tab-body settings-v2-providers">
        <Show when={nemo()}>
          <Show when={dirty()}>
            <div class="settings-v2-section" data-component="nemo-restart-banner">
              <SettingsListV2>
                <SettingsRowV2
                  title="Restart required"
                  description="Provider changes are read when Nemo starts. Restart now to apply them."
                >
                  <ButtonV2 size="normal" variant="neutral" onClick={() => void platform.restart()}>
                    Restart Nemo
                  </ButtonV2>
                </SettingsRowV2>
              </SettingsListV2>
            </div>
          </Show>

          <div class="settings-v2-section" data-component="nemo-router-section">
            <h3 class="settings-v2-section-title">{nameValue() || "CoeOS box"}</h3>
            <SettingsListV2>
              <SettingsRowV2
                title="Status"
                description={
                  resolved.latest
                    ? `Connected to ${resolved.latest.baseUrl} (${resolved.latest.source}) — ${resolved.latest.models} model${resolved.latest.models === 1 ? "" : "s"} published.`
                    : "Not connected. Enter your CoeOS box address below."
                }
              >
                <Tag>{resolved.latest ? "Connected" : "Offline"}</Tag>
              </SettingsRowV2>
              <SettingsRowV2 title="Name" description="How this box is labelled in the model picker.">
                <TextInputV2
                  data-action="settings-router-name"
                  placeholder="CoeOS box"
                  value={nameValue()}
                  onInput={(e) => setNameDraft(e.currentTarget.value)}
                />
              </SettingsRowV2>
              <SettingsRowV2
                title="URL"
                description="Your CoeOS box: a box on your network, https://api.coeos.io, or any CoeOS on a server. Leave empty to let Nemo discover a box on the local network."
              >
                <TextInputV2
                  data-action="settings-local-engine-url"
                  placeholder="https://api.coeos.io"
                  value={urlValue()}
                  onInput={(e) => setUrlDraft(e.currentTarget.value)}
                  spellcheck={false}
                  autocorrect="off"
                  autocapitalize="off"
                />
              </SettingsRowV2>
              <SettingsRowV2 title="API key" description="Only if the box requires one (api.coeos.io does: ck_…).">
                <TextInputV2
                  data-action="settings-local-engine-token"
                  type="password"
                  placeholder="Optional"
                  value={keyValue()}
                  onInput={(e) => setKeyDraft(e.currentTarget.value)}
                />
              </SettingsRowV2>
              <SettingsRowV2
                title=""
                description={routerTesting() ? "Testing…" : testSummary(routerTest())}
              >
                <div style={{ display: "flex", gap: "8px" }}>
                  <ButtonV2 size="normal" variant="ghost-muted" disabled={routerTesting()} onClick={() => void testRouter()}>
                    Test
                  </ButtonV2>
                  <ButtonV2 size="normal" variant="neutral" data-action="settings-local-engine-save" onClick={() => void saveRouter()}>
                    Save
                  </ButtonV2>
                </div>
              </SettingsRowV2>
            </SettingsListV2>
          </div>

          <div class="settings-v2-section" data-component="nemo-engines-section">
            <h3 class="settings-v2-section-title">OdyssAI engines</h3>
            <SettingsListV2>
              <Show
                when={(engines.latest ?? []).length > 0}
                fallback={
                  <div class="settings-v2-provider-empty">
                    No extra engine. Add an OdyssAI-x engine, another CoeOS box, or any OpenAI-compatible server: its
                    published models join the picker.
                  </div>
                }
              >
                <For each={engines.latest ?? []}>
                  {(item) => (
                    <div class="settings-v2-provider-row group">
                      <div class="settings-v2-provider-lead">
                        <ProviderIcon
                          id="synthetic"
                          width={PROVIDER_ICON_SIZE}
                          height={PROVIDER_ICON_SIZE}
                          class="settings-v2-provider-icon shrink-0"
                        />
                        <div class="settings-v2-provider-copy">
                          <div class="settings-v2-provider-main">
                            <span class="settings-v2-provider-name truncate">{item.name}</span>
                            <Tag>{item.models ? `${item.models} model${item.models > 1 ? "s" : ""}` : "no models yet"}</Tag>
                          </div>
                          <p class="settings-v2-provider-description">{item.baseURL}</p>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <ButtonV2 size="normal" variant="ghost-muted" onClick={() => editEngine(item)}>
                          Edit
                        </ButtonV2>
                        <ButtonV2 size="normal" variant="ghost-muted" onClick={() => void removeEngine(item.id, item.name)}>
                          Remove
                        </ButtonV2>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </SettingsListV2>

            <div class="settings-v2-models-group-header" style={{ "margin-top": "12px" }}>
              <h3 class="settings-v2-section-title">{editing() ? `Edit ${draft().name || "engine"}` : "Add an engine"}</h3>
            </div>
            <SettingsListV2>
              <SettingsRowV2 title="Name" description="Shown as the group header in the model picker.">
                <TextInputV2
                  data-action="settings-engine-name"
                  placeholder="OdyssAI-x"
                  value={draft().name}
                  onInput={(e) => setField("name", e.currentTarget.value)}
                />
              </SettingsRowV2>
              <SettingsRowV2 title="URL" description="Engine root, without /v1. Example: http://engine.lan:8000">
                <TextInputV2
                  data-action="settings-engine-url"
                  placeholder="http://engine.lan:8000"
                  value={draft().baseURL}
                  onInput={(e) => setField("baseURL", e.currentTarget.value)}
                  spellcheck={false}
                  autocorrect="off"
                  autocapitalize="off"
                />
              </SettingsRowV2>
              <SettingsRowV2 title="API key" description="Only if the engine requires one.">
                <TextInputV2
                  data-action="settings-engine-key"
                  type="password"
                  placeholder="Optional"
                  value={draft().apiKey}
                  onInput={(e) => setField("apiKey", e.currentTarget.value)}
                />
              </SettingsRowV2>
              <SettingsRowV2 title="" description={draftTesting() ? "Testing…" : testSummary(draftTest())}>
                <div style={{ display: "flex", gap: "8px" }}>
                  <Show when={editing()}>
                    <ButtonV2 size="normal" variant="ghost-muted" onClick={resetDraft}>
                      Cancel
                    </ButtonV2>
                  </Show>
                  <ButtonV2 size="normal" variant="ghost-muted" disabled={draftTesting()} onClick={() => void testDraft()}>
                    Test
                  </ButtonV2>
                  <ButtonV2
                    size="normal"
                    variant="neutral"
                    icon={editing() ? undefined : "plus"}
                    data-action="settings-engine-submit"
                    onClick={() => void submitDraft()}
                  >
                    {editing() ? "Update" : "Add"}
                  </ButtonV2>
                </div>
              </SettingsRowV2>
            </SettingsListV2>
          </div>
        </Show>

        <Show when={showUpstream()}>
          <div class="settings-v2-section" data-component="connected-providers-section">
            <h3 class="settings-v2-section-title">{language.t("settings.providers.section.connected")}</h3>
            <SettingsListV2>
              <Show
                when={connected().length > 0}
                fallback={
                  <div class="settings-v2-provider-empty">{language.t("settings.providers.connected.empty")}</div>
                }
              >
                <For each={connected()}>
                  {(item) => (
                    <div class="settings-v2-provider-row group">
                      <div class="settings-v2-provider-lead">
                        <ProviderIcon
                          id={item.id}
                          width={PROVIDER_ICON_SIZE}
                          height={PROVIDER_ICON_SIZE}
                          class="settings-v2-provider-icon shrink-0"
                        />
                        <div class="settings-v2-provider-main">
                          <span class="settings-v2-provider-name truncate">{item.name}</span>
                          <Tag>{type(item)}</Tag>
                        </div>
                      </div>
                      <Show
                        when={canDisconnect(item)}
                        fallback={
                          <span class="settings-v2-provider-env-hint">
                            {language.t("settings.providers.connected.environmentDescription")}
                          </span>
                        }
                      >
                        <ButtonV2 size="normal" variant="ghost-muted" onClick={() => void disconnect(item.id, item.name)}>
                          {language.t("common.disconnect")}
                        </ButtonV2>
                      </Show>
                    </div>
                  )}
                </For>
              </Show>
            </SettingsListV2>
          </div>

          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("settings.providers.section.popular")}</h3>
            <SettingsListV2>
              <For each={popular()}>
                {(item) => (
                  <div class="settings-v2-provider-row">
                    <div class="settings-v2-provider-lead">
                      <ProviderIcon
                        id={item.id}
                        width={PROVIDER_ICON_SIZE}
                        height={PROVIDER_ICON_SIZE}
                        class="settings-v2-provider-icon shrink-0"
                      />
                      <div class="settings-v2-provider-copy">
                        <div class="settings-v2-provider-main">
                          <span class="settings-v2-provider-name">{item.name}</span>
                          <Show when={item.id === "opencode" || item.id === "opencode-go"}>
                            <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                          </Show>
                        </div>
                        <Show when={note(item.id)}>
                          {(key) => <p class="settings-v2-provider-description">{language.t(key())}</p>}
                        </Show>
                      </div>
                    </div>
                    <ButtonV2
                      size="normal"
                      variant="neutral"
                      icon="plus"
                      onClick={() => {
                        dialog.show(() => <DialogConnectProvider provider={item.id} />)
                      }}
                    >
                      {language.t("common.connect")}
                    </ButtonV2>
                  </div>
                )}
              </For>

              <div class="settings-v2-provider-row" data-component="custom-provider-section">
                <div class="settings-v2-provider-lead">
                  <ProviderIcon
                    id="synthetic"
                    width={PROVIDER_ICON_SIZE}
                    height={PROVIDER_ICON_SIZE}
                    class="settings-v2-provider-icon shrink-0"
                  />
                  <div class="settings-v2-provider-copy">
                    <div class="settings-v2-provider-main">
                      <span class="settings-v2-provider-name">{language.t("provider.custom.title")}</span>
                      <Tag>{language.t("settings.providers.tag.custom")}</Tag>
                    </div>
                    <p class="settings-v2-provider-description">{language.t("settings.providers.custom.description")}</p>
                  </div>
                </div>
                <ButtonV2
                  size="normal"
                  variant="neutral"
                  icon="plus"
                  onClick={() => {
                    dialog.show(() => <DialogCustomProvider back="close" />)
                  }}
                >
                  {language.t("common.connect")}
                </ButtonV2>
              </div>
            </SettingsListV2>

            <button
              type="button"
              class="settings-v2-providers-view-all"
              onClick={() => {
                dialog.show(() => <DialogSelectProvider />)
              }}
            >
              {language.t("dialog.provider.viewAll")}
            </button>
          </div>
        </Show>
      </div>
    </>
  )
}
