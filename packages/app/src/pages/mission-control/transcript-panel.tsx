// Panneau droit — transcript live de la session sélectionnée.
// La route top-level n'a pas de SDKProvider dir-scopé : on le monte ici avec
// la directory portée par les événements SSE (e.name), puis le DataProvider de
// session-ui — même contrat que pages/directory-layout.tsx.
import { createEffect, createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { DataProvider } from "@opencode-ai/session-ui/context"
import { Message } from "@opencode-ai/session-ui/message-part"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { SDKProvider } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import type { MissionRun } from "./state"

export type TranscriptTarget = { directory: string; sessionID: string }

function TranscriptView(props: { directory: string; sessionID: string }) {
  const sync = useSync()
  const serverSync = useServerSync()
  const navigate = useNavigate()

  // Hydrate l'historique, puis épingle la session : les événements message.*
  // ne sont retenus que pour les sessions pinnées ou récentes.
  onMount(() => {
    void sync()
      .session.sync(props.sessionID)
      .catch(() => {})
  })
  createEffect(() => {
    const sessionID = props.sessionID
    serverSync().session.pin(sessionID)
    onCleanup(() => serverSync().session.unpin(sessionID))
  })

  const messages = createMemo(() => sync().data.message[props.sessionID] ?? [])

  const slug = createMemo(() => base64Encode(props.directory))
  const href = (sessionID: string) => `/${slug()}/session/${sessionID}`

  // Suivi du flux : on colle au bas tant que l'utilisateur n'a pas remonté.
  let viewport: HTMLDivElement | undefined
  let follow = true
  const scrollToBottom = () => {
    if (!viewport || !follow) return
    viewport.scrollTop = viewport.scrollHeight
  }
  onMount(() => {
    // Les deltas de texte streament sans changer le nombre de parts : un tick
    // discret garde le bas de page pendant la génération.
    const timer = setInterval(scrollToBottom, 750)
    onCleanup(() => clearInterval(timer))
  })
  createEffect(() => {
    // Nouveau message ou nouvelle part sur le dernier message → re-scroll.
    const items = messages()
    const last = items[items.length - 1]
    if (last) void (sync().data.part[last.id] ?? []).length
    queueMicrotask(scrollToBottom)
  })

  return (
    <DataProvider
      data={sync().data}
      directory={props.directory}
      onNavigateToSession={(sessionID) => navigate(href(sessionID))}
      onSessionHref={href}
    >
      <ScrollView
        class="min-h-0 flex-1 select-text"
        viewportRef={(el) => (viewport = el)}
        onScroll={() => {
          if (!viewport) return
          follow = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 64
        }}
      >
        <div class="mx-auto flex w-full max-w-[840px] flex-col gap-4 px-4 py-5 md:px-6">
          <Show
            when={messages().length > 0}
            fallback={
              <div class="flex items-center justify-center gap-2 py-16 text-12-regular text-v2-text-text-muted">
                <LoaderV2 />
                <span>Waiting for the first message…</span>
              </div>
            }
          >
            <For each={messages()}>
              {(message) => (
                <Message
                  message={message}
                  parts={sync().data.part[message.id] ?? []}
                  showReasoningSummaries
                  useV2Actions
                />
              )}
            </For>
          </Show>
        </div>
      </ScrollView>
    </DataProvider>
  )
}

export function TranscriptPanel(props: { run?: MissionRun; target?: TranscriptTarget }) {
  return (
    <section class="flex min-h-0 min-w-0 flex-col bg-v2-background-bg-base">
      <header class="flex h-12 shrink-0 items-center gap-2 border-b border-v2-border-border-base px-4">
        <span class="text-11-medium uppercase tracking-[0.08em] text-v2-text-text-faint">Transcript</span>
        <Show when={props.run}>
          {(run) => (
            <span class="flex min-w-0 items-baseline gap-2">
              <span class="shrink-0 font-mono text-12-medium text-v2-text-text-base">{run().taskId}</span>
              <span class="truncate text-12-regular text-v2-text-text-muted">{run().role}</span>
            </span>
          )}
        </Show>
        <Show when={props.target}>
          {(target) => (
            <span class="ml-auto truncate font-mono text-11-regular text-v2-text-text-faint">{target().sessionID}</span>
          )}
        </Show>
      </header>
      <Show
        when={props.target}
        keyed
        fallback={
          <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div class="flex size-10 items-center justify-center rounded-full bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
              <Icon name="monitor" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-13-medium text-v2-text-text-base">No agent selected</span>
              <span class="text-12-regular text-v2-text-text-muted">
                Select a running agent to follow its transcript live.
              </span>
            </div>
          </div>
        }
      >
        {(target) => (
          <SDKProvider directory={target.directory}>
            <TranscriptView directory={target.directory} sessionID={target.sessionID} />
          </SDKProvider>
        )}
      </Show>
    </section>
  )
}
