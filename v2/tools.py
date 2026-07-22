"""tools — les 3 outils du pipeline, lies a un cwd par fermeture.

Separation structurelle identique v1 : make_write_tools() n'est appele que
pour l'executeur (roles.py TOOL_GRANTS), make_verify_tools() que pour le
sceptique. Aucun autre role ne recoit de tool -> aucun autre role ne peut
toucher au disque, quoi que dise son prompt (la garantie est dans le
cablage Python, pas dans une instruction).
"""
import subprocess
from pathlib import Path


def make_write_tools(cwd: Path):
    def write_file(path: str, content: str) -> str:
        """Ecrit `content` dans le fichier `path` (relatif au repertoire de travail),
        cree les dossiers parents si besoin. Retourne une confirmation."""
        target = (cwd / path).resolve()
        if cwd.resolve() not in target.parents and target != cwd.resolve():
            return f"REFUSE : {path} sort du repertoire de travail {cwd}"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        return f"ecrit : {target} ({len(content)} caracteres)"

    def read_file(path: str) -> str:
        """Lit le contenu du fichier `path` (relatif au repertoire de travail)."""
        target = (cwd / path).resolve()
        if not target.exists():
            return f"ABSENT : {path}"
        return target.read_text()

    def run_cmd(cmd: str, timeout: int = 120) -> str:
        """Execute `cmd` dans le repertoire de travail, retourne stdout+stderr+exit code."""
        try:
            r = subprocess.run(cmd, shell=True, cwd=str(cwd), capture_output=True,
                              text=True, timeout=timeout)
            return f"exit={r.returncode}\nstdout:\n{r.stdout[-2000:]}\nstderr:\n{r.stderr[-1000:]}"
        except subprocess.TimeoutExpired:
            return f"TIMEOUT apres {timeout}s"

    return [write_file, read_file, run_cmd]


def make_verify_tools(cwd: Path):
    """Sceptique : lecture + execution pour VERIFIER, jamais d'ecriture —
    read_file et run_cmd sont les memes fonctions que ci-dessus (meme
    contrat), simplement jamais associees a write_file pour ce role."""
    tools = make_write_tools(cwd)
    return [t for t in tools if t.__name__ != "write_file"]
