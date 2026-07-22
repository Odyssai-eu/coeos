#!/usr/bin/env python3
"""console/server — plan de controle du superagent CoeOS (Option A, Sophie
2026-07-15).

Ce que la console fait, et RIEN d'autre :
  1. importer la TMB-Score-Table.json (la DATA, la preuve) ;
  2. suggerer un modele par role depuis la data (paire de competences) ;
  3. laisser reattribuer chaque role a n'importe quel modele servable ;
  4. ecrire coeos-agents.json (la sortie D) que l'orchestrateur lit.

AUCUN HARDCODE : les roles viennent de coeos-roles.json, les axes de la
score-table, les modeles de /v1/models du moteur cible. Change la flotte, le
manifeste ou la table -> la console suit, sans toucher au code.

Autonome, a cote de l'orchestrateur. Reutilise compose_agents en module.

Usage : python3 console/server.py [--port 4800]
                                  [--base http://127.0.0.1:8000/v1]
Stdlib only.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
import compose_agents as ca  # noqa: E402

CFG = {
    "roles":      ROOT / "coeos-roles.json",
    "table":      ROOT / "TMB-Score-Table.json",
    "assignment": ROOT / "coeos-agents.json",
    "agents_dir": ROOT / "agents",
    "base":       os.environ.get("COEOS_ENGINE_BASE", "http://127.0.0.1:8000/v1"),
    "provider":   "odyssai",
}

_FM = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.S)


def read_json(p, default=None):
    p = Path(p)
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text())
    except Exception:
        return default


def agent_meta(role: str) -> dict:
    """tools + modele du .md (contrat OMP) — pour l'affichage seulement."""
    p = CFG["agents_dir"] / f"{role}.md"
    if not p.exists():
        return {"tools": [], "md_model": None, "has_md": False}
    m = _FM.match(p.read_text())
    fm = m.group(1) if m else ""
    tools = re.search(r"tools:\s*\[([^\]]*)\]", fm)
    tl = [t.strip().strip('"').strip("'") for t in tools.group(1).split(",")] if tools else []
    model = re.search(r'model:\s*\["([^"]+)"\]', fm)
    return {"tools": [t for t in tl if t],
            "md_model": model.group(1) if model else None, "has_md": True}


def full_id(mid: str) -> str:
    return mid if "/" in mid else f"{CFG['provider']}/{mid}"


# --- pricing OpenRouter ($/1M in/out), cache 1 h ---------------------------
PRICE_URL = "https://openrouter.ai/api/v1/models"
PRICE_TTL = 3600.0
_PRICE_CACHE = {"at": 0.0, "by_or_id": {}}


