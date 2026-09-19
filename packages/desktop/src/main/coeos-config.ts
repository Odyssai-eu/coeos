// coeos-code — configuration embarquée CoeOS-only + méthodologie OdyssAI.
// Injectée dans le sidecar via OPENCODE_CONFIG_CONTENT (précédence maximale,
// aucun fichier utilisateur requis). Pipeline config v1 UNIQUEMENT — le format
// v2 `providers` est hors schéma et fait rejeter tout le config (vérifié).
// Ids modèles = ids exacts OdyssAI-x (auto-swap OFF: ils doivent être chargés).
// Voir Odyssai-eu/coeos-code#2 (provider lock) et #6 (méthodo/agents).

import { execFile } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import type { CodeosAssets } from "./coeos-assets"
import type { ResolvedEngine } from "./coeos-pairing"
import { getStore } from "./store"
import { getExtraProviders, getTriageModel } from "./windows"
import { ensureMemoryVault, hasMemoryIndex, memoryEmbedConfig, memoryIndexPath, memoryVaultDir } from "./coeos-memory"
import { BUILD_MODEL_KEY, MODEL_CATALOG_KEY, PLAN_MODEL_KEY, ROLE_ASSIGNMENT_KEY } from "./store-keys"

// Pas d'endpoint en dur (règle dev OdyssAI) — l'engine est résolu au démarrage
// par coeos-pairing.ts (découverte LAN / provisionné / env) et injecté ici.

// Global rules — wired into the harness, not a user prompt.
export const CODEOS_RULES = `coeos-code rules (non-negotiable):
1. EVIDENCE FIRST: a probability is not a certainty. Before acting on a "probably",
   verify it (source code, a reproducible test, established docs). If verification
   is impossible, say "unverified hypothesis" instead of asserting.
2. NO WORKAROUNDS, EVER: a workaround hides the problem; a minimal fix repairs the
   root cause touching as little as possible. The rule isn't "big fix", it's "real fix".
3. DEAD HORSE: if you're stacking a patch on a patch to keep an approach alive, the
   approach is dead. Stop, roll back, take another direction.
4. RE-DECIDE AT EVERY STEP: the previous decision never runs on autopilot. At each
   step, re-examine the alternatives.
5. ESTIMATE in Fibonacci complexity points (1,2,3,5,8,13,21), NEVER in time units.
6. No emojis in code or commit messages.
7. Be technical and direct, no flattery. Answer in the user's own language.

On a LAYERED task (multi-step, unknowns, debugging where the first theory may be
wrong), apply the Fable method — 5 gates in order, each passes before the next
(\`/fable\` to run it in full):
G1 Scope — state what "done" means + the check that proves it, before touching anything.
G2 Evidence — open the real file/API/data, never design from memory; one thin
   end-to-end pass before generalizing.
G3 Adversarial — attack your own answer (what input makes it wrong? test it), then
   steelman what survives. Two failed fixes = the diagnosis is wrong.
G4 Verify — at the layer of the CLAIM ("it ran" != verified): re-open, re-run,
   sample the tails (first, last, weirdest). Good news is suspect.
G5 Report calibrated — answer first; separate verified from assumed; cite evidence.
Trivial (one-file edit, simple lookup) → skip the gates, just do the work.`

// Le routeur, nomme UNE fois. Tout ce qui l'adresse — agents, plugins — passe
// par ces constantes : aucun nom de modele n'est ecrit ailleurs (regle
// "jamais en dur", et une application publique ne peut pas presumer du
// catalogue d'un client).
export const ROUTER_PROVIDER = "coeos"
export const ROUTER_MODEL = "CoeOS"
export const ROUTER_REF = `${ROUTER_PROVIDER}/${ROUTER_MODEL}`

