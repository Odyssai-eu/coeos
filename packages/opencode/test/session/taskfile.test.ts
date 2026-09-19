import { describe, expect, test } from "bun:test"
import { parse, serialize, hashTask } from "../../src/session/taskfile"
import type { TaskRun } from "@opencode-ai/schema/taskrun"

const tasks: TaskRun.Task[] = [
  {
    id: "T1",
    description: "Créer le module de parsing",
    role: "executor",
    status: "done",
    points: 3,
    deps: [],
    background: false,
    approved: true,
  },
  {
    id: "T2",
    description: "Brancher l'UI (avec, virgules) et parenthèses",
    role: "executor",
    status: "doing",
    points: 5,
    deps: ["T1"],
    background: false,
    approved: true,
  },
  {
    id: "T3",
    description: "Doc indépendante",
    role: "executor",
    status: "todo",
    points: 1,
    deps: [],
    background: true,
    approved: false,
  },
]

describe("taskfile", () => {
  test("serialize -> parse roundtrip préserve tâches, statuts, deps, approbation", () => {
    const approved = new Set(tasks.filter((t) => t.approved).map((t) => hashTask(t)))
    const raw = serialize({ title: "Mon plan", approved, tasks })
    const doc = parse(raw)
    expect(doc.title).toBe("Mon plan")
    expect(doc.tasks).toHaveLength(3)
    expect(doc.tasks[0]).toMatchObject({ id: "T1", status: "done", approved: true, points: 3 })
    expect(doc.tasks[1]).toMatchObject({ id: "T2", status: "doing", approved: true, deps: ["T1"] })
    expect(doc.tasks[1].description).toBe("Brancher l'UI (avec, virgules) et parenthèses")
    expect(doc.tasks[2]).toMatchObject({ id: "T3", status: "todo", approved: false, background: true })
  })

  test("une tâche reformulée à la main perd son approbation (hash)", () => {
    const approved = new Set(tasks.map((t) => hashTask(t)))
    const raw = serialize({ title: "Plan", approved, tasks })
    const edited = raw.replace("Doc indépendante", "Doc indépendante ET déploiement prod")
    const doc = parse(edited)
    expect(doc.tasks[2].approved).toBe(false)
    expect(doc.tasks[0].approved).toBe(true)
  })

  test("une tâche ajoutée à la main est non approuvée", () => {
    const approved = new Set(tasks.map((t) => hashTask(t)))
    const raw = serialize({ title: "Plan", approved, tasks })
    const edited = raw + "- [ ] T4 (role: executor) Tâche ajoutée après GO\n"
    const doc = parse(edited)
    expect(doc.tasks).toHaveLength(4)
    expect(doc.tasks[3]).toMatchObject({ id: "T4", approved: false, status: "todo" })
  })

  test("les statuts édités à la main sont lus (rayer = done)", () => {
    const raw = serialize({ title: "Plan", approved: new Set(), tasks })
    const edited = raw.replace("- [ ] T3", "- [x] T3")
    const doc = parse(edited)
    expect(doc.tasks[2].status).toBe("done")
  })
})
