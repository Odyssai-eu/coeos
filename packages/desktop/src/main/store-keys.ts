export const SETTINGS_STORE = "opencode.settings"
export const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"
export const WSL_SERVERS_KEY = "wslServers"
export const PINCH_ZOOM_ENABLED_KEY = "pinchZoomEnabled"
export const WINDOW_IDS_KEY = "windowIds"
// coeos-code — pairing engine (découverte LAN / provisionné, zéro hardcode)
export const ENGINE_URL_KEY = "coeos.engineUrl"
export const ENGINE_TOKEN_KEY = "coeos.engineToken"
export const ENGINE_CLIENT_ID_KEY = "coeos.clientId"
// coeos-code — dernier mapping agent->modele reussi depuis la console superagent
// (:4800/api/state), pour repli si la console est injoignable au boot.
export const ROLE_ASSIGNMENT_KEY = "coeos.roleAssignment"
// coeos-code — mode YOLO : accepte toutes les permissions sans demander (full-full,
// choix informé de l'utilisatrice, Settings > General). Lu au spawn du serveur
// pour poser OPENCODE_YOLO ; s'applique au prochain lancement (restart-to-apply).
export const YOLO_KEY = "coeos.yolo"
// coeos-code — modèle choisi pour les modes Plan et Build (Settings > Models).
// Id nu (ex. "or:glm-5.2"), lu par buildCoeosConfig pour piloter agent.plan/build.
// Vide/absent = défaut CoeOS. Rien ajouté à CoeOS : l'affectation vit ici.
export const PLAN_MODEL_KEY = "coeos.planModel"
export const BUILD_MODEL_KEY = "coeos.buildModel"
// coeos-code — dernier catalogue /v1/models connu (ids nus). Repli si le fetch au
// boot flanche (LAN à froid) : le provider ne retombe plus sur les 2 curatés.
// Même philosophie que ROLE_ASSIGNMENT_KEY (persist + revalidation).
export const MODEL_CATALOG_KEY = "coeos.modelCatalog"
// coeos-nemo — moteur CoeOS saisi par l'utilisatrice (Settings > Models). Une
// adresse LOCALE (sa propre box) qui PRIME sur l'endpoint provisionné : taper
// une adresse à la main, c'est vouloir celle-là. Vide = résolution normale.
// Aucune adresse en dur nulle part — c'est elle qui la donne.
export const LOCAL_ENGINE_URL_KEY = "coeos.localEngineUrl"
export const LOCAL_ENGINE_TOKEN_KEY = "coeos.localEngineToken"

// coeos-nemo — providers SUPPLEMENTAIRES, au format opencode, colles tels quels
// par l'operatrice (Settings > Models). C'est la voie pour brancher ses propres
// machines : `{"provider":{"odyssai-x":{"npm":"@ai-sdk/openai-compatible", ...}}}`.
// Stocke le TEXTE brut (on rend a l'ecran ce qui a ete tape), valide au save.
// Vide = rien n'est ajoute.
export const EXTRA_PROVIDERS_KEY = "coeos.extraProviders"
// Modele qui classe la tache au premier message (plugin codeos-sequencer).
// Vide = pas de triage : le plugin retombe sur son defaut prudent au lieu
// d'appeler un modele ecrit en dur qui peut ne plus exister.
export const TRIAGE_MODEL_KEY = "coeos.triageModel"