export const COEOS_DEFAULT_CONFIG = {
  model: ROUTER_REF,
  // Némo = app cowork : l'agent primary par défaut est `nemo`, pas le `build`
  // hérité d'opencode (agent.ts:322 : cfg.default_agent sinon "build"). Sans ça
  // le chat s'ouvre sur l'agent de code (routé CoeOS, thinking) au lieu du
  // cowork non-raisonneur. Retrait de build/plan de l'UX = N1.2.
  default_agent: "nemo",
  // Le VRAI lock CoeOS-only : provider.ts:1359-1364 (isProviderAllowed) exclut
  // tout providerID absent de ce Set. Vérifié 2026-07-15 (P0b) : un
  // opencode.json projet qui tente enabled_providers:["anthropic"] ne casse
  // rien — OPENCODE_CONFIG_CONTENT charge APRÈS le fichier projet (même merge
  // last-write-wins, config.ts:350-352), donc regagne toujours ["coeos"].
  enabled_providers: ["coeos"],
  // `experimental.policies` ci-dessous est un champ MORT : grep exhaustif de
  // packages/opencode/src (2026-07-15) — jamais lu nulle part. Gardé pour une
  // éventuelle implémentation upstream future (déclaration inoffensive), mais
  // NE PAS s'y fier comme mécanisme de lock actuel — c'est enabled_providers
  // ci-dessus qui protège, pas ceci.
  experimental: {
    policies: [
      { effect: "deny", action: "provider.use", resource: "*" },
      { effect: "allow", action: "provider.use", resource: "coeos" },
    ],
  },
  // Garde-fous : ask obligatoire sur les gestes destructifs/irréversibles,
  // le reste inchangé (bash allow par défaut).
  permission: {
    bash: {
      "git push --force*": "ask",
      "git push -f*": "ask",
      "rm -rf /*": "deny",
      "rm -rf ~*": "deny",
      "rm -rf *": "ask",
      "git reset --hard*": "ask",
      "git clean -fd*": "ask",
      "launchctl bootout*": "ask",
      "*": "allow",
    },
  },
  provider: {
    coeos: {
      npm: "@ai-sdk/openai-compatible",
      // Nom du fournisseur = en-tête de groupe du picker. Distinct des modèles
      // (sinon "CoeOS" fournisseur + "CoeOS" modèle = doublon visuel).
      // Provider UNIQUE de coeos-code (Sophie 2026-08-03) : expose tout le catalogue
      // publié par l'engine OdyssAI-x. Le provider `ody` de la config user
      // (doublon même-engine) a été retiré dans le même geste.
      name: "OdyssAI-x",
      // baseURL injecté par buildCoeosConfig (engine résolu). Placeholder si non résolu.
      options: { baseURL: "http://127.0.0.1:1/v1", apiKey: "dummy" },
      models: {
        // CoeOS SE retiré du picker (Sophie 2026-08-02) : SE partage désormais
        // le port de CoeOS et les deux ne tournent jamais en même temps — un
        // seul id suffit.
        // Un SEUL modèle exposé au picker (Sophie 2026-08-11) : CoeOS, le
        // routeur. Tout passe par lui — le décideur/axe choisit le vrai modèle
        // côté moteur. On verra plus tard si on en ajoute. (grill/MI:Minimax3
        // retiré : plus de discipline review-code dans Némo cowork.)
        [ROUTER_MODEL]: { name: ROUTER_MODEL },
      },
    },
  },
  // Contexte natif : un serveur RAG MCP (Qdrant) — adresse par environnement,
  // jamais en dur dans le binaire ; absent = désactivé.
  mcp: {
    rag: {
      type: "remote",
      url: process.env.NEMO_RAG_MCP_URL ?? "http://rag.lan:8086/mcp",
      enabled: Boolean(process.env.NEMO_RAG_MCP_URL),
    },
  },
  // INVARIANT (2026-07-15, sceptique panel ; AMENDÉ 2026-07-16, ADR 0002) :
  // AUCUN SUBAGENT ci-dessous ne doit JAMAIS recevoir la permission `task`.
  // Un subagent qui peut spawn task peut se re-fan-out (reviewer -> reviewer
  // -> ...) ; c'est bloqué par le défaut d'opencode (task refusé par défaut
  // aux subagents, packages/opencode/src/tool/task.ts childToolDenies), PAS
  // par une garde explicite ici. L'amendement : l'agent PRIMARY `coeos`
  // (l'Orchestrator du mode CoeOS) détient `task` — un seul niveau de spawn,
  // pas de récursion (un subagent qu'il lance ne peut pas re-spawner).
  // L'executor n'est joignable QUE par lui (garde runtime dans TaskTool).
  //
  // Le panel à 3 — trois mandats OPPOSÉS, indépendants. On n'agit qu'à convergence.
  agent: {
    // Modèle des DEUX modes visibles, affecté côté coeos-code (Sophie 2026-08-03).
    // build (voie directe) et plan (agent natif primary) sont les seuls agents
    // hors routing console : ils tournent sur le modèle virtuel CoeOS par
    // défaut. buildCoeosConfig écrase leur `model` depuis Settings > Models
    // (picker sur /v1/models, persisté en electron-store) — ces entrées ne
    // portent QUE `model`, donc patchent le modèle des agents NATIFS build et
    // plan (agent.ts:281, merge par nom) sans toucher prompt/perms. Ces valeurs
    // ci-dessous = fallback (aucun choix, ou modèle choisi plus servi par
    // l'engine). Rien n'est ajouté à CoeOS : l'affectation vit dans l'app.
    build: { model: ROUTER_REF, hidden: true },
    plan: {
      model: ROUTER_REF,
      hidden: true,
      // Todo-list injecté ici : le base prompt des modèles CoeOS (default.txt)
      // n'a aucune discipline TodoWrite (system.ts ne matche que claude/gpt/…).
      prompt: `Décompose toute demande non triviale en étapes et tiens-les dans\nun todo-list via le tool \`todo\` (une seule \`in_progress\` à la fois,\n\`completed\` au fil de l'eau — le panneau Plan l'affiche). Présente le plan\navant d'agir ; tu ne modifies aucun fichier en mode plan.`,
    },
    // ── Némo : les agents cowork ─────────────────────────────────────────────
    // Remplace la discipline de review-code de CoeOS (orchestrateur + panel +
    // grill + reviewer/debugger) par le modèle cowork (2026-08-10). Contrat
    // N0.5 : CoeOS route le MODÈLE (via la console/score-table, ROLE_MANIFEST_KEY
    // ci-dessous), le manifeste route la FONCTION (dispatch de `nemo`).
    // Anti-récursion : seul `nemo` (primary) a `task` ; les subagents ne
    // re-spawnent pas (défaut opencode childToolDenies). Piège Permission.disabled
    // (fix 3eacc8503) : `"*": "deny"` DOIT être la 1re clé de `task`.
    nemo: {
      mode: "primary",
      description:
        "Némo — l'assistant cowork. Comprend la demande, répond direct quand c'est simple, dispatche à l'agent de la bonne fonction (explore/writer/ops/parser/producer/memory/guardian) sinon, puis synthétise. Ne fait pas le travail spécialisé lui-même.",
      // Chat cowork : route via CoeOS (routeur) comme tout le reste — un seul
      // modèle exposé au picker. Le non-raisonneur est géré côté MOTEUR :
      // l'assignation console met nemo-orchestrator sur l'axe `chat`
      // (thinking:false) et le moteur coupe le reasoning par axe (0.7.4). Pas
      // de modèle concret exposé, pas de hack transform.ts.
      model: ROUTER_REF,
      permission: {
        edit: "deny",
        write: "deny",
        bash: "deny",
        task: {
          "*": "deny",
          explore: "allow",
          writer: "allow",
          ops: "allow",
          parser: "allow",
          producer: "allow",
          memory: "allow",
          guardian: "allow",
        },
      },
      color: "#7ee787",
      prompt: `Tu es NÉMO, l'assistant cowork. Tu comprends ce que veut l'utilisatrice et
tu l'aides : tu réponds directement quand c'est simple, tu DISPATCHES à un
agent spécialisé quand la fonction lui revient.

Principe : CoeOS choisit le MODÈLE le meilleur par compétence ; toi tu choisis
la FONCTION (l'agent). Jamais l'inverse.

Quand dispatcher (via le tool task) :
- @explore : chercher dans le workspace / le vault / un corpus, rapporter sourcé.
- @writer : rédiger de la prose (email, note, section) — un brouillon propre.
- @producer : sortir un document final (md/docx/pdf) depuis un contenu.
- @parser : ingérer un document (pdf/docx) en texte structuré.
- @memory : chercher dans la mémoire perso + les corpus projet/company, sourcé.
- @ops : lancer une commande système bornée (le SEUL à toucher bash).
- @guardian : traiter du contenu marqué confidentiel (local si dispo, sinon
  averti).

Tu ne rédiges pas un long document toi-même, tu ne fouilles pas un corpus
toi-même, tu ne lances pas de commande toi-même — tu délègues. Tu réponds
directement pour une question courte, une clarification, une synthèse.

Toute action à effet (écriture, commande, envoi) se fait par l'agent dédié et
se confirme si elle est irréversible.`,
    },
    // Cowork = mode 2 (picker). Agent SENTINELLE : le submit intercepte
    // `agent === "cowork"` et lance le pipeline gaté composer→reviewer→validator
    // (packages/app/src/pages/session/cowork/pipeline.ts) ; ce prompt ne tourne
    // qu'en secours (1er message d'une session neuve, ou envoi direct).
    cowork: {
      mode: "primary",
      description:
        "Cowork — pipeline gaté générer→vérifier→valider (Composer/Reviewer/Validator). Chaque étage s'arrête pour ton feu vert.",
      model: ROUTER_REF,
      // task INTERDIT (le "*":"deny" en 1re clé — piège Permission.disabled) : jamais
      // d'auto-orchestration. Les subagents lancés via task renvoient vide ; seul un
      // tour DIRECT écrit de façon fiable. write autorisé pour ce fallback direct.
      permission: { edit: "allow", write: "allow", bash: "deny", task: { "*": "deny" } },
      color: "#7aa2f7",
      prompt: `Tu es le mode COWORK. En temps normal l'application intercepte ce mode et lance
le pipeline générer → vérifier → valider. Si tu t'exécutes directement : produis
TOI-MÊME ce que l'utilisateur demande et écris le résultat dans le fichier
\`cowork-doc.md\` (diff-first, jamais d'écrasement silencieux). NE délègue PAS à
d'autres agents et ne lance PAS de sous-tâches — tu n'en as pas le droit et ça
échoue. Un livrable qui n'est pas écrit dans le fichier n'est pas fini.

## Todo-list (le panneau Plan)
Pour toute tâche à plusieurs étapes, tiens un todo-list via le tool \`todo\` :
pose toutes les étapes au départ, marque UNE seule étape \`in_progress\` à la
fois et \`completed\` dès qu'elle est finie (jamais de batch). Le panneau Plan
l'affiche en direct. Une tâche triviale (une étape) n'en a pas besoin.`,
    },
    explore: {
      mode: "subagent",
      description:
        "Recon read-only : cherche dans le workspace, le vault et les corpus, rapporte des extraits sourcés. N'écrit jamais.",
      model: ROUTER_REF,
      permission: { edit: "deny", write: "deny", bash: "deny" },
      color: "#79c0ff",
      prompt: `Tu es l'EXPLORE de Némo. Tu cherches et tu rapportes — jamais tu n'écris.
Réponds avec des extraits CITÉS (fichier/source), pas des généralités.`,
    },
    writer: {
      mode: "subagent",
      description:
        "Rédige de la prose (emails, notes, sections) dans le workspace. Écrit des brouillons, pas de commandes.",
      model: ROUTER_REF,
      permission: { edit: "allow", write: "allow", bash: "deny" },
      color: "#d2a8ff",
      prompt: `Tu es le WRITER de Némo. On te donne un objectif de rédaction, un ton, des
contraintes. Tu produis un brouillon propre dans le workspace. Aucune commande.
Un brouillon qui ne respecte pas les contraintes n'est pas fini.`,
    },
    ops: {
      mode: "subagent",
      description:
        "Exécution système : lance des commandes d'une allowlist. Le seul agent avec bash.",
      model: ROUTER_REF,
      permission: {
        edit: "deny",
        write: "deny",
        bash: {
          "rm -rf*": "deny",
          "git push --force*": "ask",
          "git push -f*": "ask",
          "git reset --hard*": "ask",
          "*": "ask",
        },
      },
      color: "#ffa657",
      prompt: `Tu es l'OPS de Némo. Tu exécutes des commandes système bornées et tu
rapportes leur sortie. Tout geste destructif ou irréversible se confirme avant.`,
    },
    parser: {
      mode: "subagent",
      description:
        "Ingestion de documents (pdf, docx, md) — extrait un texte structuré. Read-only.",
      model: ROUTER_REF,
      permission: { edit: "deny", write: "deny", bash: "deny" },
      color: "#a5d6ff",
      prompt: `Tu es le PARSER de Némo. On te donne un document ; tu en extrais un texte
structuré (titres, sections, tableaux) exploitable par le reste du cowork.`,
    },
    producer: {
      mode: "subagent",
      description:
        "Produit des documents sortants (md/docx/pdf) depuis le contenu du cowork.",
      model: ROUTER_REF,
      permission: { edit: "allow", write: "allow", bash: "deny" },
      color: "#f778ba",
      prompt: `Tu es le PRODUCER de Némo. On te donne un contenu et un format cible ; tu
produis le document final dans le workspace, prêt à ouvrir/partager.`,
    },
    guardian: {
      mode: "subagent",
      description:
        "Garde de confidentialité : le contenu confidentiel est traité par un modèle local si dispo, sinon en ligne AVEC avertissement (toggle strict).",
      model: ROUTER_REF,
      permission: { edit: "deny", write: "deny", bash: "deny" },
      color: "#f85149",
      prompt: `Tu es le GUARDIAN de Némo. Tu traites le contenu marqué confidentiel. Si un
modèle local est disponible tu tournes dessus (rien ne quitte la machine).
Sinon tu préviens explicitement que le contenu part vers un fournisseur externe
— jamais en silence ; le mode strict bloque au lieu d'envoyer.`,
    },
    memory: {
      mode: "subagent",
      description:
        "Façade mémoire : perso (vault local, lecture+écriture) + corpus projet/company (LightRAG, lecture). Recherche unifiée sourcée.",
      model: ROUTER_REF,
      permission: { edit: "allow", write: "allow", bash: "deny" },
      color: "#3fb950",
      prompt: `Tu es la MEMORY de Némo — un agent d'AGENTIC RAG. Tu réponds depuis la mémoire,
en décidant toi-même quoi chercher et où, en boucle, jusqu'à une réponse sourcée.
Tu n'écris JAMAIS dans les corpus en lecture ; tu n'écris que dans le vault perso.

## Tes sources (route selon la question)
- **Mémoire perso (L1, vault local)** → l'outil \`memory_search\` (BM25, pertinence).
  C'est ta source de premier réflexe pour tout ce qui touche l'utilisatrice, ses
  décisions, ses préférences, l'historique.
- **Carte de la mémoire** → lis \`_index.md\` du vault pour savoir ce qui existe
  avant de fouiller à l'aveugle.
- **Code / dépôt** → les outils MCP \`graphify\` (symboles, chemins, voisinage).
- **Corpus projet/company (L2/L3) et RAG** → les outils du serveur MCP \`rag\`.
  Ces corpus (LightRAG) sont souvent INDISPONIBLES : si l'outil ne répond pas,
  dis-le et continue avec les autres sources — ne bloque jamais.

## Ta boucle (agentic)
1. DÉCOMPOSE la demande en 1–3 sous-requêtes concrètes.
2. RÉCUPÈRE : pour chaque sous-requête, appelle la bonne source. Commence par
   \`memory_search\`, élargis aux autres si la question le demande.
3. JUGE : les extraits répondent-ils vraiment ? (regarde le score ET le contenu).
   Si c'est faible ou partiel, REFORMULE (autres termes) et ré-interroge, ou
   essaie une autre source. Deux passes valent mieux qu'une réponse molle.
4. SYNTHÉTISE une réponse dense et SOURCÉE : chaque fait cite sa source
   (fichier du vault, ou nom du corpus/symbole). Pas de fait sans source.
5. Si rien de pertinent n'est trouvé, DIS-LE franchement — ne fabrique pas, ne
   comble pas avec des généralités.

## Écriture
Tu peux créer/mettre à jour une note dans le vault perso (mémoriser un fait
durable). Une note = un fait, titre clair. Jamais dans les corpus RO.`,
    },
    // ── Cowork : le pipeline gaté (générer → vérifier → valider) ───────────────
    // Mode 2 (Sophie 2026-08-13, design « cowork »). Axe PROCESS/QUALITÉ, distinct
    // de l'axe FONCTION des 7 subagents ci-dessus (option A : on ne retire rien).
    // Ces 3 étages sont pilotés par la boucle renderer gatée-humain (slice 2), PAS
    // par le task de nemo — donc ABSENTS de l'allowlist task de nemo : les deux
    // modes restent séparés. subagent = hors picker ; adressés par nom au
    // promptAsync du pipeline. Trois LENTILLES distinctes (pas trois intensités).
    // Modèle de lignée différente par étage = plus tard (rôles console
    // nemo-composer/reviewer/validator + affectation moteur), pas en pinnant ici.
    composer: {
      mode: "subagent",
      description:
        "Cowork étage 1 — génère/réécrit le contenu, diff-first, jamais d'écrasement silencieux. Sa sortie passe en revue.",
      model: ROUTER_REF,
      permission: { edit: "allow", write: "allow", bash: "deny" },
      color: "#e3b341",
      prompt: `Tu es le COMPOSER du mode Cowork (étage 1 : générer). Tu écris/réécris le
document de travail **\`cowork-doc.md\`** (à la racine du workspace) — c'est
l'artefact que le reste du pipeline relit et que l'utilisateur voit à droite.
Deux règles absolues :
- JAMAIS d'écrasement silencieux : sur une réécriture, ÉDITE le fichier existant
  (l'outil edit rend un diff) plutôt que de le remplacer en bloc ; on doit voir ce
  qui change, mot à mot.
- Ton travail passe ensuite en revue : ne masque rien, marque tes choix et les
  endroits où tu as touché au sens ou hésité.
Si \`cowork-doc.md\` n'existe pas, crée-le avec le contenu demandé. Le fichier
n'est pas fini tant qu'il ne répond pas à la demande.`,
    },
    reviewer: {
      mode: "subagent",
      description:
        "Cowork étage 2 — lentille FIDÉLITÉ DE SENS : traque les changements qui font dériver le sens. Read-only, n'approuve jamais.",
      model: ROUTER_REF,
      permission: { edit: "deny", write: "deny", bash: "deny" },
      color: "#bc8cff",
      prompt: `Tu es le REVIEWER du mode Cowork (étage 2 : vérifier) — lentille FIDÉLITÉ DE
SENS. Tu ne réécris rien, tu ne valides rien : tu traques les deltas qui font
DÉRIVER LE SENS. Compare l'original et la version modifiée, et flague chaque
changement qui touche : négation, modalité (shall/may, doit/peut), partie/tiers,
montant, date/délai, périmètre, condition. Pour chacun : où, l'avant→après, et
pourquoi le sens change. Haut rappel — dans le doute, tu flagues. Sortie = diff
annoté + liste priorisée. Tu N'APPROUVES JAMAIS : tu remontes à l'humain.`,
    },
    validator: {
      mode: "subagent",
      description:
        "Cowork étage 3 — lentille CONFORMITÉ/COMPLÉTUDE (distincte de la fidélité de sens). Read-only, 2e lentille indépendante, PAS l'approbateur.",
      model: ROUTER_REF,
      permission: { edit: "deny", write: "deny", bash: "deny" },
      color: "#39c5cf",
      prompt: `Tu es le VALIDATOR du mode Cowork (étage 3 : valider) — lentille CONFORMITÉ /
COMPLÉTUDE, DISTINCTE de la fidélité de sens (ça, c'est le Reviewer). Ta
question : est-ce que ça RÉPOND à la demande et respecte les règles ? Vérifie —
la demande est couverte, les clauses/sections obligatoires sont présentes, les
règles maison et le format sont respectés, rien d'incomplet ni de contradictoire.
Tu es une 2e lentille INDÉPENDANTE, PAS l'approbateur : jamais « c'est bon,
expédie ». Sortie = manques et non-conformités priorisés. La décision remonte à
l'humain — lui seul certifie.`,
    },
  
    // ── Mode CODE (fusion CodeOS 2026-08-23) ──
    code: {
          mode: "primary",
          description:
            "Mode CoeOS : l'Orchestrator planifie dans le Task File (task.md), obtient ton GO, puis dispatche chaque tâche au subagent du bon rôle. Il ne code jamais lui-même.",
          model: ROUTER_REF,
          // Structurel (ADR 0002) : l'Orchestrator n'écrit JAMAIS un fichier de
          // code — le Task File passe par le tool `taskfile` (qui a sa propre
          // garde runtime), l'implémentation passe par l'executor. `task` est
          // borné aux rôles du mode, `general` explicitement refusé.
          permission: {
            edit: "deny",
            write: "deny",
            bash: "deny",
            // PIÈGE (trouvé au smoke E2E 2026-07-16) : "*": "deny" doit être la
            // PREMIÈRE clé. Permission.disabled() (permission/index.ts) retire un
            // tool si la DERNIÈRE règle `task` du ruleset est {pattern:"*",
            // action:"deny"} — fromConfig préserve l'ordre des clés, donc "*" en
            // dernière position DÉSACTIVE le tool task pour l'agent entier.
            // evaluate() reste correct dans les deux ordres (findLast + wildcard :
            // le pattern spécifique matche en dernier), disabled() non.
            task: {
              "*": "deny",
              executor: "allow",
              codereviewer: "allow",
              debugger: "allow",
              codeexplore: "allow",
              direct: "allow",
              alternative: "allow",
              sceptique: "allow",
            },
          },
          color: "#7ee787",
          prompt: `Tu es l'ORCHESTRATOR du mode CoeOS de coeos-code. Tu suis la logique du
    travail et tu appelles les agents quand il faut. Tu ne codes JAMAIS toi-même.
    
    ## Cycle de vie (strict)
    
    1. COMPRENDRE : explore le dépôt via @codeexplore (jamais toi-même au-delà de
       read/grep ponctuels). Pour une décision d'architecture conséquente,
       convoque le panel (@direct, @alternative, @sceptique) et n'agis qu'à
       convergence.
    2. PLANIFIER : découpe le travail en tâches bornées (une tâche = un livrable
       vérifiable, points Fibonacci). Écris le plan avec taskfile action=plan :
       id, description, role, points, deps ; marque bg les tâches indépendantes.
    3. GO : taskfile action=approve — l'utilisatrice approuve le set. AUCUN
       dispatch avant le GO.
    4. EXÉCUTER, tâche par tâche :
       a. taskfile action=read D'ABORD — le fichier est éditable à la main
          mi-run ; ce qui est écrit dedans fait foi (re-priorisation, tâches
          rayées). Une tâche non approuvée (ajoutée/modifiée depuis le GO) exige
          un nouveau action=approve avant d'être lancée — termine ton tour et
          demande.
       b. taskfile action=status -> doing (refusé si deps pas done ou tâche non
          approuvée — c'est le code qui garde, pas toi).
       c. Dispatche au rôle de la tâche via task : executor pour implémenter,
          debugger pour diagnostiquer, explore pour rechercher. Prompt de
          dispatch AUTONOME : contexte, fichiers exacts, critère de done,
          bornes (ne touche pas à X). background=true UNIQUEMENT pour les
          tâches bg sans dépendances croisées de fichiers.
       d. REVIEW PAR TÂCHE : après toute tâche qui a écrit des fichiers,
          dispatche @codereviewer sur le diff AVANT de marquer done. Review pas
          clean -> renvoie à l'executor (1 retry) ou @debugger.
       e. taskfile action=status -> done (review clean) ou blocked (échec après
          retry : note pourquoi, continue les tâches non dépendantes).
    5. CLORE : récap final — livré / bloqué / points, et ce qui reste.
    
    ## Règles
    
    - Le Task File est la source de vérité, pas ta mémoire : relis-le avant
      chaque dispatch.
    - Jamais deux tâches foreground en même temps ; les bg tournent pendant que
      tu continues ailleurs, ne les sonde pas (tu seras notifié).
    - Un demi-résultat déclaré fini est un échec : done = critère du Task File
      atteint ET review clean.
    - Escalade à l'utilisatrice quand une décision lui appartient (dépendance
      externe, choix d'architecture non convergé, permission).

## Todo-list (le panneau Plan)
Pour toute tâche à plusieurs étapes, tiens un todo-list via le tool \`todo\` :
pose toutes les étapes au départ, marque UNE seule étape \`in_progress\` à la
fois et \`completed\` dès qu'elle est finie (jamais de batch). Le panneau Plan
l'affiche en direct. Une tâche triviale (une étape) n'en a pas besoin.`,
        },
    direct: {
          mode: "subagent",
          description:
            "Panel — mandat DIRECT : défend l'option la plus simple qui atteint le but. Utilisé par /panel.",
          model: ROUTER_REF,
          // Structurel, pas un vœu de prompt (2026-07-15) : le panel raisonne et
          // cite, il n'agit pas — read-only garanti par les outils, pas espéré.
          permission: { edit: "deny", bash: "deny" },
          color: "#3fb950",
          prompt: `Tu es le mandat DIRECT d'un panel de décision à trois.
    Ta mission : proposer et défendre l'option la PLUS SIMPLE qui atteint le but, ancrée
    sur des FAITS VÉRIFIÉS du dépôt (lis le code, cite fichiers:lignes). Donne : ton
    option, les faits qui la soutiennent, son plus petit test de validation, et le signe
    concret qui montrerait qu'elle est mauvaise. Sois bref et factuel. ${""}`,
        },
    alternative: {
          mode: "subagent",
          description:
            "Panel — mandat ALTERNATIVE : construit la meilleure option DIFFÉRENTE de l'évidente. Utilisé par /panel.",
          model: ROUTER_REF,
          permission: { edit: "deny", bash: "deny" },
          color: "#d29922",
          prompt: `Tu es le mandat ALTERNATIVE d'un panel de décision à trois.
    Ta mission : construire la meilleure option DIFFÉRENTE de celle qui vient
    spontanément à l'esprit. Explore le dépôt pour l'ancrer sur des faits (cite
    fichiers:lignes). Donne : ton option, pourquoi elle peut battre l'évidente, son plus
    petit test de validation, et son principal risque. Interdiction de te rallier par
    confort : si tu convergés, c'est que les FAITS l'imposent.`,
        },
    sceptique: {
          mode: "subagent",
          description:
            "Panel — mandat SCEPTIQUE/red-team : cherche pourquoi les options vont casser. Utilisé par /panel.",
          model: ROUTER_REF,
          permission: { edit: "deny", bash: "deny" },
          color: "#f85149",
          prompt: `Tu es le mandat SCEPTIQUE (red-team) d'un panel de décision à trois.
    Ta mission : casser. Cherche pourquoi les options proposées vont échouer : hypothèses
    non vérifiées, effets de bord, état réel du dépôt qui contredit le plan (cite
    fichiers:lignes), coûts cachés, irréversibilités. Trois agents peuvent se tromper
    ensemble : conteste les FAITS, pas la rhétorique. Termine par : ce qui doit être
    VÉRIFIÉ avant d'agir, et le plus petit test qui tranche. Le consensus mou est un
    échec de ta mission.`,
        },
    executor: {
          mode: "subagent",
          hidden: true,
          description:
            "Exécuteur du mode CoeOS : implémente UNE tâche bornée du Task File. Joignable uniquement via le dispatch de l'Orchestrator.",
          model: ROUTER_REF,
          // Le SEUL subagent qui écrit (ADR 0002 amende l'invariant d'écriture :
          // debugger, agent par défaut, executor). La garde d'accès est runtime
          // (TaskTool), pas ici.
          permission: { edit: "allow", bash: "allow" },
          color: "#79c0ff",
          prompt: `Tu es l'EXECUTOR du mode CoeOS. On te donne UNE tâche bornée : un
    contexte, des fichiers, un critère de done, des bornes explicites.
    - Implémente EXACTEMENT la tâche, rien d'autre. Les bornes (« ne touche pas
      à X ») sont dures.
    - Vérifie ton travail avant de rendre : typecheck/tests ciblés si le dépôt
      en a, smoke minimal sinon. Un critère de done non vérifié n'est pas done.
    - Rends un rapport bref : ce qui a changé (fichiers), comment c'est vérifié,
      tout écart par rapport à la tâche (et pourquoi).
    - Si la tâche est infaisable telle quelle (hypothèse fausse, fichier
      manquant), STOPPE et rapporte — n'improvise pas un contournement.`,
        },
    debugger: {
          mode: "subagent",
          description:
            "Débogage evidence-first : reproduire, isoler, prouver la racine AVANT de proposer un fix. Utilisé par /debug.",
          model: ROUTER_REF,
          // bash explicite (reproduire/isoler exigent d'exécuter) ; edit NON
          // restreint — son protocole va jusqu'au FIX MINIMAL, contrairement au
          // reviewer qui ne fait que rapporter.
          permission: { bash: "allow" },
          color: "#ffa657",
          prompt: `Tu es le DEBUGGER de coeos-code. Protocole evidence-first strict :
    1. REPRODUIRE : construis le plus petit cas qui déclenche le symptôme. Exécute-le.
       Pas de reproduction = pas de diagnostic, dis-le.
    2. ISOLER : bissection (code, données, config, environnement). Chaque hypothèse
       est TESTÉE avant d'être crue — une probabilité n'est pas une certitude.
    3. PROUVER LA RACINE : montre la ligne/le mécanisme fautif avec la preuve
       (sortie de test, log, valeur inspectée). Cite fichiers:lignes.
    4. FIX MINIMAL : corrige la racine en touchant le moins possible. Un workaround
       qui masque le symptôme est INTERDIT.
    5. VÉRIFIER : re-exécute la reproduction, montre qu'elle passe, et cherche
       l'effet de bord évident du fix.
    Rends : symptôme → reproduction → preuve de la racine → fix → vérification.`,
        },
    codereviewer: {
          mode: "subagent",
          description:
            "Review adversariale de code : lit un diff/des fichiers et cherche les bugs réels. Utilisé par /review.",
          model: ROUTER_REF,
          // edit refusé (la review NE corrige PAS, elle rapporte) ; bash autorisé
          // (peut exécuter pour vérifier une affirmation du diff, pas pour écrire).
          permission: { edit: "deny", bash: "allow" },
          color: "#ff7b72",
          prompt: `Tu es le REVIEWER de coeos-code. On te donne un diff ou des fichiers.
    Ta mission : trouver les VRAIS problèmes, pas du style. Par ordre de gravité :
    1. bugs de correction (logique, cas limites, null/undefined, off-by-one, races),
    2. régressions (contrats cassés, appels existants qui ne matchent plus — VÉRIFIE
       les call-sites dans le dépôt, cite fichiers:lignes),
    3. sécurité (injection, secrets, chemins non validés),
    4. dette dangereuse (duplication d'une logique existante, abstraction violée).
    Pour CHAQUE trouvaille : fichier:ligne, scénario d'échec concret (entrée → effet),
    gravité (bloquant/majeur/mineur), et le fix minimal. Pas de compliments, pas de
    remarques cosmétiques. Zéro trouvaille réelle = dis-le explicitement, c'est un
    résultat valide. La complaisance est un échec.`,
        },
    codeexplore: {
          mode: "subagent",
          description:
            "Recherche read-only dans le dépôt : localiser du code, cartographier, résumer. Jamais d'écriture.",
          // Coeos-SE retiré du catalogue (même port que CoeOS désormais) — un pin
          // hors catalogue = « Model not found » (leçon du grill-reviewer).
          model: ROUTER_REF,
          permission: { edit: "deny", bash: "deny" },
          color: "#58a6ff",
          prompt: `Agent d'exploration read-only. Localise, cartographie, résume le code
    demandé. Cite systématiquement fichiers:lignes. N'écris JAMAIS (pas d'edit, pas de
    commande mutante). Rends un rapport dense et structuré, pas de dumps bruts.`,
        },
},
  // ── Commandes (fusion CodeOS 2026-08-23) ──
  command: {
    panel: {
      description:
        "Panel à 3 sur une décision conséquente : direct / alternative / sceptique, on n'agit qu'à convergence",
      template: `Décision à trancher : $ARGUMENTS

Déroule le protocole du panel à 3 de coeos-code :
1. Lance les TROIS subagents en parallèle sur cette décision : @direct, @alternative,
   @sceptique. Chacun reçoit la décision + le contexte pertinent du dépôt.
2. Synthétise leurs trois retours SANS les lisser : options, faits cités, tests
   proposés, signaux d'erreur.
3. VERDICT :
   - Convergence des trois sur des faits vérifiés → énonce l'option retenue, le plus
     petit test qui tranche, et le signe qui dirait qu'on s'est trompé. Puis agis.
   - Pas de consensus → NE TRANCHE PAS. Présente les positions et l'enjeu à
     l'utilisatrice ; c'est elle qui décide.`,
    },
    gate: {
      description:
        "Le gate avant action conséquente : faits / but+critère / ≥2 options / signe d'erreur / plus petit test",
      template: `Action envisagée : $ARGUMENTS

Remplis le gate coeos-code AVANT tout geste. Réponds point par point, ancré sur le dépôt
(cite fichiers:lignes), pas de généralités :
1. FAITS VÉRIFIÉS : qu'est-ce qui est établi (et comment) ? Ce qui n'est pas vérifié
   est marqué "hypothèse".
2. BUT + CRITÈRE DE RÉUSSITE : qu'est-ce qui doit être vrai à la fin, mesurable ?
3. OPTIONS (≥2) : au moins deux chemins réels, avec leur coût.
4. CHOIX + SIGNE D'ERREUR : l'option retenue, et le signal concret qui dirait
   qu'on se trompe (le "cheval mort").
5. PLUS PETIT TEST : le test minimal qui tranche avant d'engager le reste.
Si un point ne peut pas être rempli, dis-le : le gate n'est PAS passé.`,
    },
    goal: {
      description:
        "Mode objectif : itère jusqu'au but atteint (critère mesurable), ne s'arrête qu'au done ou blocage réel",
      template: `OBJECTIF : $ARGUMENTS

Passe en mode GOAL de coeos-code. Protocole strict :
1. CRITÈRE DE DONE : reformule l'objectif en critère MESURABLE et vérifiable
   (build vert, test qui passe, endpoint qui répond, fichier produit...). Si
   l'objectif est trop flou pour un critère, pose UNE question, puis verrouille.
2. BOUCLE : travaille par itérations. À CHAQUE itération : (a) l'action, (b) la
   VÉRIFICATION factuelle du résultat (exécute, ne suppose pas), (c) l'écart restant
   vs le critère de done.
3. PAS D'ARRÊT PRÉMATURÉ : tu ne t'arrêtes que dans DEUX cas — le critère de done
   est ATTEINT ET VÉRIFIÉ, ou un blocage réel exige une décision de l'utilisatrice
   (dépendance externe, choix d'architecture, permission). Un demi-résultat déclaré
   "fait" est un échec.
4. CHEVAL MORT : si tu empiles 2 rustines sur la même approche, stop — change
   d'approche et dis-le.
5. À la fin : bilan une ligne — critère de done, preuve, itérations utilisées.`,
    },
    "grill-me": {
      description:
        "Interview impitoyable du plan (une question à la fois) puis review adversariale cross-modèle par @grill-reviewer (MiniMax)",
      template: `SUJET À GRILLER : $ARGUMENTS

Déroule le protocole GRILL de coeos-code en deux actes.

ACTE 1 — L'INTERVIEW (toi ↔ l'utilisatrice) :
- Interroge-la SANS COMPLAISANCE sur son plan/design : UNE question à la fois,
  la plus discriminante d'abord. Pour chaque question, propose ta réponse
  recommandée (elle peut juste valider). Si le dépôt peut répondre à ta place,
  va lire le code au lieu de demander.
- Continue jusqu'à ce que CHAQUE branche de l'arbre de décision soit résolue :
  périmètre, cas limites, données, erreurs, migrations, sécurité, done criteria.
- Puis rédige le PLAN verrouillé : contexte, décisions actées (avec leurs raisons),
  étapes ordonnées, critères de done, hors-scope.

ACTE 2 — LA REVIEW CROSS-MODÈLE (adversariale) :
- Soumets le plan complet au subagent @grill-reviewer (autre modèle, mandat de
  destruction). Il rend VERDICT: APPROVED ou VERDICT: REVISE + points bloquants.
- REVISE → corrige le plan sur les points fondés (conteste les points non fondés,
  faits à l'appui), re-soumets. Maximum 3 rounds.
- APPROVED (ou cap atteint) → présente le plan final à l'utilisatrice avec le
  verdict et les points de désaccord résiduels. AUCUN code avant son feu vert.`,
    },
    review: {
      description: "Review adversariale du travail de la session courante par @codereviewer",
      template: `Passe en revue le travail de cette session.
1. Rassemble le diff complet de la session (fichiers modifiés/créés — utilise
   git diff si le dépôt est propre au départ, sinon la liste des changements).
2. Envoie ce diff + le contexte au subagent @codereviewer.
3. Restitue ses trouvailles SANS les adoucir, par gravité, avec fichier:ligne.
4. Pour chaque bloquant/majeur fondé : propose le fix minimal et applique-le si
   l'utilisatrice a déjà donné son feu vert sur ce périmètre ; sinon demande.
Cible optionnelle si précisée : $ARGUMENTS`,
    },
    debug: {
      description: "Débogage evidence-first par @debugger : reproduire, isoler, prouver, fixer",
      template: `Symptôme à déboguer : $ARGUMENTS

Délègue au subagent @debugger avec le protocole evidence-first (reproduire →
isoler → prouver la racine avec fichiers:lignes → fix minimal → re-vérifier).
Restitue : la preuve de la racine, le fix, la vérification. Si la reproduction
est impossible, dis-le et liste ce qui manque — n'invente JAMAIS un diagnostic.`,
    },
    judge: {
      description: "Note des réponses de moteur au protocole TMB (notes-only) via @bench-judge",
      template: `À évaluer au protocole TMB : $ARGUMENTS

Délègue au subagent @bench-judge. Fournis-lui la/les réponse(s) du moteur + la
grille des critères. Il rend des NOTES-ONLY : points/max par critère (points <=
max), AUCUN total, AUCUN verdict en prose, flags factuels courts. Un JSON par
(bench, moteur, test). S'il manque la grille ou la réponse, il la demande — il
n'invente pas de critère.`,
    },
    verify: {
      description: "Vérification factuelle : build, typecheck, tests — rapport brut, aucun geste",
      template: `Vérifie l'état réel du projet, dans cet ordre et SANS rien corriger :
1. Détecte l'outillage (package.json scripts, Makefile, pyproject, cargo...).
2. Exécute ce qui existe parmi : typecheck, lint, build, tests.
3. RAPPORT FACTUEL : commande exacte → exit code → dernières lignes utiles.
   Aucun geste correctif, aucun "ça devrait passer" — que du constaté.
4. Termine par le verdict binaire : VERT (tout passe) ou ROUGE (liste des échecs).
Périmètre optionnel : $ARGUMENTS`,
    },
    onboard: {
      description: "Génère AGENTS.md du projet : structure, conventions, commandes, pièges",
      template: `Génère (ou mets à jour) le fichier AGENTS.md à la racine de CE projet.
Explore d'abord VRAIMENT le dépôt (arborescence, package/build files, README,
configs, 2-3 fichiers de code représentatifs). Si les outils rag_search ou
graphify_explain sont disponibles, interroge-les sur ce projet.
Contenu (dense, factuel, PAS de blabla) :
# <nom du projet>
## Ce que c'est — 2 phrases max
## Structure — les dossiers qui comptent et leur rôle
## Commandes — build/test/run VÉRIFIÉES (exécute-les pour confirmer)
## Conventions — style, nommage, patterns observés dans le code réel
## Pièges — gotchas découverts (configs dupliquées, ordres d'init, etc.)
Écris le fichier. Il est lu automatiquement par coeos-code à chaque session.`,
    },
    fable: {
      description:
        "Méthode Fable : dérouler les 5 gates (scope/évidence/adversarial/vérif/report) sur une tâche à couches",
      template: `Applique la MÉTHODE FABLE à : $ARGUMENTS

Discipline pour toute tâche où la première idée peut être fausse (multi-étapes,
inconnues, débogage, recherche à vérifier). Ce n'est PAS un workflow qui produit
des fichiers — c'est la façon d'exécuter la tâche. Trivial (1 fichier, lookup) →
saute les gates, fais le travail. Sinon, 5 gates DANS L'ORDRE, chacun passe avant
le suivant ; si ça bloque ou qu'un résultat surprend, nomme le gate courant et re-run.

GATE 1 — SCOPE AVANT DE TRAVAILLER
- "Fini" en 1-2 phrases : quel artefact existe à la fin, ce qui doit être vrai de
  lui, et COMMENT tu le vérifieras. Pas de test écrivable = tâche pas comprise.
- Lire les règles debout d'abord (RULES, mémoire projet) — ne pas réinventer.
- Séparer connu / supposé. Nommer les 1-3 inconnues load-bearing (si fausses, la
  forme de la solution change).
- Ambiguïté qui change ce que tu construirais → 1 question sur le plus gros trou.
  Sinon défaut raisonnable annoncé en 1 ligne, et on avance.

GATE 2 — ÉVIDENCE AVANT RAISONNEMENT
- Jamais concevoir de mémoire de ce qu'un fichier/API/dataset "ressemble
  probablement". L'ouvrir. La mémoire d'entraînement = générateur d'hypothèses.
- Attaquer les inconnues load-bearing d'abord, avec la sonde la moins chère.
- Passe fine bout-en-bout (un item dans tout le pipeline, vérifié) avant de scaler.
- Plan vivant si ≥3 étapes, tranché par dépendance (sortie N → entrée N+1). Hypothèse,
  pas contrat.

GATE 3 — RAISONNER ADVERSARIALEMENT
- Avant de committer une réponse, changer de rôle et essayer de la TUER : quel
  input/état/lecture la rend fausse ? Tester le cas, ne pas l'imaginer.
- Puis steelman ce qui survit. Steelman aussi l'existant avant de le changer
  (nommer la raison plausible de sa forme actuelle).
- En review : ne rien trouver est un résultat valide ; ne jamais fabriquer un défaut.
- Re-décider après CHAQUE résultat : confirme le plan ou le change ? Le piège =
  l'élan (dérouler l'étape 4 d'un plan que l'étape 2 a déjà invalidé).
- 2 tentatives ratées du même fix = le diagnostic est faux. Trouver l'hypothèse
  sous les deux, la tester directement.

GATE 4 — VÉRIFIER AVANT DE DÉCLARER FINI
- "Ça a tourné" n'est pas une vérif. Vérifier au NIVEAU DE LA CLAIM : output
  correct → regarder l'output ; page rend → regarder la page. Exit 0 ne prouve que
  la couche du dessous.
- Preuve que tu n'as pas générée : rouvrir le fichier écrit, ré-exécuter, diff
  avant/après, compter ce que tu as dit compter.
- Échantillonner les bords : 1er, dernier, plus bizarre — pas juste le milieu.
- Bonne nouvelle = suspecte : un sweep tout-propre est cassé jusqu'à ce que tu
  expliques pourquoi le résultat est réel.
- Re-check contre la demande d'origine ET les règles chargées au Gate 1.

GATE 5 — REPORTER CALIBRÉ
- Réponse d'abord, support ensuite.
- Séparer vérifié / supposé à voix haute ("confirmé X en lançant Y ; je suppose Z,
  pas pu vérifier").
- Citer les preuves avec précision : chemins, lignes, la commande, le nombre vu.
- Rapporter l'observé, pas l'intention. Tests ratés → le dire avec la sortie.
- Ne jamais adoucir un vrai problème ; le signaler une fois, concret, puis
  respecter la décision de l'utilisatrice.

Outils que la méthode va chercher : \`/gate\` (G1), \`/panel\` (G3), \`/verify\` (G4),
\`/debug\` (débogage sous G2-G4). Ne pas forcer les 5 gates sur du trivial.`,
    },
    "session-doc": {
      description: "Doc de fin de session : Done / Difficulties / To-do, points Fibonacci",
      template: `Rédige le document de session pour le travail effectué dans cette
conversation, format OdyssAI :
## Done — N points
- [pts] réalisations, avec fichiers/commits
## Difficulties
- les murs rencontrés, les fausses pistes, les leçons
## To do — N points
1. [pts] prochaines étapes ordonnées
## Metrics
- totaux, commits, décisions
Points en Fibonacci (1,2,3,5,8,13,21), jamais d'estimation en temps. Français,
technique, direct. Cite les quotes importantes de l'utilisatrice verbatim.`,
    },
  },

}