def or_pricing() -> dict:
    """or_id -> ($/1M in, $/1M out) depuis l'API publique OpenRouter.
    Echec reseau -> dernier cache (ou vide) : les prix s'affichent '—',
    on n'invente jamais un chiffre."""
    now = time.time()
    if _PRICE_CACHE["by_or_id"] and now - _PRICE_CACHE["at"] < PRICE_TTL:
        return _PRICE_CACHE["by_or_id"]
    try:
        req = urllib.request.Request(PRICE_URL,
                                     headers={"User-Agent": "coeos-console"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode())
        out = {}
        for m in data.get("data", []):
            p = m.get("pricing") or {}
            try:
                out[m["id"]] = (float(p.get("prompt") or 0) * 1e6,
                                float(p.get("completion") or 0) * 1e6)
            except (TypeError, ValueError):
                continue
        if out:
            _PRICE_CACHE.update(at=now, by_or_id=out)
    except Exception:
        pass
    return _PRICE_CACHE["by_or_id"]


# --- configs sauvees (save / load / delete) --------------------------------
# Un "settings" personnalise = un snapshot COMPLET : le modele CHOISI par
# axe (le gagnant du score-table par defaut, ou un override operateur —
# ex. forcer MiniMax sur refactoring quand il est a egalite) + la table de
# correspondance (logique -> endpoint publie sur CE moteur). Corrige
# 2026-07-17 (Sophie, apres avoir demande hier l'inverse) : les criteres
# redeviennent editables, ET l'ensemble (criteres + correspondance) devient
# sauvegardable/rechargeable comme un TMB-Settings personnalise.
_SLUG_RE = re.compile(r"[^a-z0-9._-]+")


def config_dir() -> Path:
    d = ROOT / "configs"
    d.mkdir(exist_ok=True)
    return d


def slug(name: str) -> str:
    return _SLUG_RE.sub("-", (name or "").strip().lower()).strip("-.")


def list_configs() -> list:
    out = []
    for p in sorted(config_dir().glob("*.json")):
        d = read_json(p, {}) or {}
        out.append({"name": d.get("name") or p.stem, "slug": p.stem,
                    "saved": d.get("saved", ""),
                    "n_axes": len(d.get("axes") or {}),
                    "n_mapped": sum(1 for v in (d.get("registry") or {}).values() if v)})
    return out


def save_config(body: dict) -> dict:
    name = (body.get("name") or "").strip()
    s = slug(name)
    if not s:
        return {"error": "missing config name"}
    axes = body.get("axes") or {}
    registry = body.get("registry") or {}
    if not axes and not registry:
        return {"error": "nothing to save"}
    doc = {"format": "coeos-settings/1", "name": name,
           "saved": datetime.now().isoformat(timespec="seconds"),
           "provider": CFG["provider"], "base": CFG["base"],
           "forecast": body.get("forecast") or {}, "axes": axes, "registry": registry}
    (config_dir() / f"{s}.json").write_text(
        json.dumps(doc, ensure_ascii=False, indent=1))
    return {"ok": True, "slug": s, "configs": list_configs()}


def load_config(body: dict) -> dict:
    s = slug(body.get("slug") or body.get("name") or "")
    p = config_dir() / f"{s}.json"
    if not p.exists():
        return {"error": f"unknown config: {s or '(empty)'}"}
    return read_json(p, {"error": "unreadable file"})


def delete_config(body: dict) -> dict:
    s = slug(body.get("slug") or body.get("name") or "")
    p = config_dir() / f"{s}.json"
    if not p.exists():
        return {"error": f"unknown config: {s or '(empty)'}"}
    p.unlink()
    return {"ok": True, "configs": list_configs()}


# --- push des criteres vers le moteur (PUT /admin/coeos) --------------------
def _engine_root() -> str:
    return re.sub(r"/v1/?$", "", CFG["base"].rstrip("/"))


def _http_json(method: str, url: str, payload=None, timeout: int = 20):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"User-Agent": "coeos-console",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def push_engine(body: dict) -> dict:
    """Ecrit les bindings axe->LOGIQUE + la table de correspondance
    (logique -> endpoint publie) dans la config CoeOS du moteur (PUT
    /admin/coeos). Correction 2026-07-17 (Sophie, apres un incident live) :
    la version precedente ecrivait l'ALIAS VOLATIL directement dans
    `axes[].model` — pas de distinction entre "quel modele on veut" (le
    gagnant du critere, stable) et "comment le joindre maintenant"
    (l'alias, qui bouge). Desormais `axes[].model` porte le LOGIQUE
    (compose_agents.logical_id : or_id, stable) et `models` est la table de
    correspondance (registry) que l'operateur edite quand un alias change.
    Le moteur sait deja resoudre logique->endpoint via ce registry
    (_coeos_resolve_endpoint, api.py) — cette fonction alimentait juste le
    mauvais champ."""
    axes_in = body.get("axes") or {}
    registry_in = body.get("registry") or {}
    if not axes_in:
        return {"error": "no axes to push"}
    root = _engine_root()
    try:
        cur = _http_json("GET", root + "/admin/coeos") or {}
    except Exception as e:
        return {"error": f"engine unreachable ({root}): {e}"}
    st_axes = (cur.get("score_table") or {}).get("axes") or {}
    prov = CFG["provider"] + "/"
    # politique thinking/effort déjà posée dans le moteur, par axe — pour la
    # PRÉSERVER quand l'UI ne l'envoie pas (un push de bindings ne doit pas
    # effacer la politique thinking par axe).
    cur_pol = {a.get("key"): a for a in (cur.get("axes") or []) if isinstance(a, dict) and a.get("key")}
    axes_list = []
    for key, a in axes_in.items():
        logical = (a or {}).get("logical") or ""
        if not logical:
            continue
        meta = st_axes.get(key) if isinstance(st_axes.get(key), dict) else {}
        entry = {"key": key,
                 "label": (a or {}).get("label") or meta.get("label") or key,
                 "model": logical}
        if meta.get("description"):
            entry["description"] = meta["description"]
        # thinking/effort par axe : valeur envoyée par l'UI sinon celle déjà
        # dans le moteur (preserve). `thinking` absent → pas de clé (le resolver
        # tombe alors sur le défaut serveur pour cet axe).
        prev = cur_pol.get(key) or {}
        think = (a or {}).get("thinking", prev.get("thinking"))
        eff = (a or {}).get("reasoning_effort", prev.get("reasoning_effort"))
        if think is not None:
            entry["thinking"] = bool(think)
        if eff:
            entry["reasoning_effort"] = str(eff)
        axes_list.append(entry)
    if not axes_list:
        return {"error": "no model assigned in the axes"}
    keys = [e["key"] for e in axes_list]
    default_axis = cur.get("default_axis") or (
        "code_general" if "code_general" in keys else keys[0])

    models_registry = {}
    for logical, endpoint in registry_in.items():
        if not endpoint:
            continue
        bare = endpoint[len(prov):] if endpoint.startswith(prov) else endpoint
        models_registry[logical] = {"name": logical, "endpoint": bare}

    payload = {"name": body.get("name") or f"CoeOS Console — {len(axes_list)} axes",
               "updated": (cur.get("score_table") or {}).get("updated")
                          or datetime.now().date().isoformat(),
               "axes": axes_list, "default_axis": default_axis,
               "models": models_registry}
    try:
        _http_json("PUT", root + "/admin/coeos", payload)
        after = _http_json("GET", root + "/admin/coeos") or {}
    except Exception as e:
        return {"error": f"PUT /admin/coeos failed: {e}"}
    _STATUS_CACHE.clear()   # bindings/mappings changed — old status is stale
    return {"ok": True, "engine": root,
            "n_axes": len(after.get("axes") or []),
            "n_registry": len(after.get("models") or {}),
            "default_axis": after.get("default_axis"),
            "router": ca.router_id(CFG["base"])}


# --- statut reel du registry (pas juste "liste dans /v1/models") -----------
# 2026-07-16 : MI:Minimax2.7 se declarait loaded/warm/ready dans /v1/models
# alors que l'appel reel echouait (400 unknown model 'minimax-2.7', mapping
# upstream casse cote moteur). "Present dans la liste" != "repond vraiment".
_STATUS_CACHE = {}   # endpoint -> {"status", "detail", "checked_at"}


def check_endpoint(endpoint: str) -> dict:
    root = _engine_root()
    prov = CFG["provider"] + "/"
    bare = endpoint[len(prov):] if endpoint.startswith(prov) else endpoint
    payload = {"model": bare, "max_tokens": 1, "stream": False,
              "messages": [{"role": "user", "content": "ping"}]}
    try:
        _http_json("POST", root + "/v1/chat/completions", payload, timeout=30)
        result = {"status": "online", "detail": ""}
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:200] if hasattr(e, "read") else str(e)
        result = {"status": "failed", "detail": f"HTTP {e.code}: {detail}"}
    except Exception as e:
        result = {"status": "failed", "detail": f"{type(e).__name__}: {e}"}
    result["checked_at"] = datetime.now().isoformat(timespec="seconds")
    _STATUS_CACHE[endpoint] = result
    return result


