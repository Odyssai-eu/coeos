#!/usr/bin/env python3
"""compose_agents — designe le modele de chaque role du superagent CoeOS
depuis la DATA (TMB-Score-Table) et les modeles SERVABLES du moteur cible.

« les modeles, c'est accessoire, on a tout ce qu'il faut pour les designer »
(Sophie, 2026-07-14) : chaque role route sur une PAIRE de competences —
l'intersection ne sature pas, contrairement aux axes seuls. L'executeur
pondere la vitesse (haute frequence d'appel), le planner/loop la qualite
pure (basse frequence).

AUCUN HARDCODE (2026-07-15) : les roles + leurs paires + poids vitesse vivent
dans `coeos-roles.json` (manifeste), pas dans ce fichier. Ajouter un role =
une entree JSON. La logique de suggestion est ici ; la definition du pipeline
est une donnee.

Ce module est IMPORTABLE (le serveur console reutilise load_roles/join/compose/
suggest). En CLI il ecrit `coeos-agents.json` (l'affectation) et, en option,
patche les lignes `model:` des .md.

Usage :
  python3 compose_agents.py [--roles coeos-roles.json] [--table TMB-Score-Table.json]
                            [--base http://127.0.0.1:8000/v1]
                            [--emit coeos-agents.json] [--patch-md] [--dry-run]

Stdlib only.
"""
import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

_NORM_RE = re.compile(r"[^a-z0-9]+")


def norm(s: str) -> str:
    return _NORM_RE.sub("", (s or "").lower())


def load_roles(path) -> dict:
    """Manifeste des roles -> {role: {axes, speed_weight, ...}}. La SEULE
    source de la forme du pipeline (plus de dict hardcode)."""
    data = json.loads(Path(path).read_text())
    roles = data.get("roles") or {}
    if not roles:
        raise ValueError(f"{path}: no roles in the manifest")
    return roles