// Routage par compétence (Sophie 2026-07-15) : chaque agent coeos-code pointe le
// modèle que la console superagent (:4800) affecte à SON rôle — la MÊME
// donnée (score-table + paires de compétences) que le superagent headless,
// PAS un pipeline importé (jamais de grill×2 : cf. panel sceptique du
// 2026-07-15, "grill-reviewer→pipeline appelable comme modèle" est le mode
// d'échec identifié). Un agent coeos-code = un modèle-feuille, jamais un pipeline.
//
// Clé agent (COEOS_DEFAULT_CONFIG.agent) -> son entrée dans le manifeste
// coeos-roles.json / la sortie de compose (coeos-agents.json). grill-reviewer
// est délibérément ABSENT : cross-modèle par design, jamais composé.
const ROLE_MANIFEST_KEY: Record<string, string> = {
  // Clé agent (COEOS_DEFAULT_CONFIG.agent) -> clé du rôle côté console CoeOS
  // (rôle routé par la score-table). Némo cowork (2026-08-10).
  explore: "nemo-explore",
  writer: "nemo-writer",
  ops: "nemo-ops",
  parser: "nemo-parser",
  producer: "nemo-producer",
  memory: "nemo-memory",
  guardian: "nemo-guardian",
  nemo: "nemo-orchestrator",
}

