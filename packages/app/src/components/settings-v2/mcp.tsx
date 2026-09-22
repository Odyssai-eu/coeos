// coeos-code v2 — Settings > MCP Servers (2026-08-02).
// Liste des serveurs MCP avec statut live (client.mcp.status), ajout (form +
// presets), authentification OAuth, connexion/déconnexion et retrait. Toute
// action rafraîchit la liste. i18n : seul le titre passe par les traductions,
// le reste est en anglais en dur (périmètre restreint à ce panneau).
import type { McpRemoteConfig, McpStatus } from "@opencode-ai/sdk/v2/client"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { type Component, For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { formatServerError } from "@/utils/server-errors"
import { SettingsListV2 } from "./parts/list"
import { DialogAddMcpServer } from "./mcp/dialog-add-server"
import { DialogRemoveMcpServer } from "./mcp/dialog-remove-server"
import { McpStatusBadge } from "./mcp/mcp-status-badge"
import "./settings-v2.css"

// Presets « quick add » ; Notion demande une authentification OAuth après ajout.
const PRESETS: { name: string; label: string; config: McpRemoteConfig }[] = [
  { name: "notion", label: "Notion", config: { type: "remote", url: "https://mcp.notion.com/mcp" } },
  { name: "huggingface", label: "HuggingFace", config: { type: "remote", url: "https://huggingface.co/mcp" } },
]

export function SettingsMcpV2(): ReturnType<Component> {
  const language = useLanguage()
  const dialog = useDialog()
  const serverSdk = useServerSDK()
  const serverSync = useServerSync()

  // Statut live de tous les serveurs configurés : Record<name, McpStatus>.
  const [status, { refetch }] = createResource(
    () => serverSdk(),
    (sdk) => sdk.client.mcp.status().then((response) => response.data ?? {}),
  )

  const names = createMemo(() => Object.keys(status() ?? {}).sort((a, b) => a.localeCompare(b)))
  const statusOf = (name: string): McpStatus | undefined => status()?.[name]

  // Type (remote/local) lu depuis le config ; source du statut = mcp.status().
  const typeOf = (name: string): "remote" | "local" | undefined => {
    const config = serverSync().data.config.mcp?.[name]
    if (config && "type" in config) return config.type
    return undefined
  }

  // Suivi des actions en cours par serveur (spinner + désactivation).
  const [pending, setPending] = createSignal(new Set<string>())
  const busy = (name: string) => pending().has(name)

  const withBusy = async (name: string, action: () => Promise<unknown>, failureTitle: string) => {
    if (busy(name)) return
    setPending((prev) => new Set(prev).add(name))
    try {
      await action()
      await refetch()
    } catch (err) {
      showToast({ title: failureTitle, description: formatServerError(err, language.t) })
    } finally {
      setPending((prev) => {
        const next = new Set(prev)
        next.delete(name)
        return next
      })
    }
  }

  const connect = (name: string) =>
    withBusy(name, () => serverSdk().client.mcp.connect({ name }), "Failed to connect server")
  const disconnect = (name: string) =>
    withBusy(name, () => serverSdk().client.mcp.disconnect({ name }), "Failed to disconnect server")
  const authenticate = (name: string) =>
    withBusy(name, () => serverSdk().client.mcp.auth.authenticate({ name }), "Authentication failed")

  const savePreset = (preset: (typeof PRESETS)[number]) =>
    withBusy(
      preset.name,
      async () => {
        await serverSdk().client.mcp.save({ name: preset.name, config: preset.config })
        showToast({ variant: "success", icon: "circle-check", title: "MCP server added", description: preset.label })
      },
      "Failed to add server",
    )

  const refresh = async () => {
    await refetch()
  }
  const openAdd = () => dialog.push(() => <DialogAddMcpServer onSaved={refresh} />)
  const openRemove = (name: string) => dialog.push(() => <DialogRemoveMcpServer name={name} onRemoved={refresh} />)

  const needsAuth = (name: string) => {
    const state = statusOf(name)?.status
    return state === "needs_auth" || state === "needs_client_registration"
  }

  return (
    <>
      <div class="settings-v2-tab-header settings-v2-servers-header">
        <div class="settings-v2-tab-header-row">
          <h2 class="settings-v2-tab-title">{language.t("settings.mcp.title")}</h2>
          <ButtonV2 variant="contrast" size="small" onClick={openAdd}>
            <IconV2 name="plus" size="small" />
            Add server
          </ButtonV2>
        </div>
      </div>

      <div class="settings-v2-tab-body settings-v2-servers">
        <div class="mb-6 flex flex-wrap items-center gap-2">
          <span class="text-11-regular text-v2-text-text-muted">Quick add</span>
          <For each={PRESETS}>
            {(preset) => (
              <ButtonV2
                variant="neutral"
                size="small"
                disabled={names().includes(preset.name) || busy(preset.name)}
                onClick={() => savePreset(preset)}
              >
                <Show when={busy(preset.name)} fallback={<IconV2 name="plus" size="small" />}>
                  <LoaderV2 width={14} height={14} />
                </Show>
                {preset.label}
              </ButtonV2>
            )}
          </For>
        </div>

        <Show
          when={!status.loading || status() !== undefined}
          fallback={<div class="settings-v2-servers-status">Loading…</div>}
        >
          <Show
            when={!status.error}
            fallback={
              <div class="settings-v2-servers-status">
                <span>Could not load MCP servers.</span>
                <span class="settings-v2-servers-status-filter">{formatServerError(status.error, language.t)}</span>
              </div>
            }
          >
            <Show
              when={names().length > 0}
              fallback={
                <div class="settings-v2-servers-status">No MCP servers configured. Add one to get started.</div>
              }
            >
              <SettingsListV2>
                <For each={names()}>
                  {(name) => (
                    <div class="settings-v2-servers-row">
                      <div class="settings-v2-servers-lead">
                        <div class="settings-v2-servers-copy">
                          <span class="settings-v2-servers-name">{name}</span>
                          <Show when={typeOf(name)}>
                            <span class="settings-v2-servers-meta">
                              {typeOf(name) === "remote" ? "Remote" : "Local"}
                            </span>
                          </Show>
                        </div>
                      </div>
                      <div class="settings-v2-servers-actions">
                        <McpStatusBadge status={statusOf(name)} />

                        <Show when={needsAuth(name)}>
                          <ButtonV2
                            variant="neutral"
                            size="small"
                            disabled={busy(name)}
                            onClick={() => authenticate(name)}
                          >
                            <Show when={busy(name)}>
                              <LoaderV2 width={14} height={14} />
                            </Show>
                            Authenticate
                          </ButtonV2>
                        </Show>

                        <MenuV2 gutter={6} modal={false} placement="bottom-end">
                          <MenuV2.Trigger
                            as={IconButtonV2}
                            variant="ghost-muted"
                            size="small"
                            icon={<IconV2 name="outline-dots" />}
                            disabled={busy(name)}
                            aria-label="More options"
                          />
                          <MenuV2.Portal>
                            <MenuV2.Content>
                              <MenuV2.Group>
                                <Show when={statusOf(name)?.status === "connected"}>
                                  <MenuV2.Item onSelect={() => disconnect(name)}>Disconnect</MenuV2.Item>
                                </Show>
                                <Show
                                  when={
                                    statusOf(name)?.status === "disabled" || statusOf(name)?.status === "failed"
                                  }
                                >
                                  <MenuV2.Item onSelect={() => connect(name)}>Connect</MenuV2.Item>
                                </Show>
                                <MenuV2.Separator />
                                <MenuV2.Item class="text-v2-state-fg-danger" onSelect={() => openRemove(name)}>
                                  Remove
                                </MenuV2.Item>
                              </MenuV2.Group>
                            </MenuV2.Content>
                          </MenuV2.Portal>
                        </MenuV2>
                      </div>
                    </div>
                  )}
                </For>
              </SettingsListV2>
            </Show>
          </Show>
        </Show>
      </div>
    </>
  )
}
