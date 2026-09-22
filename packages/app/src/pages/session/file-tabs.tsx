import { createEffect, createMemo, createSignal, Match, on, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@opencode-ai/session-ui/file"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode-ai/session-ui/pierre/selection-bridge"
import { createLineCommentController } from "@opencode-ai/session-ui/line-comment-annotations"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { saveTextAsFile, mdFilename } from "@/utils/export-file"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { MilkdownEditor } from "@/pages/session/milkdown-editor"
import { sampledChecksum } from "@opencode-ai/core/util/encode"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { showToast } from "@/utils/toast"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useComments } from "@/context/comments"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { getSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"

function FileCommentMenu(props: {
  moreLabel: string
  editLabel: string
  deleteLabel: string
  onEdit: VoidFunction
  onDelete: VoidFunction
}) {
  return (
    <div onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <DropdownMenu gutter={4} placement="bottom-end">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          size="small"
          class="size-6 rounded-md"
          aria-label={props.moreLabel}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={props.onEdit}>
              <DropdownMenu.ItemLabel>{props.editLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={props.onDelete}>
              <DropdownMenu.ItemLabel>{props.deleteLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}

type ScrollPos = { x: number; y: number }

function createScrollSync(input: { tab: () => string; view: ReturnType<typeof useSessionLayout>["view"] }) {
  let scroll: HTMLDivElement | undefined
  let scrollFrame: number | undefined
  let restoreFrame: number | undefined
  let pending: ScrollPos | undefined
  const [code, setCode] = createSignal<HTMLElement[]>([])

  const getCode = () => {
    const el = scroll
    if (!el) return []

    const host = el.querySelector("diffs-container")
    if (!(host instanceof HTMLElement)) return []

    const root = host.shadowRoot
    if (!root) return []

    return Array.from(root.querySelectorAll("[data-code]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.clientWidth > 0,
    )
  }

  const save = (next: ScrollPos) => {
    pending = next
    if (scrollFrame !== undefined) return

    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined

      const out = pending
      pending = undefined
      if (!out) return

      input.view().setScroll(input.tab(), out)
    })
  }

  const onCodeScroll = (event: Event) => {
    const el = scroll
    if (!el) return

    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return

    save({
      x: target.scrollLeft,
      y: el.scrollTop,
    })
  }

  const sync = () => {
    const next = getCode()
    const current = code()
    if (next.length === current.length && next.every((el, i) => el === current[i])) return
    setCode(next)
  }

  const restore = () => {
    const el = scroll
    if (!el) return

    const pos = input.view().scroll(input.tab())
    if (!pos) return

    sync()

    if (code().length > 0) {
      for (const item of code()) {
        if (item.scrollLeft !== pos.x) item.scrollLeft = pos.x
      }
    }

    if (el.scrollTop !== pos.y) el.scrollTop = pos.y
    if (code().length > 0) return
    if (el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }

  const queueRestore = () => {
    if (restoreFrame !== undefined) return

    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = undefined
      restore()
    })
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (code().length === 0) sync()

    save({
      x: code()[0]?.scrollLeft ?? event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    })
  }

  createEffect(() => {
    for (const item of code()) makeEventListener(item, "scroll", onCodeScroll)
  })

  const setViewport = (el: HTMLDivElement) => {
    scroll = el
    restore()
  }

  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
    if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame)
  })

  return {
    handleScroll,
    queueRestore,
    setViewport,
  }
}

// Base du suivi des modifications, par chemin de fichier (#60). Au niveau module :
// l'onglet peut être démonté et remonté (changement d'onglet, re-render), la base
// doit survivre — sinon « ce qui a changé depuis » repartirait de zéro à chaque
// aller-retour. Volontairement en mémoire : une base persistée sur disque serait
// un shadow-git, un autre sujet.
const REVIEW_BASELINES = new Map<string, string>()
const readBaseline = (path: string) => REVIEW_BASELINES.get(path)
const markBaseline = (path: string, content: string) => {
  REVIEW_BASELINES.set(path, content)
}