const ROLE_FETCH_TIMEOUT_MS = 1500 // budget TOTAL (state + models), jamais par-fetch

// Le MOTEUR CoeOS sert /api/state (public, lecture seule) sur son propre
// origin — plus la console sur :4800. En SaaS, moteur et console sont deux
// vhosts Caddy distincts : `engine.baseUrl:4800` est injoignable. Némo lit donc
// l'affectation depuis le moteur qu'il joint déjà (coeos-SE app.py:/api/state ;
// override editable = N1.1c). En LAN co-localisé, /api/state répond aussi côté
// moteur : un seul chemin pour les deux topologies.
function engineStateUrl(engine: ResolvedEngine): string {
  const u = new URL(engine.baseUrl)
  u.pathname = "/api/state"
  return u.toString()
}

// odyssai/or:nemotron-3-super -> or:nemotron-3-super (namespace OMP retiré ;
// l'id nu est ce que /v1/models et le provider coeos attendent).
function bareModelId(prefixed: string): string {
  const i = prefixed.indexOf("/")
  return i === -1 ? prefixed : prefixed.slice(i + 1)
}

/** Sortie de la résolution des rôles : le modèle par agent (patché dans le
 * config) + le hint d'axe par agent (options du plugin codeos-axis, émis en
 * x-coeos-axis à chaque requête — uniquement pour les rôles routés par le
 * modèle virtuel CoeOS). */