def check_registry(body: dict) -> dict:
    """Un appel d'inference REEL et minimal (max_tokens=1) par endpoint
    distinct — jamais une simple presence dans /v1/models. Cache en
    memoire (build_state le lit sans re-sonder a chaque poll) ; cette
    fonction FORCE un nouveau sondage. Dedoublonne : deux logiques qui
    partagent le meme endpoint ne paient qu'un seul appel."""
    endpoints = sorted({e for e in (body.get("endpoints") or []) if e})
    if not endpoints:
        return {"error": "no endpoint to check"}
    out = {}
    for ep in endpoints:
        out[ep] = check_endpoint(ep)
    return {"checked": out}


def build_state() -> dict:
    roles = ca.load_roles(CFG["roles"])
    table = read_json(CFG["table"])
    asg_file = read_json(CFG["assignment"], {}) or {}
    engine_error, entries = None, []
    try:
        entries = ca.model_entries(CFG["base"])
    except Exception as e:
        engine_error = f"{type(e).__name__}: {e}"
    ids = [m["id"] for m in entries if m.get("id")]
    router = ca.entries_router(entries)
    routable = ca.filter_routable(entries)
    joined, unjoined = ({}, [])
    if table and routable:
        joined, unjoined = ca.join(table, routable, meta=ca.entry_meta(entries))

    def enrich(c, scored=True):
        c = dict(c)
        c["full"] = full_id(c["id"])
        c["scored"] = scored
        return c

    # tout modele ROUTABLE est ATTRIBUABLE (point 2 Sophie) ; seuls les scores
    # alimentent la SUGGESTION (point 3). Un modele hors score-table (ex. gemma
    # local, pris comme triage) reste selectionnable, juste pas suggere.
    # Routeur et proxys coeos exclus par metadonnee (filter_routable).
    servable = routable
    tmodels0 = (table or {}).get("models") or {}

    def row_logical(row):
        m = tmodels0.get(row)
        return ca.logical_id(row, m) if isinstance(m, dict) else None

    # flat list pour le picker de la table de correspondance (n'importe
    # quel endpoint publie, pas scope a un axe/role precis). `logical`
    # permet au client de reconnaitre qu'un id publie EST le meme modele
    # qu'une entree de correspondance deja affichee sous un AUTRE nom de
    # ligne bench (plusieurs lignes peuvent partager un or_id — ex.
    # "CoeOS"/"Coeos-agent-01"/"CoeOS-SE" pointent toutes nex-agi/nex-n2-pro
    # — sinon le picker affiche un nom de ligne incoherent avec celui du
    # critere qu'on est en train de mapper. Corrige 2026-07-17, Sophie :
    # "nex-n2-pro qui est identifie comme coeos et pas nex-n2-pro").
    servable_out = [{"id": m, "full": full_id(m), "row": joined.get(m),
                     "logical": row_logical(joined.get(m)) if joined.get(m) else None}
                    for m in sorted(servable)]

    # criteres : classement complet par axe + prix $/1M (locaux = 0,
    # cloud via or_id -> OpenRouter, inconnu -> None jamais invente)
    prices = or_pricing() if table else {}
    tmodels = (table or {}).get("models") or {}

    def row_price(row):
        m = tmodels.get(row) or {}
        if m.get("kind") == "local":
            return (0.0, 0.0)
        return prices.get(m.get("or_id") or "", (None, None))

    raw_axis_table = ca.axis_table(table, joined) if table else []
    axis_out = []
    for ax in raw_axis_table:
        cands, seen = [], set()
        for c in ax["candidates"]:
            c = dict(c)
            c["full"] = full_id(c["id"]) if c["id"] else None
            c["scored"] = True
            c["price_in"], c["price_out"] = row_price(c["row"])
            tm = tmodels.get(c["row"]) if isinstance(tmodels.get(c["row"]), dict) else {}
            c["token_burner"] = bool(tm.get("token_burner"))
            c["verbose_benches"] = tm.get("verbose_benches") or []
            if c["id"]:
                seen.add(c["id"])
            cands.append(c)
        for m in servable:                       # non-scores : attribuables
            if m in seen:
                continue
            row = joined.get(m)
            pi, po = row_price(row) if row else (None, None)
            tm = tmodels.get(row) if isinstance(tmodels.get(row), dict) else {}
            cands.append({"id": m, "full": full_id(m), "row": row,
                          "scored": False, "score": None, "verified": False,
                          "tps": None, "cost": None, "logical": None,
                          "price_in": pi, "price_out": po,
                          "token_burner": bool(tm.get("token_burner")),
                          "verbose_benches": tm.get("verbose_benches") or []})
        scored = [c for c in cands if c["scored"]]
        axis_out.append({"key": ax["key"], "label": ax["label"],
                         "candidates": cands, "n_scored": ax["n_scored"],
                         "best": scored[0] if scored else None,
                         "best_servable": next((c for c in scored if c["id"]), None)})

    # table de correspondance : logique (OR path, stable) -> endpoint publie
    # (volatil, editable). Priorite : mapping enregistre cote moteur > la
    # premiere estimation servable. Statut = dernier sondage reel en cache
    # (jamais deduit de la simple presence dans /v1/models — 2026-07-16).
    engine_cfg = {}
    if table and joined:
        try:
            engine_cfg = _http_json("GET", _engine_root() + "/admin/coeos") or {}
        except Exception:
            engine_cfg = {}
    engine_registry = engine_cfg.get("models") or {}
    # politique thinking/effort par axe (lue du moteur) → l'UI l'affiche/l'édite
    engine_axis_pol = {a.get("key"): a for a in (engine_cfg.get("axes") or [])
                       if isinstance(a, dict) and a.get("key")}
    for ax in axis_out:
        pol = engine_axis_pol.get(ax["key"]) or {}
        ax["thinking"] = pol.get("thinking")
        ax["reasoning_effort"] = pol.get("reasoning_effort")
    registry_out = []
    for row in (ca.registry_rows(raw_axis_table, joined) if table else []):
        logical = row["logical"]
        saved = engine_registry.get(logical) if isinstance(engine_registry.get(logical), dict) else None
        mapped = bool(saved and saved.get("endpoint"))
        bare = (saved.get("endpoint") if mapped else row.get("default_endpoint")) or ""
        endpoint = full_id(bare) if bare else ""
        st = _STATUS_CACHE.get(endpoint) if endpoint else None
        # pas d'endpoint du tout (aucun candidat live pour ce logique en ce
        # moment, ex. l'alias a disparu de la flotte) -> "unmapped", jamais
        # confondu avec "unknown" (= pas encore sonde) : celui-ci est
        # actionnable tout de suite, l'autre attend un clic Check.
        status = "unmapped" if not endpoint else (st or {}).get("status", "unknown")
        registry_out.append({
            "logical": logical, "row": row["row"], "endpoint": endpoint,
            "mapped": mapped,
            "status": status,
            "detail": (st or {}).get("detail", ""),
            "checked_at": (st or {}).get("checked_at", ""),
        })
    decider_current = engine_cfg.get("decider_model") or ""
    n_total = len(registry_out)
    n_failed = sum(1 for r in registry_out if r["status"] in ("failed", "unmapped"))
    n_online = sum(1 for r in registry_out if r["status"] == "online")
    coeos_status = ("failed" if n_failed else
                    "online" if n_total and n_online == n_total else "unknown")

    roles_out = {}
    for role, spec in roles.items():
        ranked = ca.role_ranking(table, joined, spec) if (table and joined) else []
        scored_ids = {c["id"] for c in ranked}
        cands = [enrich(c, True) for c in ranked]
        for m in servable:                       # non-scores : attribuables, non classes
            if m in scored_ids:
                continue
            cands.append({"id": m, "full": full_id(m), "scored": False,
                          "row": joined.get(m), "quality": None, "speed": None,
                          "composite": None, "cost": None, "tps": None})
        meta = agent_meta(role)
        roles_out[role] = {
            "label": spec.get("label", role), "axes": spec.get("axes", []),
            "speed_weight": spec.get("speed_weight", 0.0),
            "stage": spec.get("stage", ""), "writes": spec.get("writes", False),
            "note": spec.get("note", ""), "tools": meta["tools"],
            "md_model": meta["md_model"], "has_md": meta["has_md"],
            "candidates": cands, "suggested": cands[0] if ranked else None,
        }
    st_meta = None
    if table:
        st_meta = {"updated": table.get("updated", ""),
                   "source": table.get("source", ""),
                   "n_models": len(table.get("models") or {}),
                   "n_axes": len(table.get("axes") or {}),
                   "n_joined": len(joined), "unjoined": unjoined}
    return {"provider": CFG["provider"], "base": CFG["base"],
            "engine_error": engine_error, "n_servable": len(ids),
            "router": router,
            "score_table": st_meta, "axis_table": axis_out,
            "registry": registry_out, "servable": servable_out,
            # brut (logique -> {name, endpoint} tel que sauve cote moteur) :
            # le client en a besoin pour resoudre la correspondance d'un
            # logique OVERRIDDEN par l'operateur (2026-07-17, Sophie : "dans
            # les 18 axes je puisse modifier le modele attribue") — un axe
            # peut pointer vers un logique absent de `registry_out` (qui ne
            # couvre que les gagnants par defaut), le client recalcule alors
            # la table de correspondance lui-meme a partir de ce dict.
            "engine_registry": engine_registry,
            # cache complet (toutes les entrees sondees, pas seulement celles
            # que le mapping persiste au moteur reflete en ce moment) — le
            # client en a besoin pour afficher le statut de l'endpoint QU'IL
            # A CHOISI dans le picker, avant tout Push (2026-07-17, Sophie :
            # "il ne veut pas le mapper" — Check verifiait le bon endpoint,
            # mais la pastille relisait l'ancien mapping non pousse).
            "status_cache": _STATUS_CACHE,
            "coeos_status": {"status": coeos_status, "n_online": n_online,
                             "n_failed": n_failed, "n_total": n_total},
            "configs": list_configs(), "roles": roles_out,
            "decider": decider_current,
            "assignment": asg_file.get("assignment") or {},
            "assignment_updated": asg_file.get("updated", "")}


