import path from "path"
import fs from "fs/promises"
import matter from "gray-matter"
import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import * as InstanceState from "@/effect/instance-state"
import { Format } from "@/format"
import { Global } from "@opencode-ai/core/global"
import { LSP } from "@/lsp/lsp"
import { Vcs } from "@/project/vcs"
import { Skill } from "@/skill"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ApiVcsApplyError } from "../groups/instance"
import { markInstanceForDisposal } from "../lifecycle"

export const instanceHandlers = HttpApiBuilder.group(InstanceHttpApi, "instance", (handlers) =>
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const command = yield* Command.Service
    const format = yield* Format.Service
    const lsp = yield* LSP.Service
    const skill = yield* Skill.Service
    const vcs = yield* Vcs.Service

    const dispose = Effect.fn("InstanceHttpApi.dispose")(function* () {
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return true
    })

    const getPath = Effect.fn("InstanceHttpApi.path")(function* () {
      const ctx = yield* InstanceState.context
      return {
        home: Global.Path.home,
        state: Global.Path.state,
        config: Global.Path.config,
        worktree: ctx.worktree,
        directory: ctx.directory,
      }
    })

    const getVcs = Effect.fn("InstanceHttpApi.vcs")(function* () {
      const [branch, default_branch] = yield* Effect.all([vcs.branch(), vcs.defaultBranch()], {
        concurrency: "unbounded",
      })
      return { branch, default_branch }
    })

    const getVcsStatus = Effect.fn("InstanceHttpApi.vcsStatus")(function* () {
      return yield* vcs.status()
    })

    const getVcsDiff = Effect.fn("InstanceHttpApi.vcsDiff")(function* (ctx: {
      query: { mode: Vcs.Mode; context?: number }
    }) {
      return yield* vcs.diff(ctx.query.mode, { context: ctx.query.context })
    })

    const getVcsDiffRaw = Effect.fn("InstanceHttpApi.vcsDiffRaw")(function* () {
      return yield* vcs.diffRaw()
    })

    const applyVcs = Effect.fn("InstanceHttpApi.vcsApply")(function* (ctx: { payload: Vcs.ApplyInput }) {
      return yield* vcs.apply(ctx.payload).pipe(
        Effect.mapError(
          (error) =>
            new ApiVcsApplyError({
              name: "VcsApplyError",
              data: {
                message: error.message,
                reason: error.reason,
              },
            }),
        ),
      )
    })

    const getCommand = Effect.fn("InstanceHttpApi.command")(function* () {
      return yield* command.list()
    })

    const getAgent = Effect.fn("InstanceHttpApi.agent")(function* () {
      return yield* agent.list()
    })

    // coeos-code v2 (WU5) : agent builder — génération LLM + écriture du fichier
    // .opencode/agent/<name>.md (même mécanique que `opencode agent create`).
    const agentGenerate = Effect.fn("InstanceHttpApi.agentGenerate")(function* (ctx: {
      payload: { description: string }
    }) {
      return yield* agent.generate({ description: ctx.payload.description }).pipe(Effect.orDie)
    })

    const agentSave = Effect.fn("InstanceHttpApi.agentSave")(function* (ctx: {
      payload: { name: string; description?: string; mode?: "subagent" | "primary" | "all"; model?: string; prompt: string }
    }) {
      const instance = yield* InstanceState.context
      // nom = un seul segment de chemin, jamais de traversal
      const name = ctx.payload.name.trim()
      if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) return yield* Effect.die(new Error(`Invalid agent name: ${name}`))
      const frontmatter: Record<string, unknown> = {}
      if (ctx.payload.description) frontmatter.description = ctx.payload.description
      if (ctx.payload.mode) frontmatter.mode = ctx.payload.mode
      if (ctx.payload.model) frontmatter.model = ctx.payload.model
      const content = matter.stringify(ctx.payload.prompt, frontmatter)
      const dir = path.join(instance.worktree, ".opencode", "agent")
      const file = path.join(dir, `${name}.md`)
      yield* Effect.promise(async () => {
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(file, content)
      })
      return { path: file }
    })

    const getSkill = Effect.fn("InstanceHttpApi.skill")(function* () {
      return yield* skill.all()
    })

    // coeos-code v2 : écrire une skill custom au format SKILL.md (frontmatter
    // name+description obligatoire — c'est ce que le scanner exige). Cible
    // user-level ~/.config/opencode/skill/<name>/SKILL.md (scanné par
    // OPENCODE_SKILL_PATTERN sur config.directories()).
    const skillSave = Effect.fn("InstanceHttpApi.skillSave")(function* (ctx: {
      payload: { name: string; content: string }
    }) {
      const name = ctx.payload.name.trim()
      if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) return yield* Effect.die(new Error(`Invalid skill name: ${name}`))
      const dir = path.join(Global.Path.config, "skill", name)
      const file = path.join(dir, "SKILL.md")
      yield* Effect.promise(async () => {
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(file, ctx.payload.content)
      })
      return { path: file }
    })

    const getLsp = Effect.fn("InstanceHttpApi.lsp")(function* () {
      return yield* lsp.status()
    })

    const getFormatter = Effect.fn("InstanceHttpApi.formatter")(function* () {
      return yield* format.status()
    })

    return handlers
      .handle("dispose", dispose)
      .handle("path", getPath)
      .handle("vcs", getVcs)
      .handle("vcsStatus", getVcsStatus)
      .handle("vcsDiff", getVcsDiff)
      .handle("vcsDiffRaw", getVcsDiffRaw)
      .handle("vcsApply", applyVcs)
      .handle("command", getCommand)
      .handle("agent", getAgent)
      .handle("agentGenerate", agentGenerate)
      .handle("agentSave", agentSave)
      .handle("skill", getSkill)
      .handle("skillSave", skillSave)
      .handle("lsp", getLsp)
      .handle("formatter", getFormatter)
  }),
)
