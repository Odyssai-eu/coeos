// Panneau gauche — Task File live du plan CoeOS actif.
// Checklist du plan : case par statut, rôle, points, badge « unapproved ».
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Icon } from "@opencode-ai/ui/v2/icon"
import type { TaskFileTask1 } from "@opencode-ai/sdk/v2"
import { finiteNumber, type MissionPlan } from "./state"

function StatusGlyph(props: { status: TaskFileTask1["status"] }) {
  return (
    <Switch>
      <Match when={props.status === "done"}>
        <span class="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-v2-state-border-success bg-v2-state-bg-success text-v2-state-fg-success">
          <Icon name="check" class="size-3" />
        </span>
      </Match>
      <Match when={props.status === "doing"}>
        <span class="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-v2-icon-icon-accent">
          <span class="size-1.5 animate-pulse rounded-full bg-v2-icon-icon-accent" />
        </span>
      </Match>
      <Match when={props.status === "blocked"}>
        <span class="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-v2-state-border-danger bg-v2-state-bg-danger text-10-regular font-semibold text-v2-state-fg-danger">
          !
        </span>
      </Match>
      <Match when={true}>
        <span class="size-4 shrink-0 rounded-[4px] border border-v2-border-border-base" />
      </Match>
    </Switch>
  )
}

function TaskRow(props: { task: TaskFileTask1 }) {
  const points = createMemo(() => finiteNumber(props.task.points))
  return (
    <li class="flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-v2-background-bg-layer-01">
      <div class="pt-px">
        <StatusGlyph status={props.task.status} />
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <span
          class="text-13-regular leading-snug"
          classList={{
            "text-v2-text-text-muted": props.task.status === "done",
            "text-v2-text-text-base": props.task.status !== "done",
          }}
        >
          {props.task.description}
        </span>
        <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-11-regular text-v2-text-text-faint">
          <span class="font-mono">{props.task.id}</span>
          <span aria-hidden="true">·</span>
          <span>{props.task.role}</span>
          <Show when={points()}>
            {(value) => (
              <>
                <span aria-hidden="true">·</span>
                <span>{value()} pts</span>
              </>
            )}
          </Show>
          <Show when={!props.task.approved}>
            <span class="rounded-full border border-v2-state-border-warning bg-v2-state-bg-warning px-1.5 py-px text-10-regular text-v2-state-fg-warning">
              unapproved
            </span>
          </Show>
        </div>
      </div>
    </li>
  )
}

export function TaskFilePanel(props: { title: string; plan?: MissionPlan }) {
  const doneCount = createMemo(() => props.plan?.tasks.filter((task) => task.status === "done").length ?? 0)
  const totalPoints = createMemo(() =>
    (props.plan?.tasks ?? []).reduce((sum, task) => sum + (finiteNumber(task.points) ?? 0), 0),
  )
  const donePoints = createMemo(() =>
    (props.plan?.tasks ?? [])
      .filter((task) => task.status === "done")
      .reduce((sum, task) => sum + (finiteNumber(task.points) ?? 0), 0),
  )
  const progress = createMemo(() => {
    const total = props.plan?.tasks.length ?? 0
    if (total === 0) return 0
    return Math.round((doneCount() / total) * 100)
  })

  return (
    <section class="flex min-h-0 min-w-0 flex-col border-r border-v2-border-border-base">
      <header class="flex h-12 shrink-0 items-center border-b border-v2-border-border-base px-4">
        <span class="text-12-medium text-v2-text-text-base">{props.title}</span>
      </header>
      <Show
        when={props.plan}
        keyed
        fallback={
          <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div class="flex size-10 items-center justify-center rounded-full bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
              <Icon name="workspace" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-13-medium text-v2-text-text-base">No active plan</span>
              <span class="text-12-regular text-v2-text-text-muted">
                Start CoeOS mode in a session to see the plan here.
              </span>
            </div>
          </div>
        }
      >
        {(plan) => (
          <>
            <div class="flex shrink-0 flex-col gap-2 px-4 pb-3 pt-4">
              <span class="text-10-regular uppercase tracking-[0.08em] text-v2-text-text-faint">Task File</span>
              <div class="text-14-medium leading-snug text-v2-text-text-base">{plan.title}</div>
              <div class="flex items-center gap-1.5 text-11-regular text-v2-text-text-muted">
                <span>
                  {doneCount()}/{plan.tasks.length} done
                </span>
                <Show when={totalPoints() > 0}>
                  <span aria-hidden="true">·</span>
                  <span>
                    {donePoints()}/{totalPoints()} pts
                  </span>
                </Show>
              </div>
              <div class="h-1 w-full overflow-hidden rounded-full bg-v2-background-bg-layer-02">
                <div
                  class="h-full rounded-full bg-v2-state-fg-success transition-[width] duration-500"
                  style={{ width: `${progress()}%` }}
                />
              </div>
            </div>
            <ScrollView class="min-h-0 flex-1">
              <ul class="flex flex-col gap-px px-2 pb-4">
                <For each={plan.tasks}>{(task) => <TaskRow task={task} />}</For>
              </ul>
            </ScrollView>
          </>
        )}
      </Show>
    </section>
  )
}
