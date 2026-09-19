import windowState from "electron-window-state"
import { resolveThemeVariant } from "@opencode-ai/ui/theme/resolve"
import type { DesktopTheme } from "@opencode-ai/ui/theme/types"
import forgeThemeJson from "../../../ui/src/theme/themes/codeos-forge.json"
import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import { app, BrowserWindow, dialog, net, nativeImage, nativeTheme, protocol } from "electron"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { TitlebarTheme } from "../preload/types"
import { exportDebugLogs, write as writeLog } from "./logging"
import { getStore } from "./store"
import { BUILD_MODEL_KEY, EXTRA_PROVIDERS_KEY, TRIAGE_MODEL_KEY, LOCAL_ENGINE_TOKEN_KEY, LOCAL_ENGINE_URL_KEY, PINCH_ZOOM_ENABLED_KEY, PLAN_MODEL_KEY, WINDOW_IDS_KEY, YOLO_KEY } from "./store-keys"
import { createUnresponsiveSampler } from "./unresponsive"

const root = dirname(fileURLToPath(import.meta.url))
const rendererRoot = join(root, "../renderer")
const rendererProtocol = "oc"
const rendererHost = "renderer"
const clipboardWritePermission = "clipboard-sanitized-write"
const notificationPermission = "notifications"
const rendererPermissions = new Set([clipboardWritePermission, notificationPermission])
const forgeTheme = forgeThemeJson as DesktopTheme
const forgeBackground = {
  light: resolveThemeVariant(forgeTheme.light, false)["background-base"],
  dark: resolveThemeVariant(forgeTheme.dark, true)["background-base"],
}
const documentPolicyHeader = "Document-Policy"
const jsCallStacksDocumentPolicy = "include-js-call-stacks-in-crash-reports"

protocol.registerSchemesAsPrivileged([
  {
    scheme: rendererProtocol,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
])

let backgroundColor: string | undefined
let relaunchHandler = () => {
  app.relaunch()
  app.exit(0)
}
let appQuitting = false
let lastFocusedWindowID: string | undefined
const titlebarThemes = new WeakMap<BrowserWindow, Partial<TitlebarTheme>>()
const pinchZoomEnabled = new WeakMap<BrowserWindow, boolean>()
const windowIDs = new WeakMap<BrowserWindow, string>()
const windowsByID = new Map<string, BrowserWindow>()
const titlebarHeight = 40
const maxZoomLevel = 10
const minZoomLevel = 0.2

export function setRelaunchHandler(handler: () => void) {
  relaunchHandler = handler
}

export function setAppQuitting() {
  appQuitting = true
}

export function setBackgroundColor(color: string) {
  backgroundColor = color
  BrowserWindow.getAllWindows().forEach((win) => win.setBackgroundColor(color))
}

export function getBackgroundColor(): string | undefined {
  return backgroundColor
}

function iconsDir() {
  return app.isPackaged ? join(process.resourcesPath, "icons") : join(root, "../../resources/icons")
}

function iconPath() {
  const ext = process.platform === "win32" ? "ico" : "png"
  return join(iconsDir(), `icon.${ext}`)
}

function tone() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light"
}

function defaultBackgroundColor() {
  return forgeBackground[tone()]
}

function overlay(theme: Partial<TitlebarTheme> = {}, zoom = 1) {
  const mode = theme.mode ?? tone()
  return {
    color: "#00000000",
    symbolColor: mode === "dark" ? "white" : "black",
    height: Math.max(titlebarHeight, Math.round(titlebarHeight * zoom)),
  }
}

export function setTitlebar(win: BrowserWindow, theme: Partial<TitlebarTheme> = {}) {
  titlebarThemes.set(win, theme)
  updateTitlebar(win)
}

export function updateTitlebar(win: BrowserWindow) {
  if (process.platform !== "win32") return
  win.setTitleBarOverlay(overlay(titlebarThemes.get(win), win.webContents.getZoomFactor()))
}

