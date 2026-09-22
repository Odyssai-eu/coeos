// coeos-code v2 — Badge de statut live d'un serveur MCP.
// Point coloré + libellé anglais ; l'erreur (failed / needs_client_registration)
// est exposée en tooltip.
import type { McpStatus } from "@opencode-ai/sdk/v2/client"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Show, createMemo, type Component } from "solid-js"

type Tone = "success" | "danger" | "warning" | "muted"

interface StatusInfo {
  tone: Tone
  label: string
  error?: string
}

// Traduit l'union discriminée McpStatus en couleur + libellé affichable.
function describe(status: McpStatus | undefined): StatusInfo {
  switch (status?.status) {
    case "connected":
      return { tone: "success", label: "Connected" }
    case "failed":
      return { tone: "danger", label: "Failed", error: status.error }
    case "needs_auth":
      return { tone: "warning", label: "Needs auth" }
    case "needs_client_registration":
      return { tone: "warning", label: "Needs registration", error: status.error }
    case "disabled":
      return { tone: "muted", label: "Disabled" }
    default:
      return { tone: "muted", label: "Unknown" }
  }
}

const StatusTag: Component<{ info: () => StatusInfo }> = (props) => (
  <Tag data-high-contrast>
    <span
      class="size-1.5 shrink-0 rounded-full"
      classList={{
        "bg-v2-state-fg-success": props.info().tone === "success",
        "bg-v2-state-fg-danger": props.info().tone === "danger",
        "bg-v2-state-fg-warning": props.info().tone === "warning",
        "bg-v2-icon-icon-muted": props.info().tone === "muted",
      }}
    />
    {props.info().label}
  </Tag>
)

export const McpStatusBadge: Component<{ status: McpStatus | undefined }> = (props) => {
  const info = createMemo(() => describe(props.status))
  return (
    <Show when={info().error} fallback={<StatusTag info={info} />}>
      {(error) => (
        <TooltipV2 value={error()}>
          <StatusTag info={info} />
        </TooltipV2>
      )}
    </Show>
  )
}
