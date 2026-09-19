// coeos-code v2 — Confirmation de retrait d'un serveur MCP.
// remove -> client.mcp.remove({ name }) : déconnecte et retire du config, puis
// rafraîchit la liste via onRemoved.
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { type Component, Show, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { formatServerError } from "@/utils/server-errors"
import "../settings-v2.css"

export const DialogRemoveMcpServer: Component<{ name: string; onRemoved: () => void | Promise<void> }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const [busy, setBusy] = createSignal(false)

  const remove = async () => {
    setBusy(true)
    try {
      await serverSdk().client.mcp.remove({ name: props.name })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "MCP server removed",
        description: props.name,
      })
      await props.onRemoved()
      dialog.close()
    } catch (err) {
      showToast({ title: "Failed to remove server", description: formatServerError(err, language.t) })
      setBusy(false)
    }
  }

  return (
    <Dialog fit class="settings-v2-server-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>Remove MCP server</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-col px-6 py-4">
        <p class="text-13-regular leading-5 text-v2-text-text-muted">
          Remove <span class="text-v2-text-text-base">{props.name}</span>? It will be disconnected and deleted from your
          config.
        </p>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={busy()} onClick={() => dialog.close()}>
          Cancel
        </ButtonV2>
        <ButtonV2 variant="danger" disabled={busy()} onClick={() => void remove()}>
          <Show when={busy()}>
            <LoaderV2 width={14} height={14} />
          </Show>
          Remove
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