export type RoleAssignment = {
  models: Record<string, string>
  axes: Record<string, string>
}

/** Interroge le moteur apparié (/api/state), valide chaque pick contre les
 * modèles réellement servables, retourne {models: {agentKey: "coeos/<id nu>"},
 * axes: {agentKey: "<axe>"}} (axes seulement quand le pick est le routeur).
 * Timeout/erreur/console injoignable/reponse vide -> null (JAMAIS de crash,
 * jamais de blocage du lancement au-delà du budget — même contrat que
 * resolveEngine dans coeos-pairing.ts). */
export async function fetchRoleAssignment(engine: ResolvedEngine): Promise<RoleAssignment | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ROLE_FETCH_TIMEOUT_MS)
  try {
    const stateRes = await fetch(engineStateUrl(engine), {
      signal: ctrl.signal,
      headers:
        engine.apiKey && engine.apiKey !== "dummy" ? { Authorization: `Bearer ${engine.apiKey}` } : {},
    })
    if (!stateRes.ok) return null
    const state = (await stateRes.json()) as {
      assignment?: Record<string, { model?: string; axis?: string }>
      router?: string
    }
    const assignment = state.assignment
    if (!assignment) return null

    // /v1/models est auth-gated côté SaaS (401 sans token) -> sans ce header,
    // `servable` serait vide et TOUS les picks rejetés (override silencieusement
    // ignoré, l'agent retombe sur le défaut). Bug N1.1c.
    const modelsRes = await fetch(`${engine.baseUrl}/v1/models`, {
      signal: ctrl.signal,
      headers:
        engine.apiKey && engine.apiKey !== "dummy" ? { Authorization: `Bearer ${engine.apiKey}` } : {},
    })
    const modelsData = modelsRes.ok ? ((await modelsRes.json()) as { data?: Array<{ id?: string }> }) : { data: [] }
    const servable = new Set((modelsData.data ?? []).map((m) => m.id).filter((id): id is string => !!id))

    const resolved: RoleAssignment = { models: {}, axes: {} }
    for (const [agentKey, manifestKey] of Object.entries(ROLE_MANIFEST_KEY)) {
      const pick = assignment[manifestKey]?.model
      if (!pick) continue
      const bare = bareModelId(pick)
      if (!servable.has(bare)) continue // affecté mais pas (ou plus) servi -> on ignore, pas de crash
      resolved.models[agentKey] = `coeos/${bare}`
      const axis = assignment[manifestKey]?.axis
      // le hint n'a de sens que sur le routeur (id publié par /api/state)
      if (axis && state.router && bare === state.router) resolved.axes[agentKey] = axis
    }
    return Object.keys(resolved.models).length ? resolved : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function loadPersistedRoleAssignment(): RoleAssignment | null {
  const v = getStore().get(ROLE_ASSIGNMENT_KEY) as Record<string, unknown> | undefined
  if (!v || !Object.keys(v).length) return null
  // migration : l'ancien format persisté était un plat {agentKey: "coeos/<id>"}
  if (typeof Object.values(v)[0] === "string") {
    return { models: v as Record<string, string>, axes: {} }
  }
  const composite = v as unknown as RoleAssignment
  return composite.models && Object.keys(composite.models).length ? composite : null
}

/** Chaîne de repli : console fraîche -> dernier mapping persisté REVALIDÉ
 * contre /v1/models -> défauts de COEOS_DEFAULT_CONFIG.agent (inchangés,
 * aucune régression). Un succès console est persisté pour servir de repli la
 * prochaine fois qu'elle est injoignable. La revalidation (v2 WU3, round 1
 * finding 12) : un mapping persisté peut pointer des modèles déchargés depuis
 * — console down n'implique pas engine down (ports distincts), donc on
 * filtre les picks morts au lieu de les servir en aveugle ; engine muet ->
 * mapping persisté tel quel (le provider coeos gérera l'erreur à l'usage). */
async function resolveRoleAssignment(engine: ResolvedEngine | null | undefined): Promise<RoleAssignment | null> {
  if (!engine) return null
  const fresh = await fetchRoleAssignment(engine)
  if (fresh) {
    getStore().set(ROLE_ASSIGNMENT_KEY, fresh)
    return fresh
  }
  const persisted = loadPersistedRoleAssignment()
  if (!persisted) return null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ROLE_FETCH_TIMEOUT_MS)
    const res = await fetch(`${engine.baseUrl}/v1/models`, {
      signal: ctrl.signal,
      headers:
        engine.apiKey && engine.apiKey !== "dummy" ? { Authorization: `Bearer ${engine.apiKey}` } : {},
    }).finally(() => clearTimeout(timer))
    if (!res.ok) return persisted
    const data = (await res.json()) as { data?: Array<{ id?: string }> }
    const servable = new Set((data.data ?? []).map((m) => m.id).filter((id): id is string => !!id))
    const models = Object.fromEntries(
      Object.entries(persisted.models).filter(([, id]) => servable.has(bareModelId(id))),
    )
    if (!Object.keys(models).length) return null
    return { models, axes: persisted.axes }
  } catch {
    return persisted
  }
}

