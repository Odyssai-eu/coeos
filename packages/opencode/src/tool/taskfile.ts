// coeos-code v2 — tool taskfile (PLAN.md WU3, ADR 0002/0003).
// L'API fichier s'appelle `taskfile`, jamais `task` (réservé au tool de spawn
// de subagents — collision de termes tuée au round 1). Les invariants vivent
// ICI, en code, pas dans la config (les permissions config sont mergeables
// par l'utilisateur) : seul l'agent `coeos` manipule le Task File ; une tâche
// ne passe `doing` que si elle est approuvée (GO/mini-GO) et ses deps `done`.

import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./taskfile.txt"
import { Taskfile } from "../session/taskfile"
import { hashTask } from "../session/taskfile"
import { Question } from "../question"
import { EventV2Bridge } from "@/event-v2-bridge"
import { TaskRun } from "@opencode-ai/schema/taskrun"
import { SessionID } from "../session/schema"

const ORCHESTRATOR_AGENT = "coeos"

const TaskInput = Schema.Struct({
  id: Schema.String.annotate({ description: "Short stable id, e.g. T1" }),
  description: Schema.String,
  role: Schema.String.annotate({ description: "Subagent role to dispatch to (executor, reviewer, debugger, explore)" }),
  points: Schema.optional(Schema.Number).annotate({ description: "Fibonacci complexity points" }),
  deps: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Ids of tasks that must be done first" }),
  background: Schema.optional(Schema.Boolean).annotate({
    description: "Independent task that may run as a background job",
  }),
})

export const Parameters = Schema.Struct({
  action: Schema.Literals(["plan", "read", "approve", "status"]),
  title: Schema.optional(Schema.String).annotate({ description: "Plan title (action=plan)" }),
  tasks: Schema.optional(Schema.mutable(Schema.Array(TaskInput))).annotate({
    description: "The full task list (action=plan)",
  }),
  task_id: Schema.optional(Schema.String).annotate({ description: "Task to transition (action=status)" }),
  status: Schema.optional(Schema.Literals(["doing", "done", "blocked", "todo"])).annotate({
    description: "New status (action=status)",
  }),
  child_session_id: Schema.optional(Schema.String).annotate({
    description: "The dispatched subagent session id (action=status, when starting a task)",
  }),
  model: Schema.optional(Schema.String).annotate({
    description: "Resolved model id of the dispatched role (action=status)",
  }),
})

function render(doc: { title: string; tasks: ReadonlyArray<TaskRun.Task> }) {
  const lines = [`Plan: ${doc.title}`]
  for (const task of doc.tasks) {
    const flags = [
      task.status,
      task.approved ? "approved" : "NOT APPROVED",
      ...(task.background ? ["bg"] : []),
      ...(task.deps.length ? [`deps: ${task.deps.join(",")}`] : []),
    ]
    lines.push(`${task.id} [${flags.join(" | ")}] (${task.role}) ${task.description}`)
  }
  return lines.join("\n")
}

