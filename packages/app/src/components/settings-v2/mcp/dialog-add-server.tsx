// coeos-code v2 — Formulaire d'ajout d'un serveur MCP (remote ou local).
// Save -> client.mcp.save({ name, config }) : persiste dans opencode.json et
// connecte à chaud, puis rafraîchit la liste via onSaved.
import type { McpLocalConfig, McpRemoteConfig } from "@opencode-ai/sdk/v2/client"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { type Component, Show, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { formatServerError } from "@/utils/server-errors"
import "../settings-v2.css"

type McpType = "remote" | "local"
const TYPE_OPTIONS: McpType[] = ["remote", "local"]
const typeLabel = (value: McpType) => (value === "remote" ? "Remote" : "Local")

// "KEY=value" par ligne -> Record ; lignes vides et commentaires (#) ignorés.
function parseEnvironment(raw: string): Record<string, string> | undefined {
  const entries: Record<string, string> = {}
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    entries[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return Object.keys(entries).length > 0 ? entries : undefined
}

export const DialogAddMcpServer: Component<{ onSaved: () => void | Promise<void> }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSdk = useServerSDK()

  const [name, setName] = createSignal("")
  const [type, setType] = createSignal<McpType>("remote")
  const [url, setUrl] = createSignal("")
  const [command, setCommand] = createSignal("")
  const [environment, setEnvironment] = createSignal("")
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)

  // Construit la config typée à partir du formulaire, ou remonte une erreur.
  const buildConfig = (): McpRemoteConfig | McpLocalConfig | undefined => {
    if (type() === "remote") {
      const value = url().trim()
      if (!value) {
        setError("A URL is required for a remote server.")
        return undefined
      }
      return { type: "remote", url: value }
    }
    const parts = command().trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) {
      setError("A command is required for a local server.")
      return undefined
    }
    const env = parseEnvironment(environment())
    return { type: "local", command: parts, ...(env ? { environment: env } : {}) }
  }

  const save = async () => {
    setError(undefined)
    const serverName = name().trim()
    if (!serverName) {
      setError("A name is required.")
      return
    }
    const config = buildConfig()
    if (!config) return

    setBusy(true)
    try {
      await serverSdk().client.mcp.save({ name: serverName, config })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "MCP server added",
        description: serverName,
      })
      await props.onSaved()
      dialog.close()
    } catch (err) {
      setError(formatServerError(err, language.t))
    } finally {
      setBusy(false)
    }
  }

  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    void save()
  }

  return (
    <Dialog fit class="settings-v2-server-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>Add MCP server</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2">
        <div class="flex w-full min-w-0 flex-col gap-6">
          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">Name</label>
            <TextInputV2
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              value={name()}
              placeholder="notion"
              disabled={busy()}
              autofocus
              onInput={(event) => setName(event.currentTarget.value)}
              onKeyDown={keyDown}
            />
          </div>

          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">Type</label>
            <SelectV2
              appearance="large"
              class="!w-full self-stretch"
              options={TYPE_OPTIONS}
              current={type()}
              value={(item) => item}
              label={typeLabel}
              disabled={busy()}
              onSelect={(value) => value && setType(value)}
            />
          </div>

          <Show
            when={type() === "remote"}
            fallback={
              <>
                <div class="flex w-full min-w-0 flex-col gap-2">
                  <label class="settings-v2-server-dialog-label">Command</label>
                  <TextInputV2
                    type="text"
                    appearance="large"
                    class="!w-full self-stretch"
                    value={command()}
                    placeholder="npx -y @modelcontextprotocol/server-filesystem /path"
                    disabled={busy()}
                    onInput={(event) => setCommand(event.currentTarget.value)}
                    onKeyDown={keyDown}
                  />
                </div>
                <div class="flex w-full min-w-0 flex-col gap-2">
                  <label class="settings-v2-server-dialog-label">Environment (optional)</label>
                  <TextareaV2
                    class="!w-full self-stretch"
                    value={environment()}
                    placeholder="KEY=value"
                    rows={3}
                    disabled={busy()}
                    onInput={(event) => setEnvironment(event.currentTarget.value)}
                  />
                </div>
              </>
            }
          >
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">URL</label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                value={url()}
                placeholder="https://mcp.notion.com/mcp"
                disabled={busy()}
                onInput={(event) => setUrl(event.currentTarget.value)}
                onKeyDown={keyDown}
              />
            </div>
          </Show>

          <Show when={error()}>
            <span class="settings-v2-server-dialog-error">{error()}</span>
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={busy()} onClick={() => dialog.close()}>
          Cancel
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={busy()} onClick={() => void save()}>
          <Show when={busy()}>
            <LoaderV2 width={14} height={14} />
          </Show>
          Add server
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