export function applyRoleAssignment(agent: typeof COEOS_DEFAULT_CONFIG.agent, resolved: RoleAssignment | null) {
  if (!resolved) return agent
  // Les entrées d'agent ne sont pas uniformes (grill-reviewer porte `hidden`,
  // les autres non) : TS unifie mal une assignation indexée générique sur ce
  // type hétérogène (intersection de 7 shapes). On mute via un type large
  // (seul le champ `model`, présent PARTOUT, est jamais touché), puis on
  // reaffirme la forme d'origine au retour — correct à l'exécution, le
  // souci n'était que l'inférence statique de l'assignation intermédiaire.
  const patched: Record<string, { model: string; [key: string]: unknown }> = { ...agent }
  for (const [agentKey, modelId] of Object.entries(resolved.models)) {
    const current = patched[agentKey]
    if (!current) continue // agent inconnu du config de base -> ignore, jamais d'ajout silencieux
    patched[agentKey] = { ...current, model: modelId }
  }
  return patched as typeof agent
}

/** Ids nus réellement servis par l'engine (/v1/models). Budget borné (partagé
 * avec la résolution des rôles), jamais bloquant au-delà ; toute erreur -> []
 * (le provider garde alors ses seuls modèles curatés). Double emploi : (1)
 * alimenter le picker Settings > Models via provider.coeos.models ; (2) valider
 * le choix plan/build AVANT de l'appliquer — un pick sur un modèle déchargé
 * serait rejeté « Model not found » (même piège que MI:Minimax3, 2026-08-02). */
