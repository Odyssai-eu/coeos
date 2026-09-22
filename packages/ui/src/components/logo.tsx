import { type ComponentProps } from "solid-js"
import codeosSplash from "../assets/codeos-splash.png"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-logo-mark-shadow" d="M12 16H4V8H12V16Z" fill="var(--icon-weak-base)" />
      <path data-slot="logo-logo-mark-o" d="M12 4H4V16H12V4ZM16 20H0V0H16V20Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

// coeos-code (identité visible, ADR 0001) : le splash de démarrage affiche
// l'icône coeos-code (octopus) à la place du logo opencode. Les callers passent
// des classes dimensionnées pour l'ancien ratio 4:5 (w-16 h-20) —
// object-contain garde l'octopus carré centré sans distorsion.
export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <img
      ref={props.ref as ComponentProps<"img">["ref"]}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class, "object-contain": true }}
      src={codeosSplash}
      alt="coeos-code"
      draggable={false}
    />
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 234 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      {/* coeos-nemo (identité visible) : wordmark COEOS à la place d'opencode. */}
      <text
        x="0"
        y="34"
        textLength="234"
        lengthAdjust="spacingAndGlyphs"
        font-family="ui-sans-serif, system-ui, -apple-system, sans-serif"
        font-weight="800"
        font-size="36"
        letter-spacing="1"
        fill="var(--icon-strong-base)"
      >
        COEOS
      </text>
    </svg>
  )
}
