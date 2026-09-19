import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Editor, rootCtx, defaultValueCtx } from "@milkdown/kit/core"
import {
  commonmark,
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
  turnIntoTextCommand,
} from "@milkdown/kit/preset/commonmark"
import { gfm, toggleStrikethroughCommand, insertTableCommand } from "@milkdown/kit/preset/gfm"
import { history } from "@milkdown/kit/plugin/history"
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener"
import {
  diff,
  startDiffReviewCmd,
  acceptAllDiffsCmd,
  clearDiffReviewCmd,
} from "@milkdown/kit/plugin/diff"
import { diffComponent, diffComponentConfig } from "@milkdown/kit/component/diff"
import { callCommand } from "@milkdown/kit/utils"

type Item = { label: string; cmd: any; payload?: unknown; weight?: number; italic?: boolean; strike?: boolean }

// Groupes de la toolbar. Chaque bouton appelle une commande ProseMirror sur la
// sélection courante (le mousedown.preventDefault garde le focus dans l'éditeur).
const GROUPS: Item[][] = [
  [
    { label: "Text", cmd: turnIntoTextCommand },
    { label: "H1", cmd: wrapInHeadingCommand, payload: 1 },
    { label: "H2", cmd: wrapInHeadingCommand, payload: 2 },
    { label: "H3", cmd: wrapInHeadingCommand, payload: 3 },
  ],
  [
    { label: "B", cmd: toggleStrongCommand, weight: 700 },
    { label: "I", cmd: toggleEmphasisCommand, italic: true },
    { label: "S", cmd: toggleStrikethroughCommand, strike: true },
    { label: "</>", cmd: toggleInlineCodeCommand },
  ],
  [
    { label: "• List", cmd: wrapInBulletListCommand },
    { label: "1. List", cmd: wrapInOrderedListCommand },
    { label: "❝ Quote", cmd: wrapInBlockquoteCommand },
    { label: "Code", cmd: createCodeBlockCommand },
    { label: "Table", cmd: insertTableCommand },
  ],
]

