import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { InlineInputV2 } from "@opencode-ai/ui/v2/inline-input-v2"
import { type Component, createEffect, createMemo, createResource, createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

// coeos-nemo — Settings > Memory. La mémoire user de Némo est un vault Obsidian
// LOCAL (markdown). Ici : importer/merger un vault + voir son emplacement.
// L'index du vault est injecté au démarrage par buildCoeosConfig
// (restart-to-apply). Desktop uniquement.
export const SettingsMemoryV2: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const desktop = createMemo(() => platform.platform === "desktop")

  const [vaultPath, { mutate: setVaultPath }] = createResource(
    () => (desktop() && platform.getMemoryVaultPath ? true : false),
    () => Promise.resolve(platform.getMemoryVaultPath?.() ?? "").catch(() => ""),
    { initialValue: "" },
  )
  const [busy, setBusy] = createSignal(false)

  // Embedder du retrieval sémantique (optionnel, 100% local). Vide = lexical seul.
  const [embedURL, setEmbedURL] = createSignal("")
  const [embedModel, setEmbedModel] = createSignal("")
  const [embedKey, setEmbedKey] = createSignal("")
  const [savingEmbed, setSavingEmbed] = createSignal(false)
  const [loadedEmbed] = createResource(
    () => (desktop() && platform.getMemoryEmbedConfig ? true : false),
    () => platform.getMemoryEmbedConfig?.() ?? { embedURL: "", embedModel: "", embedKey: "" },
  )
  createEffect(() => {
    const c = loadedEmbed()
    if (!c) return
    setEmbedURL(c.embedURL)
    setEmbedModel(c.embedModel)
    setEmbedKey(c.embedKey)
  })

  const onSaveEmbed = async () => {
    if (platform.platform !== "desktop" || !platform.setMemoryEmbedConfig) return
    setSavingEmbed(true)
    try {
      await platform.setMemoryEmbedConfig({
        embedURL: embedURL().trim(),
        embedModel: embedModel().trim(),
        embedKey: embedKey().trim(),
      })
      showToast({
        variant: "default",
        title: language.t("settings.memory.embed.saved"),
        description: language.t("settings.memory.restart"),
      })
    } catch (e) {
      showToast({ variant: "error", title: language.t("settings.memory.failed"), description: String(e) })
    } finally {
      setSavingEmbed(false)
    }
  }

  const onImport = async () => {
    if (platform.platform !== "desktop" || !platform.importMemoryVault || !platform.openDirectoryPickerDialog) return
    const picked = await platform.openDirectoryPickerDialog({ title: language.t("settings.memory.import.title") })
    const src = Array.isArray(picked) ? picked[0] : picked
    if (!src) return
    setBusy(true)
    try {
      const r = await platform.importMemoryVault(src)
      showToast({
        variant: "default",
        title: `${r.imported} note(s) ajoutée(s), ${r.skipped} déjà présente(s) — ${r.total} .md`,
        description: language.t("settings.memory.restart"),
      })
      void platform.getMemoryVaultPath?.().then((p) => setVaultPath(p ?? ""))
    } catch (e) {
      showToast({ variant: "error", title: language.t("settings.memory.failed"), description: String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.memory.title")}</h2>
      </div>

      <div class="settings-v2-tab-body">
        <Show
          when={desktop()}
          fallback={
            <div class="settings-v2-section">
              <p>{language.t("settings.memory.desktopOnly")}</p>
            </div>
          }
        >
          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("settings.memory.section.vault")}</h3>

            <SettingsListV2>
              <SettingsRowV2
                title={language.t("settings.memory.import.title")}
                description={language.t("settings.memory.import.description")}
              >
                <ButtonV2 size="normal" variant="neutral" disabled={busy()} onClick={onImport}>
                  {language.t("settings.memory.import.button")}
                </ButtonV2>
              </SettingsRowV2>

              <SettingsRowV2 title={language.t("settings.memory.location.title")} description="">
                <code class="text-[11px] opacity-70 break-all">{vaultPath.latest || "—"}</code>
              </SettingsRowV2>
            </SettingsListV2>
          </div>

          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("settings.memory.section.semantic")}</h3>
            <p class="text-[12px] opacity-70">{language.t("settings.memory.embed.hint")}</p>
            <div class="flex flex-col gap-2">
              <InlineInputV2
                appearance="large"
                prefix={language.t("settings.memory.embed.url.label")}
                value={embedURL()}
                placeholder="http://…/v1/embeddings"
                onInput={(e) => setEmbedURL(e.currentTarget.value)}
              />
              <InlineInputV2
                appearance="large"
                prefix={language.t("settings.memory.embed.model.label")}
                value={embedModel()}
                placeholder="nemo-embed"
                onInput={(e) => setEmbedModel(e.currentTarget.value)}
              />
              <InlineInputV2
                appearance="large"
                type="password"
                prefix={language.t("settings.memory.embed.key.label")}
                value={embedKey()}
                placeholder="—"
                onInput={(e) => setEmbedKey(e.currentTarget.value)}
              />
            </div>
            <div class="mt-3">
              <ButtonV2 size="normal" variant="neutral" disabled={savingEmbed()} onClick={onSaveEmbed}>
                {language.t("settings.memory.embed.save")}
              </ButtonV2>
            </div>
          </div>
        </Show>
      </div>
    </>
  )
}
