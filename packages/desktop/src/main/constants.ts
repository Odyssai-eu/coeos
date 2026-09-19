import { app } from "electron"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

// coeos-code: auto-updater désactivé (pas de feed upstream anomalyco/opencode)
export const UPDATER_ENABLED = false
