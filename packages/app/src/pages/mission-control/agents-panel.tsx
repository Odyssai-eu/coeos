// Panneau centre — runs d'agents dispatchés par l'Orchestrator.
// Une ligne par tâche : taskId, rôle, modèle, statut, durée (live pour doing).
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { formatDuration, type MissionRun } from "./state"

const STATUS_ORDER: Record<MissionRun["status"], number> = { doing: 0, blocked: 1, done: 2, todo: 3 }

function StatusDot(props: { status: MissionRun["status"] }) {
  return (
    <Switch>
      <Match when={props.status === "doing"}>
        <span class="relative flex size-2 shrink-0">
          <span class="absolute inline-flex size-full animate-ping rounded-full bg-v2-icon-icon-accent opacity-50" />
          <span class="relative inline-flex size-2 rounded-full bg-v2-icon-icon-accent" />
        </span>
      </Match>
      <Match when={props.status === "done"}>
        <span class="size-2 shrink-0 rounded-full bg-v2-state-fg-success" />
      </Match>
      <Match when={props.status === "blocked"}>
        <span class="size-2 shrink-0 rounded-full bg-v2-state-fg-danger" />
      </Match>
      <Match when={true}>
        <span class="size-2 shrink-0 rounded-full border border-v2-border-border-strong" />
      </Match>
    </Switch>
  )
}

export function AgentsPanel(props: {
  runs: MissionRun[]
  now: number
  activeKey?: string
  onSelect: (key: string) => void
}) {
  const sorted = createMemo(() =>
    [...props.runs].sort((a, b) => {
      const order = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      if (order !== 0) return order
      return b.startedSeq - a.startedSeq
    }),
  )
  const runningCount = createMemo(() => props.runs.filter((run) => run.status === "doing").length)

  // Durée : live tant que le run tourne, figée sur endedAt une fois terminé.
  const duration = (run: MissionRun) => {
    if (run.startedAt === undefined) return undefined
    const end = run.status === "doing" ? props.now : run.endedAt
    if (end === undefined) return undefined
    return formatDuration(end - run.startedAt)
  }

  return (
    <section class="flex min-h-0 min-w-0 flex-col border-r border-v2-border-border-base">
      <header class="flex h-12 shrink-0 items-center gap-2 border-b border-v2-border-border-base px-4">
        <span class="text-11-medium uppercase tracking-[0.08em] text-v2-text-text-faint">Agents</span>
        <Show when={runningCount() > 0}>
          <span class="rounded-full bg-v2-background-bg-layer-02 px-1.5 py-px text-10-regular tabular-nums text-v2-text-text-accent">
            {runningCount()} running
          </span>
        </Show>
      </header>
      <Show
        when={sorted().length > 0}
        fallback={
          <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div class="flex size-10 items-center justify-center rounded-full bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
              <Icon name="status" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-13-medium text-v2-text-text-base">No agent runs yet</span>
              <span class="text-12-regular text-v2-text-text-muted">Dispatched agents will appear here live.</span>
            </div>
          </div>
        }
      >
        <ScrollView class="min-h-0 flex-1">
          <ul class="flex flex-col gap-px px-2 py-2">
            <For each={sorted()}>
              {(run) => (
                <li>
                  <button
                    type="button"
                    disabled={!run.childSessionID}
                    onClick={() => props.onSelect(run.key)}
                    class="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors"
                    classList={{
                      "bg-v2-background-bg-layer-02 [box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)]":
                        run.key === props.activeKey,
                      "hover:bg-v2-background-bg-layer-01": run.key !== props.activeKey && !!run.childSessionID,
                      "cursor-default": !run.childSessionID,
                    }}
                  >
                    <StatusDot status={run.status} />
                    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div class="flex min-w-0 items-baseline gap-2">
                        <span class="shrink-0 font-mono text-12-medium text-v2-text-text-base">{run.taskId}</span>
                        <span class="truncate text-12-regular text-v2-text-text-muted">{run.role}</span>
                      </div>
                      <Show when={run.model}>
                        {(model) => <span class="truncate font-mono text-11-regular text-v2-text-text-faint">{model()}</span>}
                      </Show>
                    </div>
                    <Show when={duration(run)}>
                      {(value) => (
                        <span
                          class="shrink-0 font-mono text-11-regular tabular-nums"
                          classList={{
                            "text-v2-text-text-accent": run.status === "doing",
                            "text-v2-state-fg-success": run.status === "done",
                            "text-v2-state-fg-danger": run.status === "blocked",
                            "text-v2-text-text-faint": run.status === "todo",
                          }}
                        >
                          {value()}
                        </span>
                      )}
                    </Show>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </ScrollView>
      </Show>
    </section>
  )
}
