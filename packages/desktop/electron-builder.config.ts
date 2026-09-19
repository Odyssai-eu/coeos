import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
// The Electron 42 packaging update briefly installed Linux launchers/icons under
// "opencode-desktop". Keep that hidden desktop entry around so existing GNOME/KDE
// pins still resolve after the canonical app id changes back to ai.opencode.desktop.
const legacyDesktopEntry = path.join(packageDir, "resources", "linux", "opencode-desktop.desktop")
const legacyDesktopEntryFpm = `${legacyDesktopEntry}=/usr/share/applications/opencode-desktop.desktop`

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

// productName/executable en ASCII PUR — un accent (é) casse app.whenReady()
// en packagé : gel silencieux avant toute fenetre (bisect 2026-08-20).
const APP_IDS = {
  dev: "eu.odyssai.nemo.dev",
  beta: "eu.odyssai.nemo.beta",
  prod: "eu.odyssai.nemo",
} as const

const getBase = (appId: string): Configuration => ({
  artifactName: "nemo-${os}-${arch}.${ext}",
  // CFBundleVersion = auto-incremented build counter (scripts/build-nemo.sh); the
  // marketing version stays package.json / VERSION.
  ...(process.env.NEMO_BUILD_NUMBER ? { buildVersion: process.env.NEMO_BUILD_NUMBER } : {}),
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "ai.opencode.desktop" becomes
  // "ai.opencode.desktop.desktop".
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    desktopName: `${appId}.desktop`,
  },
  files: ["out/**/*", "resources/**/*"],
  extraResources: [
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
    // macOS 15+ (Local Network privacy) BLOQUE au niveau OS les connexions du
    // process app vers une IP du LAN si l'usage n'est pas déclaré — échec
    // INSTANTANÉ (pas un timeout), silencieux. C'est ce qui gelait le fetch
    // /v1/models du moteur OdyssAI-x (.39) au boot -> picker vide/2 modèles
    // (diagnostic 2026-08-03 : engine résolu à .39 mais buildCoeosConfig rendait
    // [] en 7 ms). bun/curl depuis le Terminal héritent de l'autorisation du
    // Terminal, d'où l'asymétrie. La déclaration permet le prompt + le grant.
    extendInfo: {
      NSLocalNetworkUsageDescription:
        "coeos-code se connecte à ton moteur d'inférence OdyssAI-x sur le réseau local pour lister les modèles publiés et générer.",
    },
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "Nemo",
    schemes: ["nemo"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: "Nemo Dev",
        rpm: { packageName: "nemo-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: "Nemo Beta",
        protocols: { name: "Nemo Beta", schemes: ["nemo"] },
        rpm: { packageName: "nemo-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: "Nemo",
        protocols: { name: "Nemo", schemes: ["nemo"] },
        deb: { fpm: [legacyDesktopEntryFpm] },
        rpm: { packageName: "nemo", fpm: [legacyDesktopEntryFpm] },
      }
    }
  }
}

export default getConfig()