export function FileTabContent(props: { tab: string }) {
  const file = useFile()
  const comments = useComments()
  const language = useLanguage()
  const prompt = usePrompt()
  const fileComponent = useFileComponent()
  const { sessionKey, tabs, view } = useSessionLayout()
  const activeFileTab = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  }).activeFileTab

  let find: FileSearchHandle | null = null

  const search = {
    register: (handle: FileSearchHandle | null) => {
      find = handle
    },
  }

  const path = createMemo(() => file.pathFromTab(props.tab))
  const state = createMemo(() => {
    const p = path()
    if (!p) return
    return file.get(p)
  })
  const contents = createMemo(() => state()?.content?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))
  const isMarkdown = createMemo(() => {
    const p = (path() ?? "").toLowerCase()
    return p.endsWith(".md") || p.endsWith(".markdown")
  })
  // Rendu markdown pour les .md — toggle Rendu/Source, additif (la source Pierre reste dispo).
  const [preview, setPreview] = createSignal(true)
  // Éditeur WYSIWYG (Milkdown) — édition dans le rendu, save via IPC desktop write-file.
  const platform = usePlatform()
  const sdk = useSDK()
  const [editing, setEditing] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const startEdit = () => setEditing(true)
  const absPath = () => {
    const p = path()
    return p ? `${sdk().directory.replace(/\/$/, "")}/${p}` : undefined
  }
  const saveEditWith = async (md: string) => {
    const p = path()
    if (!p || !platform.writeTextFile) return
    setSaving(true)
    try {
      await platform.writeTextFile(absPath()!, md)
      markBaseline(p, md) // ce qu'on vient d'écrire devient la référence
      await file.load(p, { force: true })
      setEditing(false)
      setReviewing(false)
    } catch {
      /* ignore */
    } finally {
      setSaving(false)
    }
  }

  // Suivi des modifications (#60) — natif de l'éditeur (plugin-diff de Milkdown,
  // diff au niveau du document ProseMirror). La v1 (diff mot-à-mot `<ins>/<del>`
  // réinjecté dans le markdown) est morte : invisible dès qu'un changement
  // franchissait une frontière de bloc.
  //
  // La BASE est la dernière version qu'on a validée pour ce fichier : première
  // ouverture, ou dernier enregistrement. Ce qui a changé depuis — y compris ce
  // qu'un agent cowork a écrit pendant qu'on regardait ailleurs — est ce que le
  // suivi montre.
  const [reviewing, setReviewing] = createSignal(false)
  const baseline = createMemo(() => {
    const p = path()
    if (!p) return ""
    const known = readBaseline(p)
    if (known !== undefined) return known
    markBaseline(p, contents()) // première ouverture : rien à signaler
    return contents()
  })
  const hasChanges = createMemo(() => !!path() && baseline() !== contents())
  const startReview = () => {
    baseline() // force la capture si le fichier vient d'être ouvert
    setEditing(true)
    setReviewing(true)
  }
  // Frontmatter YAML (title/description) → header au-dessus du rendu, corps sans le `---`.
  const frontmatter = createMemo(() => {
    const raw = contents()
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
    if (!m) return { title: undefined as string | undefined, description: undefined as string | undefined, body: raw }
    const yaml = m[1]
    const pick = (k: string) =>
      yaml.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "") || undefined
    return { title: pick("title"), description: pick("description"), body: raw.slice(m[0].length) }
  })
  const selectedLines = createMemo<SelectedLineRange | null>(() => {
    const p = path()
    if (!p) return null
    if (file.ready()) return (file.selectedLines(p) as SelectedLineRange | undefined) ?? null
    return (getSessionHandoff(sessionKey())?.files[p] as SelectedLineRange | undefined) ?? null
  })
  const scrollSync = createScrollSync({
    tab: () => props.tab,
    view,
  })

  const selectionPreview = (source: string, selection: FileSelection) => {
    return previewSelectedLines(source, {
      start: selection.startLine,
      end: selection.endLine,
    })
  }

  const buildPreview = (filePath: string, selection: FileSelection) => {
    const source = filePath === path() ? contents() : file.get(filePath)?.content?.content
    if (!source) return undefined
    return selectionPreview(source, selection)
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? buildPreview(input.file, selection)

    const saved = comments.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })
    prompt.context.add({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    const preview = input.file === path() ? buildPreview(input.file, selectionFromLines(input.selection)) : undefined
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(preview ? { preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const fileComments = createMemo(() => {
    const p = path()
    if (!p) return []
    return comments.list(p)
  })

  const commentedLines = createMemo(() => fileComments().map((comment) => comment.selection))

  const [note, setNote] = createStore({
    openedComment: null as string | null,
    commenting: null as SelectedLineRange | null,
    selected: null as SelectedLineRange | null,
  })

  const syncSelected = (range: SelectedLineRange | null) => {
    const p = path()
    if (!p) return
    file.setSelectedLines(p, range ? cloneSelectedLineRange(range) : null)
  }

  const activeSelection = () => note.selected ?? selectedLines()

  const commentsUi = createLineCommentController({
    comments: fileComments,
    label: language.t("ui.lineComment.submit"),
    draftKey: () => path() ?? props.tab,
    mention: {
      items: file.searchFilesAndDirectories,
    },
    state: {
      opened: () => note.openedComment,
      setOpened: (id) => setNote("openedComment", id),
      selected: () => note.selected,
      setSelected: (range) => setNote("selected", range),
      commenting: () => note.commenting,
      setCommenting: (range) => setNote("commenting", range),
      syncSelected,
      hoverSelected: syncSelected,
    },
    getHoverSelectedRange: activeSelection,
    cancelDraftOnCommentToggle: true,
    clearSelectionOnSelectionEndNull: true,
    onSubmit: ({ comment, selection }) => {
      const p = path()
      if (!p) return
      addCommentToContext({ file: p, selection, comment, origin: "file" })
    },
    onUpdate: ({ id, comment, selection }) => {
      const p = path()
      if (!p) return
      updateCommentInContext({ id, file: p, selection, comment })
    },
    onDelete: (comment) => {
      const p = path()
      if (!p) return
      removeCommentFromContext({ id: comment.id, file: p })
    },
    editSubmitLabel: language.t("common.save"),
    renderCommentActions: (_, controls) => (
      <FileCommentMenu
        moreLabel={language.t("common.moreOptions")}
        editLabel={language.t("common.edit")}
        deleteLabel={language.t("common.delete")}
        onEdit={controls.edit}
        onDelete={controls.remove}
      />
    ),
  })

  createEffect(() => {
    if (typeof window === "undefined") return

    const onKeyDown = (event: KeyboardEvent) => {
      if (activeFileTab() !== props.tab) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== "f") return

      event.preventDefault()
      event.stopPropagation()
      find?.focus()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  createEffect(
    on(
      path,
      () => {
        commentsUi.note.reset()
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const focus = comments.focus()
    const p = path()
    if (!focus || !p) return
    if (focus.file !== p) return
    if (activeFileTab() !== props.tab) return

    const target = fileComments().find((comment) => comment.id === focus.id)
    if (!target) return

    commentsUi.note.openComment(target.id, target.selection, { cancelDraft: true })
    requestAnimationFrame(() => comments.clearFocus())
  })

  let prev = {
    loaded: false,
    ready: false,
    active: false,
  }

  createEffect(() => {
    const loaded = !!state()?.loaded
    const ready = file.ready()
    const active = activeFileTab() === props.tab
    const restore = (loaded && !prev.loaded) || (ready && !prev.ready) || (active && loaded && !prev.active)
    prev = { loaded, ready, active }
    if (!restore) return
    scrollSync.queueRestore()
  })

  const renderFile = (source: string) => (
    <div class="relative overflow-hidden pb-40">
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: path() ?? "",
          contents: source,
          cacheKey: cacheKey(),
        }}
        enableLineSelection
        enableGutterUtility
        selectedLines={activeSelection()}
        commentedLines={commentedLines()}
        onRendered={() => {
          scrollSync.queueRestore()
        }}
        annotations={commentsUi.annotations()}
        renderAnnotation={commentsUi.renderAnnotation}
        renderGutterUtility={commentsUi.renderGutterUtility}
        onLineSelected={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelected(range)
        }}
        onLineSelectionEnd={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelectionEnd(range)
        }}
        search={search}
        class="select-text"
        media={{
          mode: "auto",
          path: path(),
          current: state()?.content,
          onLoad: scrollSync.queueRestore,
          onError: (args: { kind: "image" | "audio" | "svg" }) => {
            if (args.kind !== "svg") return
            showToast({
              variant: "error",
              title: language.t("toast.file.loadFailed.title"),
            })
          },
        }}
      />
    </div>
  )

  return (
    <Tabs.Content value={props.tab} class="mt-3 relative h-full">
      <Show when={isMarkdown() && state()?.loaded}>
        <div
          class="absolute right-3 top-0 z-10 flex items-center gap-0.5 rounded-md border p-0.5 text-11-regular"
          style={{ background: "var(--v2-background-bg-layer-01)", "border-color": "var(--v2-border-border-muted)" }}
        >
          <button
            type="button"
            class="px-2 py-0.5 rounded"
            style={{ background: preview() ? "var(--v2-background-bg-layer-02)" : "transparent" }}
            onClick={() => setPreview(true)}
          >
            Preview
          </button>
          <button
            type="button"
            class="px-2 py-0.5 rounded"
            style={{ background: !preview() ? "var(--v2-background-bg-layer-02)" : "transparent" }}
            onClick={() => setPreview(false)}
          >
            Source
          </button>
          <button type="button" class="px-2 py-0.5 rounded" onClick={startEdit}>
            Edit
          </button>
          <button
            type="button"
            class="px-2 py-0.5 rounded"
            style={{
              background: reviewing() ? "var(--v2-background-bg-layer-02)" : "transparent",
              color: hasChanges() ? "var(--v2-text-text-base)" : "var(--v2-text-text-muted)",
            }}
            title={hasChanges() ? "Review what changed" : "Nothing changed since the last save"}
            onClick={startReview}
          >
            Changes{hasChanges() ? " •" : ""}
          </button>
          <div class="w-px self-stretch mx-0.5" style={{ background: "var(--v2-border-border-muted)" }} />
          <button
            type="button"
            class="px-2 py-0.5 rounded"
            title="Download as .md"
            onClick={() => saveTextAsFile(mdFilename(path()), contents())}
          >
            ⬇ .md
          </button>
        </div>
      </Show>
      <ScrollView class="h-full" viewportRef={scrollSync.setViewport} onScroll={scrollSync.handleScroll as any}>
        <Switch>
          <Match when={state()?.loaded}>
            <Show
              when={editing()}
              fallback={
                <Show when={isMarkdown() && preview()} fallback={renderFile(contents())}>
                  <div class="mx-auto w-full max-w-[80ch] px-6 py-4">
                    <Show when={frontmatter().title || frontmatter().description}>
                      <div class="mb-4 pb-3 border-b" style={{ "border-color": "var(--v2-border-border-muted)" }}>
                        <Show when={frontmatter().title}>
                          <div class="text-14-medium" style={{ color: "var(--v2-text-text-base)" }}>
                            {frontmatter().title}
                          </div>
                        </Show>
                        <Show when={frontmatter().description}>
                          <div class="text-12-regular mt-1" style={{ color: "var(--v2-text-text-muted)" }}>
                            {frontmatter().description}
                          </div>
                        </Show>
                      </div>
                    </Show>
                    <Markdown text={frontmatter().body} cacheKey={cacheKey()} />
                  </div>
                </Show>
              }
            >
              <MilkdownEditor
                // En suivi, l'éditeur part de la BASE et reçoit la version
                // courante comme proposition — c'est le sens du diff.
                value={reviewing() ? baseline() : contents()}
                reviewAgainst={reviewing() ? contents() : undefined}
                path={path()}
                saving={saving()}
                onSave={(md) => void saveEditWith(md)}
                onCancel={() => {
                  setEditing(false)
                  setReviewing(false)
                }}
              />
            </Show>
          </Match>
          <Match when={state()?.loading}>
            <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
          </Match>
          <Match when={state()?.error}>{(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}</Match>
        </Switch>
      </ScrollView>
    </Tabs.Content>
  )
}