# --- decider (classifieur d'axe du moteur) : GET via build_state, SET ici ---
def set_decider(body: dict) -> dict:
    """Ecrit `decider_model` dans la config CoeOS du moteur (PUT /admin/coeos).
    Le decider est le modele que le moteur appelle pour classer chaque requete
    dans un axe. Depuis engine 1.17.2 il peut etre local OU cloud/OR (branche
    de dispatch cloud ajoutee dans _coeos_llm_classify). Vide = pas de decider
    -> chaque requete tombe sur default_axis."""
    model = (body.get("model") or "").strip()
    root = _engine_root()
    try:
        cur = _http_json("GET", root + "/admin/coeos") or {}
    except Exception as e:
        return {"error": f"engine unreachable ({root}): {e}"}
    cur["decider_model"] = model
    try:
        _http_json("PUT", root + "/admin/coeos", cur)
        after = _http_json("GET", root + "/admin/coeos") or {}
    except Exception as e:
        return {"error": f"PUT /admin/coeos failed: {e}"}
    return {"ok": True, "decider": after.get("decider_model") or ""}


def engine_decisions() -> dict:
    """Compteurs de routage reels du moteur (model x axe x fallback), + le
    binding configure de chaque axe pour reperer les ecarts. Agrege, pas un
    journal par requete (GET /admin/coeos/decisions)."""
    root = _engine_root()
    try:
        dec = _http_json("GET", root + "/admin/coeos/decisions") or {}
        cfg = _http_json("GET", root + "/admin/coeos") or {}
    except Exception as e:
        return {"error": f"engine unreachable ({root}): {e}"}
    bindings = {a.get("key"): a.get("model")
                for a in (cfg.get("axes") or []) if a.get("key")}
    return {"decisions": dec.get("decisions") or [], "bindings": bindings,
            "default_axis": cfg.get("default_axis"),
            "decider": cfg.get("decider_model") or ""}