export function setPinchZoomEnabled(enabled: boolean) {
  getStore().set(PINCH_ZOOM_ENABLED_KEY, enabled)
  for (const win of BrowserWindow.getAllWindows()) {
    pinchZoomEnabled.set(win, enabled)
    win.webContents.send("pinch-zoom-enabled-changed", enabled)
    if (!enabled && win.webContents.getZoomFactor() !== 1) win.webContents.setZoomFactor(1)
    updateZoom(win)
  }
}

export function getPinchZoomEnabled() {
  return getStore().get(PINCH_ZOOM_ENABLED_KEY) === true
}

// coeos-code — mode YOLO (permission bypass). Persisté en electron-store ;
// s'applique au prochain spawn du serveur (restart-to-apply), pas à chaud.
export function getYolo() {
  return getStore().get(YOLO_KEY) === true
}

export function setYolo(enabled: boolean) {
  getStore().set(YOLO_KEY, enabled)
}

// coeos-code — modèle affecté aux modes Plan / Build (Settings > Models). Id nu
// (ex. "or:glm-5.2") ou "" = défaut CoeOS. Persisté ; lu par buildCoeosConfig
// au prochain spawn (restart-to-apply). Rien n'est ajouté à CoeOS.
// coeos-nemo — moteur CoeOS saisi par l'utilisatrice (Settings > Models).
// Prime sur le provisionné : taper une adresse à la main, c'est vouloir
// celle-là. Vide = on retombe sur la résolution normale.
export function getLocalEngine(): { url: string; token: string } {
  const url = getStore().get(LOCAL_ENGINE_URL_KEY)
  const token = getStore().get(LOCAL_ENGINE_TOKEN_KEY)
  return {
    url: typeof url === "string" ? url : "",
    token: typeof token === "string" ? token : "",
  }
}

export function setLocalEngine(url: string, token: string) {
  const store = getStore()
  const clean = (url || "").trim().replace(/\/+$/, "")
  if (clean) store.set(LOCAL_ENGINE_URL_KEY, clean)
  else store.delete(LOCAL_ENGINE_URL_KEY as never)
  const tok = (token || "").trim()
  if (tok) store.set(LOCAL_ENGINE_TOKEN_KEY, tok)
  else store.delete(LOCAL_ENGINE_TOKEN_KEY as never)
}

/** Le texte colle par l'operatrice, tel quel. On ne le reformate pas : ce
 * qu'elle relit doit etre ce qu'elle a tape. */
export function getExtraProviders(): string {
  const v = getStore().get(EXTRA_PROVIDERS_KEY)
  return typeof v === "string" ? v : ""
}

/** Valide AVANT d'enregistrer — un bloc casse ne doit jamais atteindre le
 * demarrage, ou il ferait rejeter toute la config du sidecar. Renvoie l'erreur
 * a afficher, ou "" si c'est bon. */
