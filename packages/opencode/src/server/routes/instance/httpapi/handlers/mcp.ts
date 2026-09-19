import path from "path"
import fs from "fs/promises"
import { MCP } from "@/mcp"
import { Global } from "@opencode-ai/core/global"
import { Effect, Schema } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { McpServerNotFoundError } from "../errors"
import { AddPayload, AuthCallbackPayload, RemovePayload, SavePayload, StatusMap, UnsupportedOAuthError } from "../groups/mcp"

// Fichier de config UTILISATEUR cible pour la persistance MCP (Settings, v2).
// On privilégie un opencode.json existant (json ou jsonc), sinon on crée
// opencode.json. On lit/merge/écrit le bloc `mcp[name]` sans toucher au reste.
async function userConfigPath(): Promise<string> {
  for (const file of ["opencode.jsonc", "opencode.json"]) {
    const p = path.join(Global.Path.config, file)
    try {
      await fs.access(p)
      return p
    } catch {}
  }
  return path.join(Global.Path.config, "opencode.json")
}

async function readUserConfig(p: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(p, "utf8")
    // tolérant : commentaires jsonc simples retirés avant parse
    const stripped = raw.replace(/^\s*\/\/.*$/gm, "")
    return JSON.parse(stripped || "{}") as Record<string, unknown>
  } catch {
    return {}
  }
}

export const mcpHandlers = HttpApiBuilder.group(InstanceHttpApi, "mcp", (handlers) =>
  Effect.gen(function* () {
    const mcp = yield* MCP.Service

    const status = Effect.fn("McpHttpApi.status")(function* () {
      return yield* mcp.status()
    })

    const add = Effect.fn("McpHttpApi.add")(function* (ctx: { payload: typeof AddPayload.Type }) {
      const result = (yield* mcp.add(ctx.payload.name, ctx.payload.config)).status
      return yield* Schema.decodeUnknownEffect(StatusMap)(
        "status" in result ? { [ctx.payload.name]: result } : result,
      ).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const save = Effect.fn("McpHttpApi.save")(function* (ctx: { payload: typeof SavePayload.Type }) {
      const { name, config } = ctx.payload
      // 1) persister dans la config utilisateur
      yield* Effect.promise(async () => {
        const p = await userConfigPath()
        const cfg = await readUserConfig(p)
        const mcpBlock = (cfg.mcp ?? {}) as Record<string, unknown>
        mcpBlock[name] = config
        cfg.mcp = mcpBlock
        await fs.mkdir(Global.Path.config, { recursive: true })
        await fs.writeFile(p, JSON.stringify(cfg, null, 2) + "\n")
      })
      // 2) connecter à chaud (même mécanique que `add`)
      const result = (yield* mcp.add(name, config)).status
      return yield* Schema.decodeUnknownEffect(StatusMap)("status" in result ? { [name]: result } : result).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
    })

    const remove = Effect.fn("McpHttpApi.remove")(function* (ctx: { payload: typeof RemovePayload.Type }) {
      const { name } = ctx.payload
      yield* mcp.disconnect(name).pipe(Effect.catchTag("MCP.NotFoundError", () => Effect.void))
      yield* Effect.promise(async () => {
        const p = await userConfigPath()
        const cfg = await readUserConfig(p)
        const mcpBlock = (cfg.mcp ?? {}) as Record<string, unknown>
        if (name in mcpBlock) {
          delete mcpBlock[name]
          cfg.mcp = mcpBlock
          await fs.writeFile(p, JSON.stringify(cfg, null, 2) + "\n")
        }
      })
      return true
    })

    const authStart = Effect.fn("McpHttpApi.authStart")(function* (ctx: { params: { name: string } }) {
      return yield* Effect.gen(function* () {
        if (!(yield* mcp.supportsOAuth(ctx.params.name))) {
          return yield* new UnsupportedOAuthError({ error: `MCP server ${ctx.params.name} does not support OAuth` })
        }
        return yield* mcp.startAuth(ctx.params.name)
      }).pipe(
        Effect.catchTag("MCP.NotFoundError", (error) =>
          Effect.fail(new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` })),
        ),
      )
    })

    const authCallback = Effect.fn("McpHttpApi.authCallback")(function* (ctx: {
      params: { name: string }
      payload: typeof AuthCallbackPayload.Type
    }) {
      return yield* mcp
        .finishAuth(ctx.params.name, ctx.payload.code)
        .pipe(
          Effect.catchTag("MCP.NotFoundError", (error) =>
            Effect.fail(
              new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` }),
            ),
          ),
        )
    })

    const authAuthenticate = Effect.fn("McpHttpApi.authAuthenticate")(function* (ctx: { params: { name: string } }) {
      return yield* Effect.gen(function* () {
        if (!(yield* mcp.supportsOAuth(ctx.params.name))) {
          return yield* new UnsupportedOAuthError({ error: `MCP server ${ctx.params.name} does not support OAuth` })
        }
        return yield* mcp.authenticate(ctx.params.name)
      }).pipe(
        Effect.catchTag("MCP.NotFoundError", (error) =>
          Effect.fail(new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` })),
        ),
      )
    })

    const authRemove = Effect.fn("McpHttpApi.authRemove")(function* (ctx: { params: { name: string } }) {
      const status = yield* mcp.status()
      if (!(ctx.params.name in status))
        return yield* new McpServerNotFoundError({
          name: ctx.params.name,
          message: `MCP server not found: ${ctx.params.name}`,
        })
      yield* mcp.removeAuth(ctx.params.name)
      return { success: true as const }
    })

    const connect = Effect.fn("McpHttpApi.connect")(function* (ctx: { params: { name: string } }) {
      yield* mcp
        .connect(ctx.params.name)
        .pipe(
          Effect.catchTag("MCP.NotFoundError", (error) =>
            Effect.fail(
              new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` }),
            ),
          ),
        )
      return true
    })

    const disconnect = Effect.fn("McpHttpApi.disconnect")(function* (ctx: { params: { name: string } }) {
      yield* mcp
        .disconnect(ctx.params.name)
        .pipe(
          Effect.catchTag("MCP.NotFoundError", (error) =>
            Effect.fail(
              new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` }),
            ),
          ),
        )
      return true
    })

    return handlers
      .handle("status", status)
      .handle("add", add)
      .handle("save", save)
      .handle("remove", remove)
      .handle("authStart", authStart)
      .handle("authCallback", authCallback)
      .handle("authAuthenticate", authAuthenticate)
      .handle("authRemove", authRemove)
      .handle("connect", connect)
      .handle("disconnect", disconnect)
  }),
)
