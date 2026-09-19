// coeos-code — génère OPENCODE_CONFIG_CONTENT pour le serveur LAN headless (:4096,
// codeos-server.sh). Extrait du bash inline le 2026-08-03 : l'échappement
// JS-dans-double-quote-bash cassait le parse ("Unexpected ||" à l'exécution
// launchd), le serveur retombait sur une config vide/statique. Un vrai fichier
// .ts = zéro surface d'échappement, testable isolément.
//
// Provider UNIQUE OdyssAI-x, peuplé live depuis /v1/models — exactement comme le
// sidecar de l'app (buildCoeosConfig), via les mêmes helpers partagés. Résout
// l'engine comme le desktop : CODEOS_ENGINE_URL sinon ~/.codeos/pairing.json.
import {
  COEOS_DEFAULT_CONFIG as c,
  coeosModelsWithCatalog,
  fetchServableModels,
} from "../packages/desktop/src/main/coeos-config"

let root = process.env.CODEOS_ENGINE_URL
let key: string | undefined
if (!root) {
  try {
    const pairing = await Bun.file(process.env.HOME + "/.codeos/pairing.json").json()
    root = pairing?.engines?.[0]?.baseUrl
    key = pairing?.engines?.[0]?.apiKey
  } catch {}
}

if (root) {
  root = root.replace(/\/+$/, "").replace(/\/v1$/, "")
  c.provider.coeos.options.baseURL = root + "/v1"
  if (key) c.provider.coeos.options.apiKey = key
  const models = await fetchServableModels({ baseUrl: root, apiKey: key ?? "dummy", source: "provisioned" })
  if (models.length) c.provider.coeos.models = coeosModelsWithCatalog(models)
  else console.error("codeos-server: /v1/models vide/injoignable — catalogue curaté seul")
} else {
  console.error("codeos-server: AUCUN engine resolu (ni CODEOS_ENGINE_URL ni ~/.codeos/pairing.json) — les generations echoueront")
}

console.log(JSON.stringify(c))
