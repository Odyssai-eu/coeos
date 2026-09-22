import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"
import type { WslServersPlatform } from "@opencode-ai/app/wsl/types"
import type { UpdaterState } from "@opencode-ai/app/updater"
export type {
  WslDistroProbe,
  WslInstalledDistro,
  WslJob,
  WslOnlineDistro,
  WslOpencodeCheck,
  WslRuntimeCheck,
  WslServerConfig,
  WslServerItem,
  WslServerRuntime,
  WslServersEvent,
  WslServersState,
} from "@opencode-ai/app/wsl/types"

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

export type WslServersAPI = WslServersPlatform
export type UpdaterAPI = {
  subscribe: (cb: (state: UpdaterState) => void) => Promise<() => void>
  check: () => Promise<UpdaterState>
  install: () => Promise<void>
}

export type LinuxDisplayBackend = "wayland" | "auto"
export type TitlebarTheme = {
  mode: "light" | "dark"
}
export type FatalRendererError = {
  error: string
  url: string
  version?: string
  platform: string
  os?: string
}

export type ElectronAPI = {
  killSidecar: () => Promise<void>
  installCli: () => Promise<string>
  awaitInitialization: () => Promise<ServerReadyData>
  wslServers: WslServersAPI
  updater: UpdaterAPI
  consumeInitialDeepLinks: () => Promise<string[]>
  getDefaultServerUrl: () => Promise<string | null>
  setDefaultServerUrl: (url: string | null) => Promise<void>
  getDisplayBackend: () => Promise<LinuxDisplayBackend | null>
  setDisplayBackend: (backend: LinuxDisplayBackend | null) => Promise<void>
  parseMarkdownCommand: (markdown: string) => Promise<string>
  checkAppExists: (appName: string) => Promise<boolean>
  resolveAppPath: (appName: string) => Promise<string | null>
  storeGet: (name: string, key: string) => Promise<string | null>
  storeSet: (name: string, key: string, value: string) => Promise<void>
  storeDelete: (name: string, key: string) => Promise<void>
  storeClear: (name: string) => Promise<void>
  storeKeys: (name: string) => Promise<string[]>
  storeLength: (name: string) => Promise<number>

  getWindowCount: () => Promise<number>
  getWindowID: () => Promise<string>
  onMenuCommand: (cb: (id: string) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void

  openDirectoryPicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
  }) => Promise<string | string[] | null>
  // Mémoire user (vault Obsidian local) : importer/merger un vault, connaître son
  // emplacement.
  importMemoryVault: (
    sourcePath: string,
  ) => Promise<{ imported: number; skipped: number; total: number; vault: string }>
  getMemoryVaultPath: () => Promise<string>
  getMemoryEmbedConfig: () => Promise<{ embedURL: string; embedModel: string; embedKey: string }>
  setMemoryEmbedConfig: (cfg: { embedURL?: string; embedModel?: string; embedKey?: string }) => Promise<void>
  openFilePicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
    extensions?: string[]
  }) => Promise<{ token: string; files: { path: string; name: string; size: number }[] } | null>
  readPickedFile: (token: string, path: string) => Promise<ArrayBuffer>
  releasePickedFiles: (token: string) => Promise<void>
  getPathForFile: (file: File) => string
  saveFilePicker: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  writeFile: (path: string, content: string) => Promise<boolean>
  openLink: (url: string) => void
  openPath: (path: string, app?: string) => Promise<void>
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  showNotification: (title: string, body?: string) => void
  getWindowFocused: () => Promise<boolean>
  setWindowFocus: () => Promise<void>
  showWindow: () => Promise<void>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  getPinchZoomEnabled: () => Promise<boolean>
  setPinchZoomEnabled: (enabled: boolean) => Promise<void>
  getYolo: () => Promise<boolean>
  setYolo: (enabled: boolean) => Promise<void>
  getLocalEngine: () => Promise<{ url: string; token: string }>
  setLocalEngine: (url: string, token: string) => Promise<void>
  getExtraProviders: () => Promise<string>
  setExtraProviders: (raw: string) => Promise<{ error: string; providers: string[] }>
  getTriageModel: () => Promise<string>
  setTriageModel: (id: string) => Promise<void>
  listDeclaredModels: () => Promise<string[]>
  getRouterName: () => Promise<string>
  setRouterName: (name: string) => Promise<void>
  getResolvedEngine: () => Promise<{ baseUrl: string; source: string; models: number } | null>
  getEngines: () => Promise<Array<{ id: string; name: string; baseURL: string; apiKey: string; models: number }>>
  setEngines: (
    list: Array<{ id?: string; name: string; baseURL: string; apiKey: string }>,
  ) => Promise<{ error: string; engines: Array<{ id: string; name: string; baseURL: string; apiKey: string }> }>
  testEngine: (
    baseURL: string,
    apiKey: string,
  ) => Promise<{ ok: boolean; models: string[]; vendor?: string; error?: string }>
  getPlanModel: () => Promise<string>
  setPlanModel: (modelID: string) => Promise<void>
  getBuildModel: () => Promise<string>
  setBuildModel: (modelID: string) => Promise<void>
  onPinchZoomEnabledChanged: (cb: (enabled: boolean) => void) => () => void
  onZoomFactorChanged: (cb: (factor: number) => void) => () => void
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  runDesktopMenuAction: (action: DesktopMenuAction) => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  exportDebugLogs: () => Promise<string>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void>
}