// Styles de l'éditeur : couleurs sur les tokens Némo (--v2-*) — texte garanti
// visible sur le dark, pas de thème externe qui impose ses propres couleurs.
const CSS = `
.milkdown-host .milkdown { background: transparent; }
.milkdown-host .ProseMirror { outline: none; min-height: 60vh; color: var(--v2-text-text-base); font-size: 14px; line-height: 1.7; }
.milkdown-host .ProseMirror:focus { outline: none; }
.milkdown-host .ProseMirror > * + * { margin-top: 0.7em; }
.milkdown-host .ProseMirror h1 { font-size: 1.7em; font-weight: 700; line-height: 1.25; }
.milkdown-host .ProseMirror h2 { font-size: 1.4em; font-weight: 700; line-height: 1.3; }
.milkdown-host .ProseMirror h3 { font-size: 1.18em; font-weight: 600; }
.milkdown-host .ProseMirror ul { list-style: disc; padding-left: 1.4em; }
.milkdown-host .ProseMirror ol { list-style: decimal; padding-left: 1.4em; }
.milkdown-host .ProseMirror li { margin: 0.2em 0; }
.milkdown-host .ProseMirror li > * + * { margin-top: 0.3em; }
.milkdown-host .ProseMirror blockquote { border-left: 3px solid var(--v2-border-border-base); padding-left: 1em; color: var(--v2-text-text-muted); }
.milkdown-host .ProseMirror :not(pre) > code { font-family: var(--font-mono, monospace); font-size: 0.9em; background: var(--v2-background-bg-layer-02); padding: 0.1em 0.3em; border-radius: 3px; }
.milkdown-host .ProseMirror pre { background: var(--v2-background-bg-layer-02); padding: 0.8em 1em; border-radius: 6px; overflow-x: auto; font-family: var(--font-mono, monospace); font-size: 0.9em; }
.milkdown-host .ProseMirror a { color: var(--v2-text-text-link, #5b9dd9); text-decoration: underline; }
.milkdown-host .ProseMirror table { border-collapse: collapse; width: 100%; }
.milkdown-host .ProseMirror th, .milkdown-host .ProseMirror td { border: 1px solid var(--v2-border-border-muted); padding: 0.3em 0.6em; }
.milkdown-host .ProseMirror th { background: var(--v2-background-bg-layer-02); font-weight: 600; }
.milkdown-host .ProseMirror hr { border: none; border-top: 1px solid var(--v2-border-border-muted); margin: 1.2em 0; }
.milkdown-host .ProseMirror p.is-empty:first-child::before { color: var(--v2-text-text-muted); }

/* Suivi des modifications (#60). Milkdown pose les décorations mais ne livre
   AUCUNE feuille de style pour elles : sans ces règles, le suivi est invisible
   — exactement l'échec de la v1. */
.milkdown-host .milkdown-diff-added,
.milkdown-host .milkdown-diff-added-block {
  background: rgba(63, 185, 80, 0.22);
  border-radius: 2px;
}
.milkdown-host .milkdown-diff-added-block { display: block; box-shadow: -3px 0 0 0 #3fb950; padding-left: 6px; }
.milkdown-host .milkdown-diff-removed,
.milkdown-host .milkdown-diff-removed-block {
  background: rgba(248, 81, 73, 0.20);
  text-decoration: line-through;
  text-decoration-color: rgba(248, 81, 73, 0.8);
  border-radius: 2px;
}
.milkdown-host .milkdown-diff-removed-block { display: block; box-shadow: -3px 0 0 0 #f85149; padding-left: 6px; }
.milkdown-host .milkdown-diff-controls,
.milkdown-host .milkdown-diff-controls-block {
  display: inline-flex; gap: 4px; margin-left: 6px; vertical-align: middle;
  user-select: none;
}
.milkdown-host .milkdown-diff-accept,
.milkdown-host .milkdown-diff-reject {
  cursor: pointer; font-size: 11px; line-height: 1.6; padding: 0 7px;
  border-radius: 4px; border: 1px solid var(--v2-border-border-base);
  background: var(--v2-background-bg-layer-02); color: var(--v2-text-text-base);
}
.milkdown-host .milkdown-diff-accept:hover { border-color: #3fb950; color: #3fb950; }
.milkdown-host .milkdown-diff-reject:hover { border-color: #f85149; color: #f85149; }
`

/**
 * Éditeur WYSIWYG markdown (Milkdown / ProseMirror). Édition dans le rendu +
 * toolbar de mise en forme. Entrée markdown, sortie markdown : `onSave` reçoit
 * le markdown courant. Si l'éditeur riche ne monte pas, fallback markdown brut
 * (jamais de page blanche muette).
 */
