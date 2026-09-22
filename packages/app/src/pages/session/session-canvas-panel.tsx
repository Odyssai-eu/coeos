// coeos-code — Canvas de session (issue #8, v1).
// Panneau latéral droit repliable : AGENTS (sous-sessions subagents, statut live),
// PLAN (todos de la session), CHANGES (fichiers modifiés). Desktop only, derrière
// le toggle Settings > General > Session canvas (défaut OFF).
// Lecture seule des stores sync() existants — aucun fetch dupliqué, le flux SSE
// (session.*, todo.updated, session.diff) tient tout à jour.
import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

function SectionHeader(props: { label: string; count: number }) {
  return (
    <div class="flex items-center gap-2 px-3 pt-3 pb-1">
      <span class="text-11-regular uppercase tracking-wide" style={{ color: "var(--v2-text-text-faint)" }}>
        {props.label}
      </span>
      <span class="text-11-regular" style={{ color: "var(--v2-text-text-muted)" }}>
        {props.count}
      </span>
    </div>
  )
}

export function SessionCanvasPanel(props: { sessionID: string }) {
  const sync = useSync()
  const sdk = useSDK()
  const layout = useLayout()

  // AGENTS — backfill au chargement à froid ; le live arrive ensuite par SSE
  // (session.created/updated -> data.session du dir-sync).
  const [backfill, setBackfill] = createSignal<Session[]>([])
  onMount(() => {
    sdk()
      .client.session.children({ sessionID: props.sessionID })
      .then((r: { data?: Session[] }) => setBackfill(r.data ?? []))
      .catch(() => {}) // non bloquant : le flux SSE couvre les subagents vivants
  })
  const agents = createMemo(() => {
    const seen = new Map<string, Session>()
    for (const s of backfill()) if (s.parentID === props.sessionID) seen.set(s.id, s)
    for (const s of sync().data.session) if (s.parentID === props.sessionID) seen.set(s.id, s)
    return [...seen.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
  })

  // PLAN — déjà fetché par session.tsx ; SSE todo.updated tient à jour.
  const todos = createMemo(() => sync().data.todo[props.sessionID] ?? [])

  // CHANGES — déjà fetché par session.tsx ; SSE session.diff tient à jour.
  const diffs = createMemo(() => sync().data.session_diff[props.sessionID] ?? [])

  const working = (id: string) => sync().data.session_working(id)

  return (
    <Show
      when={layout.sessionCanvas.opened()}
      fallback={
        <div
          class="shrink-0 flex flex-col items-center pt-2 w-9 border-l"
          style={{ "border-color": "var(--v2-border-border-muted)" }}
        >
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="large"
            class="!w-7 shrink-0"
            onClick={() => layout.sessionCanvas.toggle()}
            aria-label="Open canvas"
            icon={<IconV2 name="sidebar-right" />}
          />
        </div>
      }
    >
      <div
        class="shrink-0 w-[300px] min-h-0 flex flex-col overflow-y-auto border-l"
        style={{ background: "var(--v2-background-bg-layer-01)", "border-color": "var(--v2-border-border-base)" }}
      >
        <div
          class="flex items-center justify-between px-3 py-2 border-b"
          style={{ "border-color": "var(--v2-border-border-muted)" }}
        >
          <span class="text-12-regular" style={{ color: "var(--v2-text-text-base)" }}>
            Canvas
          </span>
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="small"
            onClick={() => layout.sessionCanvas.toggle()}
            aria-label="Collapse canvas"
            icon={<IconV2 name="sidebar-right" />}
          />
        </div>

        <SectionHeader label="Agents" count={agents().length} />
        <Show
          when={agents().length}
          fallback={
            <div class="px-3 py-1 text-12-regular" style={{ color: "var(--v2-text-text-faint)" }}>
              No subagents
            </div>
          }
        >
          <For each={agents()}>
            {(agent) => (
              <div class="flex items-center gap-2 h-7 px-3">
                <span
                  class="size-1.5 rounded-full shrink-0"
                  style={{
                    background: working(agent.id) ? "var(--v2-state-fg-success)" : "var(--v2-icon-icon-muted)",
                  }}
                />
                <span class="text-12-regular truncate" style={{ color: "var(--v2-text-text-base)" }}>
                  {agent.title || agent.slug}
                </span>
                <div class="flex-1" />
                <span class="text-11-regular shrink-0" style={{ color: "var(--v2-text-text-muted)" }}>
                  {working(agent.id) ? "running" : "idle"}
                </span>
              </div>
            )}
          </For>
        </Show>

        <SectionHeader label="Plan" count={todos().length} />
        <Show
          when={todos().length}
          fallback={
            <div class="px-3 py-1 text-12-regular" style={{ color: "var(--v2-text-text-faint)" }}>
              No plan
            </div>
          }
        >
          <For each={todos()}>
            {(todo) => (
              <div class="flex items-start gap-2 px-3 py-0.5">
                <span class="mt-0.5 shrink-0">
                  <Show
                    when={todo.status === "completed"}
                    fallback={
                      <span
                        class="size-1.5 rounded-full inline-block"
                        style={{
                          background:
                            todo.status === "in_progress"
                              ? "var(--v2-state-fg-warning)"
                              : "var(--v2-border-border-strong)",
                        }}
                      />
                    }
                  >
                    <IconV2 name="check" style={{ color: "var(--v2-state-fg-success)" }} />
                  </Show>
                </span>
                <span
                  class="text-12-regular"
                  classList={{ "line-through": todo.status === "completed" || todo.status === "cancelled" }}
                  style={{
                    color: todo.status === "in_progress" ? "var(--v2-text-text-base)" : "var(--v2-text-text-muted)",
                  }}
                >
                  {todo.content}
                </span>
              </div>
            )}
          </For>
        </Show>

        <SectionHeader label="Changes" count={diffs().length} />
        <Show
          when={diffs().length}
          fallback={
            <div class="px-3 py-1 pb-3 text-12-regular" style={{ color: "var(--v2-text-text-faint)" }}>
              No changes
            </div>
          }
        >
          <For each={diffs()}>
            {(diff) => (
              <div class="flex items-center gap-2 h-6 px-3">
                <span class="text-12-regular truncate" style={{ color: "var(--v2-text-text-base)" }}>
                  {diff.file}
                </span>
                <div class="flex-1" />
                <span class="text-11-regular shrink-0" style={{ color: "var(--v2-state-fg-success)" }}>
                  +{diff.additions}
                </span>
                <span class="text-11-regular shrink-0" style={{ color: "var(--v2-state-fg-danger)" }}>
                  -{diff.deletions}
                </span>
              </div>
            )}
          </For>
        </Show>
      </div>
    </Show>
  )
}