// Budget PROPRE au catalogue (≠ résolution des rôles) : c'est une lecture au
// boot, awaitée avant le démarrage du serveur, et un LAN froid dépasse souvent
// 1.5s — d'où le collapse « 2 modèles » du 2026-08-03. 5s au pire, une seule
// fois ; le repli persistant (MODEL_CATALOG_KEY) couvre les flakes suivants.
const MODEL_FETCH_TIMEOUT_MS = 5000

/** Un modèle servi par l'engine, avec sa métadonnée utile : fenêtre de contexte
 * et support des tools (exposés par /v1/models dans x_odyssai). SANS ça,
 * opencode met limit.context=0 (provider.ts:1469) et n'élague JAMAIS -> overflow
 * "maximum context length" (bug 2026-08-07). */
export type ServableModel = { id: string; context?: number; output?: number; tools?: boolean }

/** GET JSON via curl (process enfant), PAS via le fetch de Node/Electron.
 * Découvert 2026-08-07 : sur un Mac multi-homé (deux interfaces actives sur le
 * MÊME sous-réseau — en0 + en11 chez Sophie), la pile réseau de Node/Electron
 * tombe en EHOSTUNREACH vers l'engine LAN (.39) — même bindée explicitement sur
 * une interface qui marche — alors que curl (et le sidecar bun) routent
 * correctement. curl est toujours présent sur macOS ; coeos-code est macOS-only.
 * Utilisé aussi bien côté Electron-main (buildCoeosConfig) que côté bun
 * (codeos-server.sh) : curl marche dans les deux. */
function curlJson(url: string, budgetMs: number, apiKey?: string): Promise<unknown | null> {
  return new Promise((resolve) => {
    const args = ["-sS", "-m", String(Math.max(1, Math.ceil(budgetMs / 1000))), "-H", "Accept: application/json"]
    if (apiKey && apiKey !== "dummy") args.push("-H", `Authorization: Bearer ${apiKey}`)
    args.push(url)
    execFile("/usr/bin/curl", args, { timeout: budgetMs + 1000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null)
      try {
        resolve(JSON.parse(stdout))
      } catch {
        resolve(null)
      }
    })
  })
}

export async function fetchServableModels(
  engine: ResolvedEngine | null | undefined,
  budgetMs = MODEL_FETCH_TIMEOUT_MS,
): Promise<ServableModel[]> {
  if (!engine) return []
  const data = (await curlJson(`${engine.baseUrl}/v1/models`, budgetMs, engine.apiKey)) as {
    data?: Array<{
      id?: string
      x_odyssai?: { context_length?: number; max_output_tokens?: number; supports_tools?: boolean }
    }>
  } | null
  if (!data) return []
  try {
    return (data.data ?? [])
      .filter((m): m is { id: string; x_odyssai?: NonNullable<(typeof m)["x_odyssai"]> } => !!m.id)
      .map((m) => {
        const xo = m.x_odyssai ?? {}
        return {
          id: m.id,
          context: typeof xo.context_length === "number" && xo.context_length > 0 ? xo.context_length : undefined,
          output: typeof xo.max_output_tokens === "number" && xo.max_output_tokens > 0 ? xo.max_output_tokens : undefined,
          tools: typeof xo.supports_tools === "boolean" ? xo.supports_tools : undefined,
        }
      })
  } catch {
    return []
  }
}

// Fenêtre par défaut quand l'engine n'en déclare pas (routeur CoeOS : ctx=None).
// 128k = plancher défendable qui fait élaguer opencode avant les backends
// courants ; pour du très long contexte, adresser un modèle précis (Kimi K3=1M).
const DEFAULT_CONTEXT_TOKENS = 128_000
const MAX_OUTPUT_TOKENS = 32_000

function limitFor(m: ServableModel): { context: number; output: number } {
  const context = m.context && m.context > 0 ? m.context : DEFAULT_CONTEXT_TOKENS
  const output =
    m.output && m.output > 0
      ? Math.min(MAX_OUTPUT_TOKENS, m.output)
      : Math.min(MAX_OUTPUT_TOKENS, Math.max(4_096, Math.floor(context / 4)))
  return { context, output }
}

// Noms d'affichage soignés pour les têtes d'affiche ; le reste tombe sur l'id
// nettoyé de son préfixe de namespace (voir prettyModelName).
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  CoeOS: "CoeOS",
  "MI:Minimax3": "MiniMax 3 (grill)",
  "MI:Minimax2.7": "MiniMax 2.7",
  "MI:MiniMax-M2.7-highspeed": "MiniMax 2.7 (highspeed)",
  "or:kimi-k3": "Kimi K3",
  "or:kimi-k2.6": "Kimi K2.6",
  "or03:kimi-k-2.7-code": "Kimi K2.7 Code",
  "or02:glm-5.2": "GLM 5.2",
  "or:glm-5.1": "GLM 5.1",
  "or14:qwen3.7-plus": "Qwen 3.7 Plus",
  "or:deepseek-v4-pro": "DeepSeek V4 Pro",
  "or07:deepseekv4-flash": "DeepSeek V4 Flash",
  "or12:mimo-v2.5-pro": "Mimo 2.5 Pro",
  "or:mimo-v2.5-pro": "Mimo 2.5 Pro",
  "or05:nemotron": "Nemotron 3 Super",
  "or:minimax-m2.7": "MiniMax 2.7",
  "or:opus-4.8": "Opus 4.8",
  "or:opus5": "Opus 5",
  "or:o3": "o3",
  "or:Fable5": "Fable 5",
}

/** id -> nom d'affichage. Mapping soigné pour les têtes d'affiche, sinon on
 * retire le préfixe de namespace (« or02: », « MI: », « tele-fast: ») pour
 * rendre l'id lisible et cherchable dans le picker (Issue 2, 2026-08-07). */
function prettyModelName(id: string): string {
  const nice = MODEL_DISPLAY_NAMES[id]
  if (nice) return nice
  const i = id.indexOf(":")
  return i === -1 ? id : id.slice(i + 1)
}

/** Catalogue du provider unique OdyssAI-x, ENRICHI (2026-08-07) : nom soigné +
 * vraie fenêtre de contexte (limit) + capacité tools, depuis /v1/models. Les
 * curatés (CoeOS routeur, pin grill) restent toujours présents. Fonction PURE
 * (sans electron) : partagée par buildCoeosConfig (sidecar app) et
 * scripts/codeos-server.sh (serveur LAN). */
export function coeosModelsWithCatalog(
  models: ServableModel[],
): Record<string, { name: string; limit: { context: number; output: number }; tool_call?: boolean }> {
  const out: Record<string, { name: string; limit: { context: number; output: number }; tool_call?: boolean }> = {}
  const servableById = new Map(models.map((m) => [m.id, m]))
  // UN SEUL modèle exposé au picker (Sophie 2026-08-11) : les curatés (CoeOS,
  // le routeur). On enrichit sa fenêtre + tools depuis /v1/models si l'engine
  // le sert, sinon fenêtre par défaut. On N'AJOUTE PLUS les autres servables au
  // catalogue — tout passe par CoeOS, le moteur route vers le vrai modèle. (Les
  // agents doivent utiliser un id du catalogue, sinon opencode « Model not
  // found » — provider.ts:1790 — d'où : tous les agents sur coeos/CoeOS.)
  for (const id of Object.keys(COEOS_DEFAULT_CONFIG.provider.coeos.models)) {
    const m = servableById.get(id)
    out[id] = {
      name: prettyModelName(id),
      limit: limitFor(m ?? { id }),
      ...(m?.tools === false ? { tool_call: false } : {}),
    }
  }
  return out
}

/** Écrase agent.build/plan.model depuis Settings > Models (electron-store).
 * L'affectation des modes visibles vit ICI, côté coeos-code — rien n'est ajouté à
 * CoeOS. Un pick vide, ou pointant un modèle que l'engine ne sert plus, est
 * ignoré : on conserve le défaut du config (coeos/CoeOS). Même philosophie de
 * revalidation que resolveRoleAssignment (on ne sert jamais un modèle mort). */
function applyModelSelection(agent: typeof COEOS_DEFAULT_CONFIG.agent, servable: Set<string>) {
  const patched: Record<string, { model: string; [key: string]: unknown }> = { ...agent }
  for (const [agentKey, storeKey] of [
    ["build", BUILD_MODEL_KEY],
    ["plan", PLAN_MODEL_KEY],
  ] as const) {
    const raw = getStore().get(storeKey)
    const id = typeof raw === "string" ? raw : ""
    if (!id || !servable.has(bareModelId(id))) continue
    const current = patched[agentKey]
    if (!current) continue
    patched[agentKey] = { ...current, model: `coeos/${id}` }
  }
  return patched as typeof agent
}

// Config final assemblé au démarrage : base + plugin session-doc + MCP contexte
// (graphify local stdio, docling remote sur .44:8087). Les chemins d'assets sont
// matérialisés par ensureCodeosAssets() (voir coeos-assets.ts). ASYNC depuis
// 2026-07-15 (interroge la console superagent, budget 1.5s, jamais bloquant
// au-delà) — voir resolveRoleAssignment.
/** Les providers que l'operatrice a colles dans Settings (format opencode).
 * Deja valides au save ; re-gardes ici parce qu'un fichier de store peut avoir
 * ete edite a la main, et qu'un bloc casse ferait rejeter TOUTE la config du
 * sidecar (donc plus aucun modele, y compris CoeOS). */