export function MilkdownEditor(props: {
  value: string
  path?: string
  saving?: boolean
  /**
   * Suivi des modifications (#60). Quand il est fourni, `value` est la BASE
   * (la version de référence) et `reviewAgainst` la version proposée : Milkdown
   * calcule le diff au niveau du document ProseMirror et pose ses décorations,
   * avec accepter/rejeter par bloc. C'est le remplaçant du diff mot-à-mot
   * réinjecté en `<ins>/<del>`, invisible dès qu'un changement franchissait une
   * frontière de bloc.
   */
  reviewAgainst?: string
  onSave: (markdown: string) => void
  onCancel: () => void
}) {
  let host!: HTMLDivElement
  let editor: Editor | undefined
  let latest = props.value
  const [error, setError] = createSignal<string>()
  const reviewing = () => typeof props.reviewAgainst === "string"

  const call = (cmd: any, payload?: unknown) => {
    if (!editor) return
    editor.action(callCommand(cmd.key, payload as never))
  }

  onMount(() => {
    void Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, host)
        ctx.set(defaultValueCtx, props.value)
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          latest = markdown
        })
        ctx.update(diffComponentConfig.key, (prev) => ({
          ...prev,
          acceptLabel: "Accept",
          rejectLabel: "Reject",
        }))
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener)
      .use(diff)
      .use(diffComponent)
      .create()
      .then((instance) => {
        editor = instance
        // La revue démarre une fois l'éditeur monté : la base est déjà dans le
        // document, on lui donne la version proposée comme cible.
        const proposed = props.reviewAgainst
        if (typeof proposed === "string") {
          instance.action(callCommand(startDiffReviewCmd.key, proposed as never))
        }
      })
      .catch((e) => {
        console.error("[milkdown] mount failed", e)
        setError(e instanceof Error ? e.message : String(e))
      })
  })

  onCleanup(() => {
    editor?.destroy()
    editor = undefined
  })

  return (
    <div class="flex flex-col min-h-[70vh]">
      <style>{CSS}</style>
      <div
        class="sticky top-0 z-20 shrink-0 flex flex-wrap items-center gap-1 px-3 py-1.5 border-b"
        style={{ background: "var(--v2-background-bg-layer-01)", "border-color": "var(--v2-border-border-muted)" }}
      >
        <Show
          when={!reviewing()}
          fallback={
            <>
              <span class="text-12-medium mr-1" style={{ color: "var(--v2-text-text-base)" }}>
                Tracked changes
              </span>
              <span class="text-11-regular" style={{ color: "var(--v2-text-text-muted)" }}>
                accept or reject each block inline
              </span>
              <div class="w-px self-stretch mx-1" style={{ background: "var(--v2-border-border-muted)" }} />
              <button
                type="button"
                class="px-2 py-1 rounded text-12-regular hover:brightness-125"
                style={{ color: "var(--v2-text-text-base)" }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => call(acceptAllDiffsCmd)}
              >
                Accept all
              </button>
              <button
                type="button"
                class="px-2 py-1 rounded text-12-regular hover:brightness-125"
                style={{ color: "var(--v2-text-text-muted)" }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => call(clearDiffReviewCmd)}
                title="Leave review without applying anything further"
              >
                Exit review
              </button>
            </>
          }
        >
          <For each={GROUPS}>
            {(group, gi) => (
              <>
                <Show when={gi() > 0}>
                  <div class="w-px self-stretch mx-0.5" style={{ background: "var(--v2-border-border-muted)" }} />
                </Show>
                <For each={group}>
                  {(item) => (
                    <button
                      type="button"
                      class="px-2 py-1 rounded text-12-regular hover:brightness-125"
                      style={{
                        color: "var(--v2-text-text-base)",
                        "font-weight": item.weight ? String(item.weight) : undefined,
                        "font-style": item.italic ? "italic" : undefined,
                        "text-decoration": item.strike ? "line-through" : undefined,
                      }}
                      title={item.label}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => call(item.cmd, item.payload)}
                    >
                      {item.label}
                    </button>
                  )}
                </For>
              </>
            )}
          </For>
        </Show>
        <div class="flex-1" />
        <Show when={props.path}>
          <span class="text-11-regular mr-1" style={{ color: "var(--v2-text-text-muted)" }}>
            {props.path}
          </span>
        </Show>
        <button
          type="button"
          class="px-3 py-1 rounded border text-12-regular"
          style={{ "border-color": "var(--v2-border-border-base)", color: "var(--v2-text-text-base)" }}
          disabled={props.saving}
          onClick={() => props.onCancel()}
        >
          Cancel
        </button>
        <button
          type="button"
          class="px-3 py-1 rounded text-12-medium"
          style={{ background: "#2ea043", color: "#ffffff" }}
          disabled={props.saving}
          onClick={() => props.onSave(latest)}
        >
          {props.saving ? "Saving…" : "Save"}
        </button>
      </div>
      <div
        class="milkdown-host mx-auto w-full max-w-[80ch] px-6 py-4"
        style={{ display: error() ? "none" : undefined }}
      >
        <div ref={host} />
      </div>
      <Show when={error()}>
        <div class="mx-auto w-full max-w-[80ch] px-6 py-4">
          <div class="mb-2 text-11-regular" style={{ color: "var(--v2-text-text-muted)" }}>
            Rich editor unavailable ({error()}) — falling back to raw markdown.
          </div>
          <textarea
            class="w-full min-h-[60vh] bg-transparent outline-none resize-none"
            style={{ "font-family": "var(--font-mono, monospace)", "font-size": "13px", "line-height": "1.7", color: "var(--v2-text-text-base)" }}
            value={props.value}
            onInput={(e) => (latest = e.currentTarget.value)}
            spellcheck={false}
          />
        </div>
      </Show>
    </div>
  )
}