export function setExtraProviders(raw: string): { error: string; providers: string[] } {
  const text = (raw || "").trim()
  const store = getStore()
  if (!text) {
    store.delete(EXTRA_PROVIDERS_KEY as never)
    return { error: "", providers: [] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return { error: `JSON invalide : ${(e as Error).message}`, providers: [] }
  }
  const provider = (parsed as { provider?: Record<string, unknown> })?.provider
  if (!provider || typeof provider !== "object" || !Object.keys(provider).length) {
    return { error: 'Il manque un objet "provider" avec au moins une entree.', providers: [] }
  }
  for (const [id, p] of Object.entries(provider)) {
    const entry = p as { npm?: unknown; options?: { baseURL?: unknown }; models?: Record<string, unknown> }
    if (typeof entry?.npm !== "string" || !entry.npm)
      return { error: `${id} : champ "npm" manquant (ex. @ai-sdk/openai-compatible).`, providers: [] }
    if (typeof entry?.options?.baseURL !== "string" || !entry.options.baseURL)
      return { error: `${id} : "options.baseURL" manquant.`, providers: [] }
    if (!entry?.models || typeof entry.models !== "object" || !Object.keys(entry.models).length)
      return { error: `${id} : aucun modele declare dans "models".`, providers: [] }
  }
  store.set(EXTRA_PROVIDERS_KEY, text)
  return { error: "", providers: Object.keys(provider) }
}

export function getTriageModel(): string {
  const v = getStore().get(TRIAGE_MODEL_KEY)
  return typeof v === "string" ? v : ""
}

export function setTriageModel(id: string) {
  const store = getStore()
  const clean = (id || "").trim()
  if (clean) store.set(TRIAGE_MODEL_KEY, clean)
  else store.delete(TRIAGE_MODEL_KEY as never)
}

export function getPlanModel(): string {
  const v = getStore().get(PLAN_MODEL_KEY)
  return typeof v === "string" ? v : ""
}

export function setPlanModel(modelID: string) {
  getStore().set(PLAN_MODEL_KEY, modelID)
}

export function getBuildModel(): string {
  const v = getStore().get(BUILD_MODEL_KEY)
  return typeof v === "string" ? v : ""
}

export function setBuildModel(modelID: string) {
  getStore().set(BUILD_MODEL_KEY, modelID)
}

export function getWindowID(win: BrowserWindow) {
  return windowIDs.get(win)
}

export function getLastFocusedWindow() {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) return focused
  if (!lastFocusedWindowID) return null
  const win = windowsByID.get(lastFocusedWindowID)
  if (!win || win.isDestroyed()) return null
  return win
}

export function restoreMainWindows() {
  const ids = readWindowIDs()
  return (ids.length ? ids : [randomUUID()]).map((id) => createMainWindow(id))
}

export function setDockIcon() {
  if (process.platform !== "darwin") return
  const icon = nativeImage.createFromPath(join(iconsDir(), "dock.png"))
  if (!icon.isEmpty()) app.dock?.setIcon(icon)
}

export function createMainWindow(id: string = randomUUID()) {
  const state = windowState({
    file: windowStateFile(id),
    defaultWidth: 1280,
    defaultHeight: 800,
  })

  const mode = tone()
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    show: false,
    autoHideMenuBar: true,
    title: "coeos-code",
    icon: iconPath(),
    backgroundColor: backgroundColor ?? defaultBackgroundColor(),
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: { x: 12, y: 14 },
        }
      : {}),
    ...(process.platform === "win32"
      ? {
          frame: false,
          titleBarStyle: "hidden" as const,
          titleBarOverlay: overlay({ mode }),
        }
      : {}),
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  allowRendererPermissions(win)
  wireWindowRecovery(win, id)

  win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    const { requestHeaders } = details
    upsertKeyValue(requestHeaders, "Access-Control-Allow-Origin", ["*"])
    callback({ requestHeaders })
  })

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const { responseHeaders = {} } = details
    addRendererHeaders(details.url, responseHeaders)
    callback({ responseHeaders })
  })

  state.manage(win)
  registerWindow(win, id)
  loadWindow(win, "index.html")
  wireZoom(win)

  win.once("ready-to-show", () => {
    win.show()
  })

  return win
}

function registerWindow(win: BrowserWindow, id: string) {
  windowIDs.set(win, id)
  windowsByID.set(id, win)
  persistWindowID(id)

  win.on("focus", () => {
    lastFocusedWindowID = id
  })
  win.on("closed", () => {
    windowsByID.delete(id)
    if (lastFocusedWindowID === id) lastFocusedWindowID = windowsByID.keys().next().value
    if (!appQuitting) removeWindowID(id)
  })
}

function readWindowIDs() {
  const value = getStore().get(WINDOW_IDS_KEY)
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === "string" && id.length > 0)
}

function writeWindowIDs(ids: string[]) {
  getStore().set(WINDOW_IDS_KEY, [...new Set(ids)])
}

function persistWindowID(id: string) {
  const ids = readWindowIDs()
  if (ids.includes(id)) return
  writeWindowIDs([...ids, id])
}

