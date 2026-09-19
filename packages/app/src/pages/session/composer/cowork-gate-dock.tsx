import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/session-ui/dock-prompt"

// Gate du mode Cowork : rendu entre deux etages du pipeline. C'est l'invariant
// de surete rendu visible — l'etage est fini, l'humain decide (rien n'avance
// tout seul). Copie de la forme de SessionPermissionDock.
export function CoworkGateDock(props: {
  stageLabel: string
  /** L'étage qui suit, avec sa lentille — pour décider en sachant ce qu'on lance. */
  nextLabel?: string
  nextLens?: string
  isLast: boolean
  onNext: () => void
  onStop: () => void
}) {
  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <div data-slot="permission-header-title">Cowork · {props.stageLabel}</div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions">
            <Button variant="ghost" size="normal" onClick={() => props.onStop()}>
              Stop (keep current state)
            </Button>
            <Button variant="primary" size="normal" onClick={() => props.onNext()}>
              {props.isLast ? "Finish" : props.nextLabel ? `Run ${props.nextLabel}` : "Next step"}
            </Button>
          </div>
        </>
      }
    >
      <div data-slot="permission-row">
        <span data-slot="permission-spacer" aria-hidden="true" />
        <div data-slot="permission-hint">
          Stage complete. Review the output above, then decide — nothing is approved automatically.
          {props.nextLens ? ` Next: ${props.nextLens}.` : ""}
        </div>
      </div>
    </DockPrompt>
  )
}