def save_table(raw: bytes) -> dict:
    data = json.loads(raw)
    if isinstance(data, dict) and "score_table" in data and "models" not in data:
        data = data["score_table"]                 # import enveloppe
    if not (isinstance(data, dict) and "models" in data and "axes" in data):
        return {"error": "not a TMB-Score-Table (expects an object with axes + models)"}
    Path(CFG["table"]).write_text(json.dumps(data, ensure_ascii=False, indent=1))
    return {"ok": True, "n_models": len(data["models"]), "n_axes": len(data["axes"])}


def save_assignment(overrides: dict) -> dict:
    roles = ca.load_roles(CFG["roles"])
    table = read_json(CFG["table"])
    if not table:
        return {"error": "no score-table imported — import the data first"}
    try:
        entries = ca.model_entries(CFG["base"])
    except Exception as e:
        return {"error": f"engine unreachable ({CFG['base']}): {e}"}
    joined, _ = ca.join(table, ca.filter_routable(entries), meta=ca.entry_meta(entries))
    picks = ca.compose(table, joined, roles)
    router = ca.entries_router(entries)
    # ne garde que les overrides reels (differents de la suggestion ET du
    # routeur — choisir le routeur n'est pas un override, c'est le defaut)
    clean = {}
    for role, chosen in (overrides or {}).items():
        if not chosen:
            continue
        sug = picks.get(role)
        sug_full = full_id(sug["id"]) if sug else None
        router_full = full_id(router) if router else None
        if full_id(chosen) not in (sug_full, router_full):
            clean[role] = chosen
    asg = ca.build_assignment(picks, roles, CFG["provider"], CFG["base"],
                              overrides=clean, updated=table.get("updated", ""),
                              router=router)
    Path(CFG["assignment"]).write_text(json.dumps(asg, ensure_ascii=False, indent=1))
    return asg


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False)
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            html = (HERE / "index.html").read_text()
            return self._send(200, html, "text/html; charset=utf-8")
        if self.path == "/api/state":
            try:
                return self._send(200, build_state())
            except Exception as e:
                return self._send(500, {"error": f"{type(e).__name__}: {e}"})
        if self.path == "/api/engine/decisions":
            try:
                return self._send(200, engine_decisions())
            except Exception as e:
                return self._send(500, {"error": f"{type(e).__name__}: {e}"})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        try:
            if self.path == "/api/score-table":
                return self._send(200, save_table(raw))
            if self.path == "/api/assign":
                body = json.loads(raw or b"{}")
                return self._send(200, save_assignment(body.get("overrides") or {}))
            if self.path == "/api/configs/save":
                return self._send(200, save_config(json.loads(raw or b"{}")))
            if self.path == "/api/configs/load":
                return self._send(200, load_config(json.loads(raw or b"{}")))
            if self.path == "/api/configs/delete":
                return self._send(200, delete_config(json.loads(raw or b"{}")))
            if self.path == "/api/engine/push":
                return self._send(200, push_engine(json.loads(raw or b"{}")))
            if self.path == "/api/engine/decider":
                return self._send(200, set_decider(json.loads(raw or b"{}")))
            if self.path == "/api/registry/check":
                return self._send(200, check_registry(json.loads(raw or b"{}")))
            return self._send(404, {"error": "not found"})
        except Exception as e:
            return self._send(400, {"error": f"{type(e).__name__}: {e}"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4800)
    ap.add_argument("--base", default=CFG["base"])
    ap.add_argument("--provider", default=CFG["provider"])
    ap.add_argument("--agents-dir", default=str(CFG["agents_dir"]),
                    help="repertoire des .md (contrat OMP) — sur .21 : ~/.omp/agent/agents")
    args = ap.parse_args()
    CFG["base"], CFG["provider"] = args.base, args.provider
    CFG["agents_dir"] = Path(args.agents_dir).expanduser()
    srv = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print(f"CoeOS console -> http://0.0.0.0:{args.port}  (moteur {CFG['base']})")
    srv.serve_forever()


if __name__ == "__main__":
    main()
