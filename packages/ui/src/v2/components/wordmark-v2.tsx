import { createUniqueId, type ComponentProps } from "solid-js"

export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  // coeos-nemo (identité visible) : wordmark COEOS à la place d'opencode, en
  // conservant le fondu vertical (masque dégradé) et l'opacité douce d'origine.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720.002 129.001"
      fill="none"
      preserveAspectRatio="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g opacity="0.16" mask={`url(#${mask})`}>
        <text
          x="0"
          y="104"
          textLength="720"
          lengthAdjust="spacingAndGlyphs"
          font-family="ui-sans-serif, system-ui, -apple-system, sans-serif"
          font-weight="800"
          font-size="118"
          letter-spacing="2"
          fill="currentColor"
        >
          COEOS
        </text>
      </g>
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="720" height="129">
          <rect width="720" height="129" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="360" y1="0" x2="360" y2="112" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
