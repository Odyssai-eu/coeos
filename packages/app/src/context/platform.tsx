import { createSimpleContext } from "@opencode-ai/ui/context"
import type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"
import type { Accessor } from "solid-js"
import type { DesktopMenuAction } from "../desktop-menu"
import { ServerConnection } from "./server"
import type { WslServersPlatform } from "../wsl/types"
import type { UpdaterPlatform } from "../updater"

type PickerPaths = string | string[] | null
type OpenDirectoryPickerOptions = { title?: string; multiple?: boolean }
type OpenAttachmentPickerOptions = {
  title?: string
  multiple?: boolean
  accept?: string[]
  extensions?: string[]
  defaultPath?: string
}
type SaveFilePickerOptions = { title?: string; defaultPath?: string }
type PlatformName = "web" | "desktop"
type DesktopOS = "macos" | "windows" | "linux"

export type FatalRendererErrorLog = {
  error: string
  url: string
  version?: string
  platform: PlatformName
  os?: DesktopOS
}

type PlatformBase = {
  /** App version */
  version?: string

  /** Open a URL in the default browser */
  openLink(url: string): void

  /** Open a local path in a local app (desktop only) */
  openPath?(path: string, app?: string): Promise<void>

  /** Restart the app  */
  restart(): Promise<void>

  /** Navigate back in history */
  back(): void

  /** Navigate forward in history */
  forward(): void

  /** Send a system notification (optional deep link) */
  notify(title: string, description?: string, href?: string): Promise<void>

  /** Open a native attachment picker and read selected files sequentially (desktop only) */
  openAttachmentPickerDialog?(
    opts: OpenAttachmentPickerOptions,
    onFile: (file: File) => Promise<unknown>,
  ): Promise<void>

  /** Resolve the native source path for a desktop File. */
  getPathForFile?(file: File): string

  /** Open a native save file picker dialog (desktop only) */
  saveFilePickerDialog?(opts?: SaveFilePickerOptions): Promise<string | null>
  writeTextFile?(path: string, content: string): Promise<void>

  /** Storage mechanism, defaults to localStorage */
  storage?: (name?: string) => SyncStorage | AsyncStorage

  /** Stable platform window identity for window-scoped persistence */
  windowID?: string

  /** Application-global desktop updater */
  updater?: UpdaterPlatform

  /** Fetch override */
  fetch?: typeof fetch

  /** Get the configured default server URL (platform-specific) */
  getDefaultServer?(): Promise<ServerConnection.Key | null>

  /** Set the default server URL to use on app startup (platform-specific) */
  setDefaultServer?(url: ServerConnection.Key | null): Promise<void> | void

  /** Manage WSL sidecar servers (Electron on Windows only) */
  wslServers?: WslServersPlatform

  /** Get the preferred display backend (desktop only) */
  getDisplayBackend?(): Promise<DisplayBackend | null> | DisplayBackend | null

  /** Set the preferred display backend (desktop only) */
  setDisplayBackend?(backend: DisplayBackend): Promise<void>

  /** Parse markdown to HTML using native parser (desktop only, returns unprocessed code blocks) */
  parseMarkdown?(markdown: string): Promise<string>

  /** Webview zoom level (desktop only) */
  webviewZoom?: Accessor<number>

  /** Get whether native pinch/Ctrl-scroll zoom gestures are enabled (desktop only) */
  getPinchZoomEnabled?(): Promise<boolean> | boolean

  /** Allow native pinch/Ctrl-scroll zoom gestures (desktop only) */
  setPinchZoomEnabled?(enabled: boolean): Promise<void> | void

  /** Get whether YOLO mode (accept all permissions) is enabled (desktop only) */
  getYolo?(): Promise<boolean> | boolean

  /** Enable/disable YOLO mode — accept all permissions without asking (desktop only, restart-to-apply) */
  setYolo?(enabled: boolean): Promise<void> | void

  /** Moteur CoeOS saisi par l'utilisatrice — sa propre box. Prime sur
   * l'endpoint provisionné ; vide = résolution normale (desktop only,
   * restart-to-apply). Aucune adresse en dur : c'est elle qui la donne. */
  getLocalEngine?(): Promise<{ url: string; token: string }>
  setLocalEngine?(url: string, token: string): Promise<void>

  /** Get the model id (bare, e.g. "or:glm-5.2") assigned to the Plan mode ("" = default CoeOS) (desktop only) */
  getExtraProviders?(): Promise<string>
  setExtraProviders?(raw: string): Promise<{ error: string; providers: string[] }>
  getTriageModel?(): Promise<string>
  setTriageModel?(id: string): Promise<void>
  listDeclaredModels?(): Promise<string[]>

  /** Settings > Providers (desktop only, restart-to-apply) : libellé du
   * routeur, moteur résolu au démarrage, moteurs déclarés + test direct. */
  getRouterName?(): Promise<string>
  setRouterName?(name: string): Promise<void>
  getResolvedEngine?(): Promise<{ baseUrl: string; source: string; models: number } | null>
  getEngines?(): Promise<Array<{ id: string; name: string; baseURL: string; apiKey: string; models: number }>>
  setEngines?(
    list: Array<{ id?: string; name: string; baseURL: string; apiKey: string }>,
  ): Promise<{ error: string; engines: Array<{ id: string; name: string; baseURL: string; apiKey: string }> }>
  testEngine?(baseURL: string, apiKey: string): Promise<{ ok: boolean; models: string[]; vendor?: string; error?: string }>
  getPlanModel?(): Promise<string> | string

  /** Assign a model to the Plan mode — bare id from /v1/models, "" resets to default (desktop only, restart-to-apply) */
  setPlanModel?(modelID: string): Promise<void> | void

  /** Get the model id (bare) assigned to the Build mode ("" = default CoeOS) (desktop only) */
  getBuildModel?(): Promise<string> | string

  /** Assign a model to the Build mode — bare id from /v1/models, "" resets to default (desktop only, restart-to-apply) */
  setBuildModel?(modelID: string): Promise<void> | void

  /** Import/merge un vault Obsidian dans la mémoire user (desktop only, restart-to-apply) */
  importMemoryVault?(
    sourcePath: string,
  ): Promise<{ imported: number; skipped: number; total: number; vault: string }>

  /** Emplacement du vault mémoire user (desktop only) */
  getMemoryVaultPath?(): Promise<string>

  /** Config de l'embedder du retrieval sémantique local (desktop only, restart-to-apply) */
  getMemoryEmbedConfig?(): Promise<{ embedURL: string; embedModel: string; embedKey: string }>
  setMemoryEmbedConfig?(cfg: { embedURL?: string; embedModel?: string; embedKey?: string }): Promise<void> | void

  /** Run a desktop-only menu action from the app chrome */
  runDesktopMenuAction?(action: DesktopMenuAction): Promise<void> | void

  /** Check if an editor app exists (desktop only) */
  checkAppExists?(appName: string): Promise<boolean>

  /** Read image from clipboard (desktop only) */
  readClipboardImage?(): Promise<File | null>

  /** Export collected diagnostic logs (desktop only) */
  exportDebugLogs?(): Promise<string>

  /** Record a fatal renderer error in platform logs (desktop only) */
  recordFatalRendererError?(error: FatalRendererErrorLog): Promise<void>
}

export type Platform = PlatformBase &
  (
    | { platform: "web"; os?: never }
    | {
        platform: "desktop"
        os?: DesktopOS
        openDirectoryPickerDialog(opts?: OpenDirectoryPickerOptions): Promise<PickerPaths>
      }
  )

export type DisplayBackend = "auto" | "wayland"

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