def model_entries(base: str, timeout: int = 15) -> list:
    """Les entrees completes de /v1/models (id + x_odyssai)."""
    req = urllib.request.Request(base.rstrip("/") + "/models",
                                 headers={"User-Agent": "coeos-compose"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read().decode())
    return data.get("data", [])


def servable_ids(base: str, timeout: int = 15) -> list:
    return [m["id"] for m in model_entries(base, timeout) if m.get("id")]


def filter_routable(entries: list) -> list:
    """Ids candidats au routage : tout id publie SAUF le routeur lui-meme
    et les proxys dont l'upstream est coeos (boucle de routage). Filtre par
    METADONNEE (kind/upstream), jamais par nom — un id qui ressemble
    ('CoeOS SE') peut etre un tout autre projet."""
    out = []
    for m in entries:
        xo = m.get("x_odyssai") or {}
        if xo.get("kind") == "router" or xo.get("upstream") == "coeos":
            continue
        if m.get("id"):
            out.append(m["id"])
    return out


def entry_meta(entries: list) -> dict:
    """id -> {kind, upstream} depuis la METADONNEE /v1/models — le carburant
    des etages forts de join(). `kind` : owned_by 'odyssai-cloud-*' = alias
    cloud, sinon local (pool jaccl/mlx OU proxy Telemak — les deux servent
    du local). `upstream` : pour un alias cloud c'est l'id CANONIQUE du
    provider ('nex-agi/nex-n2-pro') — exactement ce que la table porte en
    or_id/served_model ; pour Telemak c'est une URL http (inutilisable en
    jointure, filtree)."""
    out = {}
    for m in entries:
        if not m.get("id"):
            continue
        xo = m.get("x_odyssai") or {}
        up = xo.get("upstream") or ""
        out[m["id"]] = {
            "kind": "cloud" if str(m.get("owned_by") or "").startswith("odyssai-cloud-") else "local",
            "upstream": up if up and not up.startswith("http") else "",
        }
    return out


def entries_router(entries: list):
    """L'id du modele virtuel CoeOS parmi des entrees /v1/models : l'entree
    de kind 'router', SEUL critere (pas de fallback par nom). None si le
    moteur n'expose pas de routeur (CoeOS desactive)."""
    for m in entries:
        if ((m.get("x_odyssai") or {}).get("kind")) == "router":
            return m.get("id")
    return None


def router_id(base: str, timeout: int = 15):
    try:
        return entries_router(model_entries(base, timeout))
    except Exception:
        return None


_TOKEN_RE = re.compile(r"[a-z]+|\d+")


def _tokens(s: str) -> set:
    return {t for t in _TOKEN_RE.findall((s or "").lower()) if len(t) >= 2}


def join(table: dict, ids: list, meta: dict = None):
    """id servable -> nom de ligne de la table. Etages, du plus sur au plus
    flou (on ne descend que si l'etage au-dessus n'a rien donne) :
    0. UPSTREAM (metadonnee /v1/models) <-> or_id/served_model/alias de la
       ligne — l'id CANONIQUE du provider des deux cotes, zero devinette
       de nom. C'est l'etage qui resout les collisions reelles : plusieurs
       lignes peuvent partager un or_id ("CoeOS"/"Coeos-agent-01"/"Nex N2
       pro OR" pointent toutes nex-agi/nex-n2-pro — le routeur a route la
       pendant CES runs), et un nom d'alias peut matcher exactement la
       MAUVAISE ligne (XI:Mimo v2.5 pro ~ ligne locale "mimo V2.5 pro"
       alors que c'est le provider cloud XI -> ligne "mimo2.5 XI").
    1. containment bidirectionnel des cles normalisees (nom de ligne fort,
       alias/or_id/served_model faibles) — le nommage operateur (or:Hy3)
       ne matche jamais verbatim le nom de bench (Hy3 - OR) ;
    2. recouvrement de tokens (or15:devstral2-2512 vs devstral-2512),
       >=80% du poids du candidat, token alpha discriminant >=4, sans
       ambiguite.
    A chaque etage, prefere une ligne du MEME kind que l'id (cloud alias
    -> ligne cloud, pool/proxy local -> ligne locale) — metadonnee contre
    metadonnee, jamais un filtre par nom (regle CoeOS-SE, 2026-07-16).
    Les non-joints sont RAPPORTES, jamais silencieux."""
    meta = meta or {}
    rows, row_tokens, row_kind = {}, {}, {}
    for name, m in (table.get("models") or {}).items():
        if not isinstance(m, dict):
            continue
        strong = {norm(name)} if name else set()
        weak = {norm(k) for k in (m.get("alias"), m.get("or_id"), m.get("served_model")) if k}
        rows[name] = (strong, weak - strong)
        row_kind[name] = m.get("kind") or ""
        vals = [name, m.get("alias"), m.get("or_id"), m.get("served_model")]
        row_tokens[name] = set().union(*(_tokens(k) for k in vals if k)) if any(vals) else set()
    out, unjoined = {}, []
    # le filtrage routeur/proxys-coeos est fait EN AMONT par filter_routable
    # (metadonnees /v1/models) — pas de filtre par nom ici.
    for mid in ids:
        mk = (meta.get(mid) or {}).get("kind") or ""
        upstream = norm((meta.get(mid) or {}).get("upstream") or "")

        def mismatch(name):
            rk = row_kind.get(name) or ""
            return 1 if (mk and rk and mk != rk) else 0

        # best = (tier, kind_mismatch, is_weak, -score, name) — minimise
        best = None

        def consider(cand):
            nonlocal best
            if best is None or cand[:4] < best[:4]:
                best = cand

        # --- etage 0 : upstream canonique <-> cles de la ligne
        if upstream and len(upstream) >= 3:
            for name, (strong, weak) in rows.items():
                for k in strong | weak:
                    if len(k) < 3:
                        continue
                    if k in upstream or upstream in k:
                        consider((0, mismatch(name), 0, -min(len(k), len(upstream)), name))
        # --- etage 1 : containment sur les noms (nom propre fort, meta faible)
        if best is None:
            # l'alias operateur prefixe souvent le provider (or:Hy3, XI:Mimo…) :
            # on joint sur le nom NU (apres le dernier ':') ET sur l'id complet.
            bare = norm(mid.split(":")[-1])
            full = norm(mid)
            for name, (strong, weak) in rows.items():
                for is_weak, keys in ((0, strong), (1, weak)):
                    for k in keys:
                        if len(k) < 3:
                            continue
                        for n in (bare, full):
                            if n and (k in n or n in k):
                                # prefere le match le plus long (evite hy3 ~ hy3-mini)
                                consider((1, mismatch(name), is_weak,
                                          -min(len(k), len(n)), name))
        # --- etage 2 : recouvrement de tokens
        if best is None:
            cand = _tokens(mid.split(":")[-1])
            cw = sum(len(t) for t in cand)
            top = second = 0
            top_name = None
            for name, toks in row_tokens.items():
                shared = cand & toks
                w = sum(len(t) for t in shared)
                if not any(t.isalpha() and len(t) >= 4 for t in shared):
                    continue
                if w > top:
                    top, second, top_name = w, top, name
                elif w == top:
                    second = w
            if top_name and cw and top / cw >= 0.8 and top != second:
                best = (2, 0, 0, -top, top_name)
        if best:
            out[mid] = best[4]
        else:
            unjoined.append(mid)
    return out, unjoined


def role_ranking(table: dict, joined: dict, spec: dict) -> list:
    """Classe TOUS les candidats joignables pour un role (paire d'axes +
    poids vitesse). Retourne une liste triee (meilleur d'abord) de dicts —
    le serveur s'en sert pour le menu deroulant + la suggestion (le 1er)."""
    models = table.get("models") or {}
    tps = {mid: (models[row].get("tps_median") or 0.0)
           for mid, row in joined.items()}
    tmax = max(tps.values()) if tps else 1.0
    w = spec.get("speed_weight", 0.0)
    axes = spec.get("axes") or []
    ranked = []
    for mid, row in joined.items():
        m = models[row]
        if (m.get("role") or "contender") != "contender":
            continue
        vals = [((m.get("axes") or {}).get(a) or {}).get("score") for a in axes]
        vals = [v for v in vals if v is not None]
        if not vals:
            continue
        quality = sum(vals) / len(vals)
        speed = 100.0 * (tps[mid] / tmax) if tmax else 0.0
        composite = quality * (1 - w) + speed * w
        cost = m.get("cost_per_test")
        ranked.append({
            "id": mid, "row": row,
            "quality": round(quality, 1), "speed": round(speed, 1),
            "composite": round(composite, 1), "cost": cost,
            "tps": m.get("tps_median"),
            "n_axes": len(vals), "axes": axes, "speed_weight": w,
        })
    # tri : composite desc, puis cout croissant (None en dernier), puis id
    ranked.sort(key=lambda r: (-r["composite"], r["cost"] is None,
                               r["cost"] or 0.0, r["id"]))
    return ranked


def logical_id(row_name: str, row: dict) -> str:
    """Stable identity for a bench row, independent of any engine's CURRENT
    serving alias. The operator-facing "OR path" Sophie asked for
    (2026-07-16, after a live incident where axis bindings held a volatile
    alias directly with no way to tell 'wrong winner' from 'right winner,
    dead alias'): the canonical OpenRouter id (`or_id`, e.g.
    'z-ai/glm-5.2') when known, else `served_model`, else a normalized slug
    of the row name. This is what a CORRESPONDENCE TABLE keys on — engines
    come and go, this doesn't."""
    return row.get("or_id") or row.get("served_model") or norm(row_name) or row_name


def axis_table(table: dict, joined: dict) -> list:
    """Une ligne par axe de la score-table : le meilleur modele de la TABLE
    ENTIERE (pas seulement la flotte), son score, sa vitesse brute, et s'il
    est servable maintenant. Doctrine not-loaded : le meilleur absolu
    s'affiche meme froid (jamais de fallback silencieux) ; le meilleur
    SERVABLE est donne a cote quand il differe. `candidates` = le
    classement complet de l'axe — utilise pour construire la table de
    correspondance (registry), PAS pour un picker direct sur cet axe (la
    query score-table decide seule le gagnant ; l'operateur ne choisit que
    COMMENT on le joint, via `logical`)."""
    models = table.get("models") or {}
    axes = table.get("axes") or {}
    # ALL servable ids per row — a fleet can publish the same benched model
    # under several aliases (hy3 local + or01:hy3); each one carries the
    # row's scores (fixed 2026-07-16: first-id-only left or01:hy3 unscored)
    row_ids = {}
    for mid, row in sorted(joined.items()):
        row_ids.setdefault(row, []).append(mid)
    out = []
    for key, label in axes.items():
        lab = label if isinstance(label, str) else (label or {}).get("label") or key
        ranked = []
        for name, m in models.items():
            # etalons (reference) ET lignes CoeOS (self) exclus : les
            # settings sont ce que CoeOS appelle — une ligne CoeOS en
            # candidat = boucle, et elle gagnerait partout (~100, elle
            # route vers le meilleur). Sophie 2026-07-17.
            if not isinstance(m, dict) or (m.get("role") or "contender") != "contender":
                continue
            cell = (m.get("axes") or {}).get(key) or {}
            if cell.get("score") is None:
                continue
            logical = logical_id(name, m)
            for mid in (row_ids.get(name) or [None]):
                ranked.append({
                    "row": name, "score": cell["score"],
                    "verified": bool(cell.get("verified")),
                    "tps": m.get("tps_median"), "cost": m.get("cost_per_test"),
                    "id": mid, "logical": logical,
                })
        # servable at equal score first (id present), then stable name/id
        ranked.sort(key=lambda r: (-r["score"], r["id"] is None, r["row"],
                                   r["id"] or ""))
        best = ranked[0] if ranked else None
        best_servable = next((r for r in ranked if r["id"]), None)
        out.append({"key": key, "label": lab, "best": best,
                    "best_servable": best_servable, "candidates": ranked,
                    "n_scored": len(ranked)})
    return out


def registry_rows(axis_rows: list, joined: dict) -> list:
    """The CORRESPONDENCE TABLE : one row per DISTINCT logical id actually
    needed by the 18 axes' winners (dynamic — only what's used gets a row,
    same doctrine as the old Models section: 'si le json propose Macaron,
    on a un box macaron'). `default_endpoint` is a best-effort guess (the
    first currently-servable id joined to that bench row) for logicals the
    operator hasn't explicitly mapped yet — the console layer decides
    whether to use the guess or the operator's saved mapping."""
    row_ids = {}
    for mid, row in sorted(joined.items()):
        row_ids.setdefault(row, []).append(mid)
    seen = {}
    for ax in axis_rows:
        b = ax.get("best")
        if not b:
            continue
        logical = b["logical"]
        if logical in seen:
            continue
        ids = row_ids.get(b["row"]) or []
        seen[logical] = {"logical": logical, "row": b["row"],
                         "default_endpoint": ids[0] if ids else None}
    return list(seen.values())


def compose(table: dict, joined: dict, roles: dict) -> dict:
    """{role: meilleur pick} — la suggestion par defaut (tete du classement)."""
    picks = {}
    for role, spec in roles.items():
        ranked = role_ranking(table, joined, spec)
        if ranked:
            picks[role] = ranked[0]
    return picks


def build_assignment(picks: dict, roles: dict, provider: str, base: str,
                     overrides: dict = None, updated: str = "",
                     router: str = None) -> dict:
    """Sortie D (coeos-agents.json) : role -> modele choisi. Priorite :
    `overrides` (role -> id servable NU, ex. triage->gemma pour la fiabilite
    format) > `router` (etape 6 : le role appelle le modele virtuel CoeOS,
    le moteur route par requete via le hint `axis`) > suggestion composee.
    Chaque role porte `axis` (1er axe du manifeste, envoye en x-coeos-axis)
    et `axes` (la paire complete). Sans routeur publie, comportement
    inchange (modeles composes)."""
    overrides = overrides or {}
    router_full = (router if router and "/" in router
                   else (f"{provider}/{router}" if router else None))
    assignment = {}
    for role in roles:
        p = picks.get(role)
        ov = overrides.get(role)
        axes = (roles.get(role) or {}).get("axes") or []
        suggested = f"{provider}/{p['id']}" if p else None
        if ov:
            chosen = ov if "/" in ov else f"{provider}/{ov}"
            entry = {"model": chosen, "overridden": True}
        elif router_full:
            entry = {"model": router_full, "overridden": False}
        elif p:
            entry = {"model": suggested, "overridden": False}
        else:
            entry = {"model": None, "overridden": False}
        entry.update({"suggested": suggested,
                      "axis": axes[0] if axes else None, "axes": axes,
                      "row": (p or {}).get("row"),
                      "quality": (p or {}).get("quality"),
                      "speed": (p or {}).get("speed"),
                      "composite": (p or {}).get("composite"),
                      "cost": (p or {}).get("cost")})
        assignment[role] = entry
    return {"format": "coeos-agents/1", "updated": updated,
            "provider": provider, "base": base, "router": router_full,
            "assignment": assignment}


MODEL_LINE_RE = re.compile(r"^model:\s*\[.*$", re.M)


def patch_agent(path: Path, model_full: str, pick: dict, dry: bool) -> str:
    prov = ""
    if pick:
        prov = (f'  # compose: {"+".join(pick["axes"])} '
                f'(qualite {pick["quality"]}, vitesse {pick["speed"]}, '
                f'poids vitesse {pick["speed_weight"]}) -> {pick["row"]}')
    line = f'model: ["{model_full}"]{prov}'
    text = path.read_text()
    if not MODEL_LINE_RE.search(text):
        return f"SKIP {path.name}: no model: line"
    if not dry:
        path.write_text(MODEL_LINE_RE.sub(line, text, count=1))
    return f'{path.stem:<10} -> {model_full}'


def main():
    ap = argparse.ArgumentParser()
    here = Path(__file__).resolve().parent
    ap.add_argument("--roles", default=str(here / "coeos-roles.json"))
    ap.add_argument("--table", default=str(here / "TMB-Score-Table.json"))
    ap.add_argument("--base", default=os.environ.get("COEOS_ENGINE_BASE", "http://127.0.0.1:8000/v1"))
    ap.add_argument("--provider", default="odyssai")
    ap.add_argument("--agents-dir", default=str(here / "agents"))
    ap.add_argument("--emit", default=str(here / "coeos-agents.json"),
                    help="write the assignment (output D); '' to skip")
    ap.add_argument("--patch-md", action="store_true",
                    help="also patch the model: lines of the .md files (compat)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    roles = load_roles(args.roles)
    table = json.loads(Path(args.table).read_text())
    entries = model_entries(args.base)
    ids = filter_routable(entries)
    joined, unjoined = join(table, ids, meta=entry_meta(entries))
    router = entries_router(entries)

    print(f"roles: {len(roles)} | routable: {len(ids)} | joined: {len(joined)} "
          f"| unjoined: {unjoined or 'none'} | router: {router or 'none'}")
    for mid, row in sorted(joined.items()):
        print(f"  {mid:<24} -> {row}")
    if not joined:
        sys.exit("no servable model joins the table — nothing to compose")

    picks = compose(table, joined, roles)
    print()
    for role in roles:
        p = picks.get(role)
        if not p:
            print(f"{role:<10} -> NO CANDIDATE (axes {roles[role].get('axes')})")
            continue
        print(f"{role:<10} -> {args.provider}/{p['id']:<22} "
              f"({p['row']}, composite {p['composite']})")

    assignment = build_assignment(picks, roles, args.provider, args.base,
                                  updated=table.get("updated", ""),
                                  router=router)
    if args.emit and not args.dry_run:
        Path(args.emit).write_text(json.dumps(assignment, ensure_ascii=False, indent=1))
        print(f"\nassignment written -> {args.emit}")

    if args.patch_md:
        print()
        for role in roles:
            p = picks.get(role)
            if not p:
                continue
            agent = Path(args.agents_dir) / f"{role}.md"
            if agent.exists():
                print(patch_agent(agent, f"{args.provider}/{p['id']}", p, args.dry_run))
    if args.dry_run:
        print("\n(dry-run: nothing written)")


if __name__ == "__main__":
    main()