function removeWindowID(id: string) {
  writeWindowIDs(readWindowIDs().filter((item) => item !== id))
  rmSync(join(app.getPath("userData"), windowStateFile(id)), { force: true })
}

function windowStateFile(id: string) {
  return `window-state-${id.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`
}

export function registerRendererProtocol() {
  if (protocol.isProtocolHandled(rendererProtocol)) return

  protocol.handle(rendererProtocol, async (request) => {
    const url = new URL(request.url)
    if (url.host !== rendererHost) {
      writeLog("protocol", "rejected host", { url: request.url }, "warn")
      return new Response("Not found", { status: 404 })
    }

    const file = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`)
    const rel = relative(rendererRoot, file)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      writeLog("protocol", "rejected path", { url: request.url, file }, "warn")
      return new Response("Not found", { status: 404 })
    }

    try {
      const response = await net.fetch(pathToFileURL(file).toString())
      if (response.status >= 400) {
        writeLog(
          "protocol",
          "fetch failed",
          {
            url: request.url,
            file,
            status: response.status,
            statusText: response.statusText,
          },
          "error",
        )
      }
      return addDocumentPolicy(response, file)
    } catch (error) {
      writeLog("protocol", "fetch error", { url: request.url, file, error }, "error")
      return new Response("Not found", { status: 404 })
    }
  })
}

function loadWindow(win: BrowserWindow, html: string) {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const url = new URL(html, devUrl)
    void win.loadURL(url.toString())
    return
  }

  void win.loadURL(`${rendererProtocol}://${rendererHost}/${html}`)
}

function wireWindowRecovery(win: BrowserWindow, name: string) {
  let showing = false
  const sampler = createUnresponsiveSampler(win, name)

  const handle = async (button: string | undefined, wait: boolean) => {
    if (button === "Export Logs") {
      const sampling = sampler.stopAndFlush()
      await exportDebugLogs().catch((error) => writeLog("main", "failed to export debug logs", { error }, "error"))
      if (wait && sampling) sampler.start()
      return true
    }
    if (button === "Relaunch") {
      sampler.stopAndFlush()
      relaunchHandler()
      return false
    }
    if (button === "Quit") {
      sampler.stopAndFlush()
      app.quit()
    }
    return false
  }

  const show = async (message: string, detail: string, wait: boolean) => {
    if (showing || win.isDestroyed()) return
    showing = true
    try {
      while (!win.isDestroyed()) {
        const buttons = wait ? ["Relaunch", "Export Logs", "Keep Waiting"] : ["Relaunch", "Export Logs", "Quit"]
        const result = await dialog.showMessageBox(win, {
          type: "warning",
          buttons,
          defaultId: 0,
          cancelId: 2,
          message,
          detail,
        })
        if (await handle(buttons[result.response], wait)) continue
        return
      }
    } finally {
      showing = false
    }
  }

  const failed = (
    event: string,
    errorCode: number,
    errorDescription: string,
    validatedURL: string,
    isMainFrame: boolean,
  ) => {
    writeLog(
      "window",
      "renderer load failed",
      {
        window: name,
        event,
        errorCode,
        errorDescription,
        validatedURL,
        currentURL: win.webContents.getURL(),
        isMainFrame,
      },
      "error",
    )

    if (!isMainFrame || errorCode === -3) return
    void show(
      "coeos-code failed to load",
      [`Window: ${name}`, `URL: ${validatedURL}`, `Error: ${errorCode} ${errorDescription}`].join("\n"),
      false,
    )
  }

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    failed("did-fail-load", errorCode, errorDescription, validatedURL, isMainFrame)
  })
  win.webContents.on("did-fail-provisional-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    failed("did-fail-provisional-load", errorCode, errorDescription, validatedURL, isMainFrame)
  })
  win.webContents.on("render-process-gone", (_event, details) => {
    sampler.stopAndFlush()
    writeLog(
      "window",
      "renderer process gone",
      { window: name, currentURL: win.webContents.getURL(), details },
      "error",
    )
    void show(
      "coeos-code window terminated unexpectedly",
      [`Window: ${name}`, `Reason: ${details.reason}`, `Code: ${details.exitCode ?? "<unknown>"}`].join("\n"),
      false,
    )
  })
  win.on("unresponsive", () => {
    writeLog("window", "renderer unresponsive", { window: name, currentURL: win.webContents.getURL() }, "error")
    sampler.start()
    void show("coeos-code is not responding", "You can relaunch the app, open the logs, or keep waiting.", true)
  })
  win.on("responsive", () => {
    writeLog("window", "renderer responsive", { window: name, currentURL: win.webContents.getURL() }, "error")
    sampler.stopAndFlush()
  })
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (message.toLowerCase().includes("terminal") || sourceId.toLowerCase().includes("terminal")) {
      writeLog("pty", "console", { window: name, level, message, line, sourceId })
    }
  })
  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    writeLog("preload", "preload error", { window: name, preloadPath, error }, "error")
  })
}

