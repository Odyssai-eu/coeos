#!/usr/bin/env python3
"""main — le pipeline CoeOS superagent v2, sur pydantic-ai.

Port a l'identique du flow de v1 (orchestrator.py, stdlib + `omp -p` en
sous-process) : triage -> [plan] -> [grill, 1 revision max] -> executeur ->
[boucle sceptique, max_loops]. Ce qui CHANGE : la decision du triage est un
objet TYPE (models.TriageDecision), valide/retry par pydantic-ai cote appel
— plus de parsing JSON manuel, plus de "le triage a ecrit du code au lieu
du JSON" (constate sur nemotron en v1). Ce qui NE CHANGE PAS : les
planchers (apply_floors, memes regex qu'en v1) — un triage bien FORME
peut encore juger FAUX (skeptic=False sur une tache a done-check verifie
en direct sur gemma le 2026-07-15) ; le code garde le dernier mot sur la
RIGUEUR, jamais sur l'ADAPTATIVITE (plan/grill/loop restent son jugement).

Usage : python3 main.py [--agents-dir DIR] [--assignment FILE] [--roles FILE]
                        [--cwd DIR] [--max-loops N] [--json] "<tache>"
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from models import TriageDecision  # noqa: E402
from roles import build_agent, load_assignment, load_roles  # noqa: E402
from tools import make_verify_tools, make_write_tools  # noqa: E402

# Memes regex qu'orchestrator.py v1 (_DONE_SIGNALS / _WRITE_SIGNALS) —
# copiees verbatim, c'est le plancher qui a fait ses preuves.
_DONE_SIGNALS = re.compile(
    r"crit[eè]re de done|done[- ]check|doit\s+(afficher|retourner|passer|"
    r"imprimer)|assert|\btests?\b|\btester\b|python3?\s+-c|pytest|npm\s+"
    r"(test|run)|v[eé]rifie(r|z)?\s+que|expected|attendu|s'attend", re.I)
_WRITE_SIGNALS = re.compile(
    r"[eé]cri[stvr]|\bcr[eé]e[rz]?\b|fichier|impl[eé]mente|corrige|modifie|"
    r"refactor|patch|\.(py|js|jsx|ts|tsx|sh|json|ya?ml|md|html|css|swift|rs|go|c|cpp|java)\b",
    re.I)


def apply_floors(dec: dict, task: str) -> dict:
    floors = []
    if not dec["skeptic"]:
        if _DONE_SIGNALS.search(task):
            dec["skeptic"] = True
            floors.append("sceptique (critere de done detecte)")
        elif _WRITE_SIGNALS.search(task):
            dec["skeptic"] = True
            floors.append("sceptique (la tache ecrit des fichiers -> verifier)")
    if dec["skeptic"] and not dec["plan"]:
        dec["plan"] = True
        floors.append("plan (verification exigee -> plan ferme comme reference)")
    if floors:
        dec["floored"] = floors
        dec["reason"] = (dec.get("reason", "") + " | PLANCHER: " + "; ".join(floors)).strip(" |")
    return dec


def main():
    ap = argparse.ArgumentParser()
    here = Path(__file__).resolve().parent
    ap.add_argument("--agents-dir", default=str(Path.home() / ".omp/agent/agents"))
    ap.add_argument("--assignment", default=str(here.parent / "coeos-agents.json"))
    ap.add_argument("--roles", default=str(here.parent / "coeos-roles.json"))
    ap.add_argument("--cwd", default=".")
    ap.add_argument("--max-loops", type=int, default=2)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("task")
    args = ap.parse_args()

    agents_dir = Path(args.agents_dir)
    cwd = Path(args.cwd).resolve()
    roles = load_roles(Path(args.roles))
    assignment, base_url = load_assignment(Path(args.assignment))

    trace = []

    def step(role: str, prompt: str, output_type=str, tools=None):
        agent = build_agent(role, roles, assignment, base_url, agents_dir,
                            output_type=output_type, tools=tools)
        result = agent.run_sync(prompt)
        out = result.output
        trace.append({"role": role, "model": assignment[role]["model"],
                      "assignment": prompt[:200],
                      "output": (out.model_dump() if hasattr(out, "model_dump") else str(out))})
        return out

    # 1) TRIAGE — sortie TYPEE (plus de parsing regex/JSON manuel).
    decision = step("triage", args.task, output_type=TriageDecision)
    dec = apply_floors(decision.model_dump(), args.task)

    # 2) PLAN (si prescrit)
    if dec["plan"]:
        plan = step("planner", args.task)
        # 3) GRILL (si prescrit) — une revision max
        if dec["grill"]:
            objections = step("grill", f"TÂCHE:\n{args.task}\n\nPLAN À GRILLER:\n{plan}")
            if "À RÉVISER" in objections.upper() or "A REVISER" in objections.upper():
                plan = step("planner", f"TÂCHE:\n{args.task}\n\nOBJECTIONS À CORRIGER:\n{objections}")
    else:
        plan = args.task

    # 4) EXÉCUTION (+ boucle sceptique si prescrit)
    assignment_txt = f"TÂCHE:\n{args.task}\n\nPLAN À APPLIQUER:\n{plan}"
    result = step("executeur", assignment_txt, tools=make_write_tools(cwd))
    verdict = None
    loops = 0
    if dec["skeptic"]:
        while True:
            verdict = step("sceptique",
                           f"TÂCHE:\n{args.task}\n\nPLAN:\n{plan}\n\nRÉSULTAT DE L'EXÉCUTEUR:\n{result}\n\n"
                           "Lis les fichiers réels, exécute le critère de done, rends ton verdict.",
                           tools=make_verify_tools(cwd))
            up = verdict.upper()
            accepted = "ACCEPTE" in up and "REJETTE" not in up
            if accepted or not dec["loop"] or loops >= args.max_loops:
                break
            loops += 1
            result = step("executeur",
                          f"TÂCHE:\n{args.task}\n\nPLAN:\n{plan}\n\nCORRECTIONS EXIGÉES PAR LE SCEPTIQUE:\n{verdict}",
                          tools=make_write_tools(cwd))

    report = {"task": args.task, "decision": dec,
              "accepted": (verdict is None) or ("ACCEPTE" in (verdict or "").upper()
                                                and "REJETTE" not in (verdict or "").upper()),
              "loops": loops, "trace": trace}
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=1))
    else:
        print(f"[triage] {dec['complexity']} — plan={dec['plan']} grill={dec['grill']} "
              f"skeptic={dec['skeptic']} loop={dec['loop']} :: {dec['reason']}")
        for t in trace:
            print(f"[{t['role']}] ({t['model']})")
        print(f"\n[verdict] {'ACCEPTÉ' if report['accepted'] else 'REJETÉ'} "
              f"(itérations exécuteur : {loops})")
        print("\n=== RÉSULTAT ===")
        print(result)


if __name__ == "__main__":
    main()
