# Nemo desktop

The Electron shell of Nemo, the CoeOS client. See the [repository README](../../README.md).

```bash
bun install
bun run dev                 # "Nemo Dev", unsigned, talks to the engine resolved at startup
../../scripts/build-nemo.sh # signed + notarized release ("Nemo"), from the repo root
```

Channels (`OPENCODE_CHANNEL`): `dev` → Nemo Dev, `beta` → Nemo Beta, `prod` → Nemo.
Product and executable names are pure ASCII on purpose: an accent in the bundle name
freezes Electron's `app.whenReady()` in a packaged build.