export function extraProvidersOf(raw: string): Record<string, unknown> {
  const text = (raw || "").trim()
  if (!text) return {}
  try {
    const provider = (JSON.parse(text) as { provider?: Record<string, unknown> })?.provider
    if (!provider || typeof provider !== "object") return {}
    const out: Record<string, unknown> = {}
    for (const [id, entry] of Object.entries(provider)) {
      const e = entry as { npm?: unknown; options?: { baseURL?: unknown }; models?: Record<string, unknown> }
      if (typeof e?.npm !== "string" || typeof e?.options?.baseURL !== "string") continue
      if (!e?.models || !Object.keys(e.models).length) continue
      // Le provider du routeur n'est pas surchargeable ici : il porte l'engine
      // apparie et sa cle. Un homonyme colle le remplacerait en silence.
      if (id === ROUTER_PROVIDER) continue
      out[id] = entry
    }
    return out
  } catch {
    return {}
  }
}


/** Le triage peut tourner ailleurs que sur le routeur — c'est meme l'interet :
 * un petit modele local, choisi pour la fiabilite du format JSON. La reference
 * est `<provider>/<modele>` ; on rend l'adresse et la cle du provider concerne,
 * pour que le plugin appelle le bon endpoint et pas celui du routeur. */
export function resolveTriage(
  ref: string,
  provider: Record<string, unknown>,
  engine?: ResolvedEngine | null,
): { triageModel: string; triageBaseURL: string; triageApiKey: string } {
  const empty = { triageModel: "", triageBaseURL: "", triageApiKey: "" }
  const i = (ref || "").indexOf("/")
  if (i <= 0) return empty
  const pid = ref.slice(0, i)
  const model = ref.slice(i + 1)
  if (!model) return empty
  if (pid === ROUTER_PROVIDER) {
    if (!engine) return empty
    return { triageModel: model, triageBaseURL: `${engine.baseUrl}/v1`, triageApiKey: engine.apiKey }
  }
  const entry = provider[pid] as { options?: { baseURL?: string; apiKey?: string } } | undefined
  const baseURL = entry?.options?.baseURL
  if (!baseURL) return empty          // provider disparu -> pas de triage, jamais d'appel a l'aveugle
  return { triageModel: model, triageBaseURL: baseURL, triageApiKey: entry?.options?.apiKey || "dummy" }
}


export async function buildCoeosConfig(assets: CodeosAssets, engine?: ResolvedEngine | null) {
  // engine résolu au démarrage (coeos-pairing.ts). Absent -> provider dégradé
  // (placeholder inatteignable + warn côté index.ts), jamais de crash ni de hardcode.
  // Catalogue live avec REPLI PERSISTANT (fix 2026-08-03). Le fetch au boot peut
  // flancher (LAN froid) -> avant, le provider retombait sur les 2 curatés
  // (bug « il y a juste minimax »). Désormais : succès -> peuple + persiste ;
  // échec -> ressert le dernier catalogue connu (MODEL_CATALOG_KEY). engine
  // absent -> [] (provider dégradé, curatés seuls). Même pattern que les rôles.
  let servable: ServableModel[] = []
  if (engine) {
    servable = await fetchServableModels(engine)
    if (servable.length) {
      getStore().set(MODEL_CATALOG_KEY, servable)
    } else {
      const cached = getStore().get(MODEL_CATALOG_KEY)
      if (Array.isArray(cached)) {
        // Repli tolérant : ancien cache (string[], 0.5.7) ET nouveau (ServableModel[]).
        servable = cached
          .map((x): ServableModel | null =>
            typeof x === "string" ? { id: x } : x && typeof x.id === "string" ? (x as ServableModel) : null,
          )
          .filter((x): x is ServableModel => !!x)
      }
    }
  }
  const servableIds = new Set(servable.map((m) => m.id))
  const baseProvider = engine
    ? {
        ...COEOS_DEFAULT_CONFIG.provider,
        coeos: {
          ...COEOS_DEFAULT_CONFIG.provider.coeos,
          models: coeosModelsWithCatalog(servable),
          options: { baseURL: `${engine.baseUrl}/v1`, apiKey: engine.apiKey },
        },
      }
    : COEOS_DEFAULT_CONFIG.provider
  const resolvedRoles = await resolveRoleAssignment(engine)
  // Mémoire user (vault Obsidian local) : on garantit le dossier, et si le vault
  // porte un `_index.md` (après import), on l'injecte au démarrage — le modèle
  // voit la carte de la mémoire. Vide -> silencieux. La CAPTURE (écriture au fil
  // de l'eau) est un lot séparé.
  ensureMemoryVault()
  const memoryInstructions = hasMemoryIndex() ? [memoryIndexPath()] : []
  // Ses machines a elle, telles qu'elle les a declarees. Ajoutees, jamais
  // substituees : CoeOS reste la.
  const provider = { ...baseProvider, ...extraProvidersOf(getExtraProviders()) }
  return {
    ...COEOS_DEFAULT_CONFIG,
    provider,
    // Le verrou enumere les providers REELS. Une liste figee ["coeos"] rejetait
    // en silence tout provider ajoute (provider.ts isProviderAllowed) : declare,
    // puis jete, sans un mot. La protection tient toujours — la config du
    // sidecar gagne en dernier, un opencode.json projet n'ajoute rien.
    enabled_providers: Object.keys(provider),
    agent: applyModelSelection(applyRoleAssignment(COEOS_DEFAULT_CONFIG.agent, resolvedRoles), servableIds),
    // Règles globales (fichier matérialisé — le schéma v1 ignore le texte inline)
    // + index de la mémoire user (vault local, si importé)
    // + mémoire persistante par projet (écrite par le plugin session-doc,
    // chargée automatiquement quand elle existe — absente = silencieux).
    instructions: [assets.rulesPath, ...memoryInstructions, ".nemo/MEMORY.md"],
    // Le plugin génère docs+mémoire via l'engine RÉSOLU (pas de hardcode) ;
    // baseURL absent -> plugin inerte.
    plugin: [
      [
        assets.sessionDocPluginUrl,
        {
          minMessages: 6,
          minNewMessages: 4,
          baseURL: engine ? `${engine.baseUrl}/v1` : "",
          apiKey: engine?.apiKey ?? "dummy",
          model: ROUTER_MODEL,
        },
      ],
      // Capture de la mémoire USER (vault Obsidian local) au fil de l'eau :
      // extraction LLM des faits durables en fin de session -> notes catégorisées
      // + regen de _index.md. Inerte si engine absent (baseURL vide).
      [
        assets.memoryCapturePluginUrl,
        {
          baseURL: engine ? `${engine.baseUrl}/v1` : "",
          apiKey: engine?.apiKey ?? "dummy",
          model: ROUTER_MODEL,
          vaultDir: memoryVaultDir(),
        },
      ],
      // Retrieval L1 personnel (100 % local) : à chaque tour, injecte le top-k des
      // notes du vault pertinent au message — en plus du wiki statique
      // (`instructions`, toujours présent = le fallback). HYBRIDE : BM25 lexical
      // (toujours, zéro dépendance) + sémantique OPTIONNEL si un embedder LOCAL est
      // configuré (memoryEmbedConfig, vide -> pur BM25). Pas d'engine requis.
      // Vault vide -> inerte.
      [
        assets.memoryInjectPluginUrl,
        {
          vaultDir: memoryVaultDir(),
          ...memoryEmbedConfig(),
        },
      ],
      // La procédure en CODE, pas en prompt (2026-07-15) : triage + planchers
      // + review forcé. Inerte si engine absent (baseURL vide -> plugin
      // no-op), même contrat que le plugin session-doc ci-dessus.
      [
        assets.sequencerPluginUrl,
        {
          baseURL: engine ? `${engine.baseUrl}/v1` : "",
          apiKey: engine?.apiKey ?? "dummy",
          // Choisi dans Settings, sous la forme `<provider>/<modele>`. Vide ou
          // provider disparu -> pas de triage du tout : le plugin retombe sur
          // son defaut prudent, ce qui vaut mieux qu'appeler un modele ecrit en
          // dur qui n'est plus servi (cas reel, `dspartha-gemma`).
          ...resolveTriage(getTriageModel(), provider, engine),
        },
      ],
      // Hint d'axe CoeOS par agent (étape 6) : x-coeos-axis à chaque requête
      // des rôles routés par le modèle virtuel. Mapping vide -> inerte.
      [
        assets.axisPluginUrl,
        {
          axes: resolvedRoles?.axes ?? {},
        },
      ],
    ],
    mcp: {
      ...COEOS_DEFAULT_CONFIG.mcp, // conserve rag (NEMO_RAG_MCP_URL)
      graphify: {
        type: "local",
        // chemin python absolu : pas de dépendance au PATH d'une app GUI
        command: ["/usr/bin/python3", assets.graphifyMcpPath],
        environment: {
          GRAPHIFY_GRAPH: join(homedir(), ".graphify", "stack", "graph.json"),
          GRAPHIFY_BIN: join(homedir(), ".local", "bin", "graphify"),
        },
        enabled: true,
        timeout: 120000, // le graph 18MB est rechargé à chaque appel
      },
      docling: {
        type: "remote",
        url: process.env.NEMO_DOCLING_MCP_URL ?? "http://docling.lan:8087/mcp",
        enabled: Boolean(process.env.NEMO_DOCLING_MCP_URL),
        timeout: 300000, // parse de PDF lourds
      },
    },
  }
}
