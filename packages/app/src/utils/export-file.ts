// coeos-nemo — export/téléchargement d'un contenu texte en fichier local, côté
// renderer (pas d'IPC, pas de serveur — pattern [client-pur] de Companion
// file-export.ts). Déclenche le dialogue de sauvegarde du navigateur/Electron.
export function saveTextAsFile(filename: string, text: string, mime = "text/markdown;charset=utf-8") {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// Nom de fichier sûr à partir d'un chemin ou d'un titre. Force l'extension .md.
export function mdFilename(input: string | undefined, fallback = "document"): string {
  const base = (input ?? "").split("/").pop()?.trim() || fallback
  const noExt = base.replace(/\.[^.]+$/, "")
  const safe = noExt.replace(/[^\w.\- ]+/g, "-").replace(/\s+/g, " ").trim() || fallback
  return `${safe}.md`
}