function addDocumentPolicy(response: Response, file: string) {
  if (!file.toLowerCase().endsWith(".html")) return response
  const headers = new Headers(response.headers)
  headers.set(documentPolicyHeader, jsCallStacksDocumentPolicy)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function allowRendererPermissions(win: BrowserWindow) {
  const webContentsId = win.webContents.id

  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      rendererPermissions.has(permission) &&
        isTrustedRendererUrl(details.requestingUrl) &&
        webContents.id === webContentsId,
    )
  })
  win.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (!rendererPermissions.has(permission)) return false
    if (webContents && webContents.id !== webContentsId) return false
    return isTrustedRendererUrl(details.requestingUrl) || isTrustedRendererUrl(requestingOrigin)
  })
}

function isTrustedRendererUrl(value?: string) {
  return isRendererUrl(value)
}

function addRendererHeaders(value: string, headers: Record<string, any>) {
  upsertKeyValue(headers, "Access-Control-Allow-Origin", ["*"])
  upsertKeyValue(headers, "Access-Control-Allow-Headers", ["*"])
  if (isRendererUrl(value, true)) upsertKeyValue(headers, documentPolicyHeader, [jsCallStacksDocumentPolicy])
}

function isRendererUrl(value?: string, html = false) {
  if (!value || !URL.canParse(value)) return false
  const url = new URL(value)
  if (html && !url.pathname.endsWith(".html")) return false
  if (url.protocol === `${rendererProtocol}:` && url.host === rendererHost) return true
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!devUrl || !URL.canParse(devUrl)) return false
  return url.origin === new URL(devUrl).origin
}

function wireZoom(win: BrowserWindow) {
  pinchZoomEnabled.set(win, getPinchZoomEnabled())
  win.webContents.setZoomFactor(1)
  win.webContents.on("zoom-changed", (event, zoomDirection) => {
    event.preventDefault()
    if (pinchZoomEnabled.get(win)) {
      win.webContents.setZoomFactor(clampZoom(win.webContents.getZoomFactor() + (zoomDirection === "in" ? 0.2 : -0.2)))
      updateZoom(win)
      return
    }
    if (win.webContents.getZoomFactor() !== 1) win.webContents.setZoomFactor(1)
    updateZoom(win)
  })
}

function clampZoom(value: number) {
  return Math.min(Math.max(value, minZoomLevel), maxZoomLevel)
}

function updateZoom(win: BrowserWindow) {
  updateTitlebar(win)
  win.webContents.send("zoom-factor-changed", win.webContents.getZoomFactor())
}

function upsertKeyValue(obj: Record<string, any>, keyToChange: string, value: any) {
  const keyToChangeLower = keyToChange.toLowerCase()
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === keyToChangeLower) {
      // Reassign old key
      obj[key] = value
      // Done
      return
    }
  }
  // Insert at end instead
  obj[keyToChange] = value
}
