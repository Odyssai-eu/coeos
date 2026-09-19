export * as TaskRun from "./taskrun"

// coeos-code v2 — contrat TaskRun (PLAN.md WU4). Le schéma est LE contrat entre le
// mode CoeOS (Orchestrator + tool taskfile) et Mission Control : chaque tâche
// du Task File émet ces événements sur le bus serveur (SSE) quand son statut
// change. Les stamps startedAt/endedAt sont posés par la fonction de dispatch
// côté Orchestrator (le tool taskfile), jamais dérivés des internals de
// BackgroundJob, et couvrent la session executor seule (la review dispatche sa
// propre sous-session, son horloge n'entre pas ici).

import { Schema } from "effect"
import { define, inventory } from "./event"
import { SessionID } from "./session-id"

export const Status = Schema.Literals(["todo", "doing", "done", "blocked"])
export type Status = typeof Status.Type

export const Task = Schema.Struct({
  id: Schema.String.annotate({ description: "Task id from the Task File (e.g. T1)" }),
  description: Schema.String,
  role: Schema.String.annotate({ description: "Subagent role the task is dispatched to (e.g. executor)" }),
  status: Status,
  points: Schema.optional(Schema.Number),
  deps: Schema.Array(Schema.String).annotate({ description: "Task ids this task depends on" }),
  background: Schema.Boolean.annotate({ description: "Independent task, dispatchable as a background job" }),
  approved: Schema.Boolean.annotate({ description: "Part of the GO-approved set (hash match)" }),
}).annotate({ identifier: "TaskFileTask" })
export interface Task extends Schema.Schema.Type<typeof Task> {}

export const Info = Schema.Struct({
  taskId: Schema.String,
  planSessionID: SessionID.annotate({ description: "The Orchestrator session that owns the Task File" }),
  childSessionID: Schema.optional(SessionID).annotate({ description: "The dispatched subagent session" }),
  role: Schema.String,
  model: Schema.optional(Schema.String).annotate({ description: "Resolved model id for the dispatched role" }),
  status: Status,
  startedAt: Schema.optional(Schema.Number),
  endedAt: Schema.optional(Schema.Number),
}).annotate({ identifier: "TaskRun" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

const Started = define({
  type: "taskrun.started",
  schema: { run: Info },
})

const Updated = define({
  type: "taskrun.updated",
  schema: { run: Info },
})

const Completed = define({
  type: "taskrun.completed",
  schema: { run: Info },
})

const Blocked = define({
  type: "taskrun.blocked",
  schema: { run: Info },
})

// Émis à chaque écriture du Task File (création, GO, transition de statut,
// merge après édition humaine) — le panneau Task File de Mission Control
// écoute cet événement au lieu de watcher le fichier lui-même.
const FileUpdated = define({
  type: "taskfile.updated",
  schema: {
    planSessionID: SessionID,
    title: Schema.String,
    approvedHash: Schema.optional(Schema.String),
    tasks: Schema.Array(Task),
  },
})

export const Event = {
  Started,
  Updated,
  Completed,
  Blocked,
  FileUpdated,
  Definitions: inventory(Started, Updated, Completed, Blocked, FileUpdated),
}