export const TaskfileTool = Tool.define(
  "taskfile",
  Effect.gen(function* () {
    const taskfile = yield* Taskfile.Service
    const question = yield* Question.Service
    const events = yield* EventV2Bridge.Service
    // startedAt par (session, tâche) — état process pour la durée live du
    // TaskRun ; perdu au restart, ce qui est le contrat (la durabilité est
    // celle du Task File, pas des runs — PLAN.md, non-buts).
    const startedAt = new Map<string, number>()

    const publishRun = Effect.fn("TaskfileTool.publishRun")(function* (
      definition: (typeof TaskRun.Event)["Started" | "Updated" | "Completed" | "Blocked"],
      run: TaskRun.Info,
    ) {
      yield* events.publish(definition, { run }).pipe(Effect.ignore)
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          // Garde runtime, pas config : le Task File a un seul écrivain
          // machine, l'Orchestrator (ADR 0003).
          if (ctx.agent !== ORCHESTRATOR_AGENT)
            return yield* Effect.fail(
              new Error(`The taskfile tool is only available to the ${ORCHESTRATOR_AGENT} agent (CoeOS Mode)`),
            )

          const sessionID = ctx.sessionID

          switch (params.action) {
            case "plan": {
              if (!params.title || !params.tasks?.length)
                return yield* Effect.fail(new Error("action=plan requires title and a non-empty tasks list"))
              const existing = yield* taskfile.load(sessionID)
              const byHash = new Map(existing?.tasks.map((task) => [hashTask(task), task]) ?? [])
              const tasks: TaskRun.Task[] = params.tasks.map((input) => {
                const candidate = {
                  id: input.id,
                  description: input.description,
                  role: input.role,
                  points: input.points,
                  deps: [...(input.deps ?? [])],
                  background: input.background === true,
                  status: "todo" as const,
                  approved: false,
                }
                const prior = byHash.get(hashTask(candidate))
                // Une tâche inchangée (même id/role/description) garde statut
                // et approbation ; une tâche reformulée repart todo/non
                // approuvée → mini-GO requis (round 1, finding 13).
                return prior ? { ...candidate, status: prior.status, approved: prior.approved } : candidate
              })
              const approved = new Set(tasks.filter((task) => task.approved).map((task) => hashTask(task)))
              const doc = yield* taskfile
                .save({ sessionID, title: params.title, approved, tasks, expect: existing?.readHash })
                .pipe(
                  Effect.catch((error) =>
                    Effect.fail(
                      new Error(
                        `Task File changed on disk (user edit). Re-read before planning again.\n${error.fresh ? render(error.fresh) : "(file was removed)"}`,
                      ),
                    ),
                  ),
                )
              return {
                title: `${doc.tasks.length} tasks planned`,
                output: render(doc) + "\n\nTasks are NOT approved yet. Use action=approve to request the GO.",
                metadata: {},
              }
            }

            case "read": {
              const doc = yield* taskfile.recover(sessionID)
              if (!doc)
                return { title: "no task file", output: "No Task File exists for this session yet.", metadata: {} }
              return { title: `${doc.tasks.length} tasks`, output: render(doc), metadata: {} }
            }

            case "approve": {
              const doc = yield* taskfile.load(sessionID)
              if (!doc) return yield* Effect.fail(new Error("No Task File to approve. Use action=plan first."))
              const pending = doc.tasks.filter((task) => !task.approved)
              if (pending.length === 0)
                return { title: "already approved", output: "All tasks are already approved.", metadata: {} }
              const summary = pending.map((task) => `${task.id} (${task.role}) ${task.description}`).join("\n")
              const answers = yield* question.ask({
                sessionID,
                questions: [
                  {
                    question: `GO to execute ${pending.length} task(s)?\n\n${summary}`,
                    header: "CoeOS GO",
                    custom: false,
                    options: [
                      { label: "GO", description: "Approve these tasks; the Orchestrator runs autonomously" },
                      { label: "No", description: "Keep refining the plan" },
                    ],
                  },
                ],
                tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
              })
              if (answers[0]?.[0] !== "GO") return yield* new Question.RejectedError()
              const approved = new Set([...doc.approved, ...pending.map((task) => hashTask(task))])
              const saved = yield* taskfile
                .save({
                  sessionID,
                  title: doc.title,
                  approved,
                  tasks: doc.tasks.map((task) => ({ ...task, approved: true })),
                  expect: doc.readHash,
                })
                .pipe(
                  Effect.catch(() =>
                    Effect.fail(new Error("Task File changed on disk during approval. Re-read and re-approve.")),
                  ),
                )
              return {
                title: "GO received",
                output: `User approved ${pending.length} task(s). Execute autonomously.\n\n${render(saved)}`,
                metadata: {},
              }
            }

            case "status": {
              if (!params.task_id || !params.status)
                return yield* Effect.fail(new Error("action=status requires task_id and status"))
              const doc = yield* taskfile.load(sessionID)
              if (!doc) return yield* Effect.fail(new Error("No Task File exists for this session"))
              const task = doc.tasks.find((item) => item.id === params.task_id)
              if (!task) return yield* Effect.fail(new Error(`Unknown task id: ${params.task_id}`))

              if (params.status === "doing") {
                // Les deux verrous en code : jamais démarrer une tâche non
                // approuvée (mini-GO), jamais avant ses deps.
                if (!task.approved)
                  return yield* Effect.fail(
                    new Error(`Task ${task.id} is not approved. Use action=approve to request the user's GO first.`),
                  )
                const notDone = task.deps.filter(
                  (dep) => doc.tasks.find((item) => item.id === dep)?.status !== "done",
                )
                if (notDone.length > 0)
                  return yield* Effect.fail(new Error(`Task ${task.id} has unfinished deps: ${notDone.join(", ")}`))
              }

              const saved = yield* taskfile
                .save({
                  sessionID,
                  title: doc.title,
                  approved: doc.approved,
                  tasks: doc.tasks.map((item) => (item.id === task.id ? { ...item, status: params.status! } : item)),
                  expect: doc.readHash,
                })
                .pipe(
                  Effect.catch((error) =>
                    Effect.fail(
                      new Error(
                        `Task File changed on disk (user edit). Re-read, then retry the transition.\n${error.fresh ? render(error.fresh) : "(file was removed)"}`,
                      ),
                    ),
                  ),
                )

              const key = `${sessionID}:${task.id}`
              const now = Date.now()
              const run: TaskRun.Info = {
                taskId: task.id,
                planSessionID: sessionID,
                childSessionID: params.child_session_id ? SessionID.make(params.child_session_id) : undefined,
                role: task.role,
                model: params.model,
                status: params.status,
                startedAt: params.status === "doing" ? now : startedAt.get(key),
                endedAt: params.status === "done" || params.status === "blocked" ? now : undefined,
              }
              if (params.status === "doing") startedAt.set(key, now)
              const definition =
                params.status === "doing"
                  ? TaskRun.Event.Started
                  : params.status === "done"
                    ? TaskRun.Event.Completed
                    : params.status === "blocked"
                      ? TaskRun.Event.Blocked
                      : TaskRun.Event.Updated
              yield* publishRun(definition, run)

              return {
                title: `${task.id} -> ${params.status}`,
                output: render(saved),
                metadata: {},
              }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
