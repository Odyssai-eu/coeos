"""roles — construit un pydantic_ai.Agent par role, depuis les MEMES
sources de donnees que v1 : coeos-roles.json (manifeste) pour la forme du
pipeline, coeos-agents.json (sortie de la console :4800) pour le modele
choisi (suggestion ou override), agents/<role>.md pour le system prompt
(le contrat de comportement reste le meme texte qu'en v1 — seule
l'EXECUTION du contrat change de substrat).

AUCUN HARDCODE : ajouter un role = une entree dans les DEUX fichiers JSON
+ un .md ; ce module ne connait aucun nom de role en dur.
"""
import json
import re
from pathlib import Path

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.settings import ModelSettings

# pydantic-ai laisse max_tokens sans defaut -> le premier appel de
# l'executeur (tool write_file avec un fichier complet en argument) a
# echoue immediatement (UnexpectedModelBehavior: token limit exceeded
# before any response). Les modeles OMP servent jusqu'a 33K out
# (verifie `omp models`) ; 16000 laisse la marge au raisonnement+outil.
DEFAULT_MODEL_SETTINGS = ModelSettings(max_tokens=16000)

FRONT_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.S)

# Seul l'executeur ecrit (separation STRUCTURELLE, identique v1 :
# orchestrator.py commentaire "Seul l'executeur a l'outil write").
# Le sceptique lit + execute pour verifier ; les autres n'ont aucun outil
# (leur contrat est de raisonner sur le texte qu'on leur fournit).
TOOL_GRANTS = {
    "executeur": "write",
    "sceptique": "verify",
}


def _bare_model_id(prefixed: str) -> str:
    """odyssai/or:nemotron-3-super -> or:nemotron-3-super (le provider OMP
    prefixe par namespace ; l'engine OpenAI-compatible attend l'id nu)."""
    return prefixed.split("/", 1)[1] if "/" in prefixed else prefixed


def load_roles(path: Path) -> dict:
    data = json.loads(path.read_text())
    roles = data.get("roles") or {}
    if not roles:
        raise ValueError(f"{path}: no roles in the manifest")
    return roles


def load_assignment(path: Path) -> tuple[dict, str]:
    """-> (role->pick, base_url). base_url vit sur l'objet JSON racine, PAS
    dans le sous-objet assignment — piege trouve en cablant main.py."""
    data = json.loads(path.read_text())
    assignment = data.get("assignment") or {}
    if not assignment:
        raise ValueError(f"{path}: no assignment (run compose_agents.py first)")
    base_url = data.get("base", "http://127.0.0.1:8000/v1")
    return assignment, base_url


def load_prompt(agents_dir: Path, role: str) -> str:
    p = agents_dir / f"{role}.md"
    m = FRONT_RE.match(p.read_text())
    if not m:
        raise ValueError(f"{p}: frontmatter not found")
    return m.group(2).strip()


def build_agent(role: str, roles: dict, assignment: dict, base_url: str,
                agents_dir: Path, output_type=str, tools=None) -> Agent:
    """Un Agent pydantic-ai pret a l'emploi pour `role`. `tools` (liste de
    fonctions) est fourni par l'appelant selon TOOL_GRANTS — ce module ne
    fait que le cablage modele+prompt+outils. Passe a la CONSTRUCTION
    (Agent(..., tools=[...])) plutot qu'en post-hoc : c'est le contrat
    documente du constructeur, pas un ajout apres coup."""
    if role not in roles:
        raise ValueError(f"unknown role (missing from coeos-roles.json): {role}")
    if role not in assignment:
        raise ValueError(f"role without assignment (missing from coeos-agents.json): {role}")

    a = assignment[role]
    model_id = a.get("model")
    if not model_id:
        raise ValueError(f"role {role}: no model assigned "
                          f"(not enough servable candidates for its axis pair)")

    provider = OpenAIProvider(base_url=base_url, api_key="dummy")
    model = OpenAIChatModel(_bare_model_id(model_id), provider=provider)
    prompt = load_prompt(agents_dir, role)

    # etape 6 : quand le role est branche sur le modele virtuel CoeOS, le
    # hint d'axe (1er axe du manifeste) part en x-coeos-axis — le moteur
    # route la requete sans invoquer son decideur. Sur un modele concret
    # (override), le header est ignore par le moteur : on l'envoie toujours.
    settings = DEFAULT_MODEL_SETTINGS
    axis = a.get("axis")
    if axis:
        settings = ModelSettings(**{**DEFAULT_MODEL_SETTINGS,
                                    "extra_headers": {"x-coeos-axis": axis}})

    return Agent(model, output_type=output_type, system_prompt=prompt, tools=tools or (),
                model_settings=settings)
