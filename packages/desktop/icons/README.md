# Icônes Nemo

Source unique : `source/nemo-helmet.svg` (scaphandre, carré arrondi 1024 plein cadre) et
`source/nemo-helmet-mono.svg` (trait seul, `currentColor`, pour la barre de menus et les
badges). Les jeux `dev/`, `beta/`, `prod/` sont GÉNÉRÉS, ne pas les retoucher à la main.

```bash
python3 packages/desktop/icons/source/make-icons.py   # PIL requis ; rasterisation par QuickLook (macOS)
```

Le script produit, par canal :

- plein cadre (Windows / Linux / source) : `icon.png` 1024, `32x32`, `64x64`, `128x128`, `128x128@2x`,
  `Square*Logo`, `StoreLogo`, `icon.ico` ;
- macOS : `icon.icns` via `iconutil` (carré de 824 px centré dans 1024 + ombre douce, l'inset
  attendu par le Dock) et `dock.png` 256 (même inset, utilisé par `app.dock.setIcon()` hors
  packaging) ;
- et, une fois : `packages/app/public/favicon-v3.{svg,png,ico}` et le logo in-app
  `packages/ui/src/assets/codeos-splash.png` (512, plein cadre).

Les canaux ne diffèrent que par le fond : bleu profond (`prod`), vert-bleu (`beta`), graphite
(`dev`), pour les distinguer dans le Dock. Les teintes sont dans `CHANNELS` du script.

`android/` et `ios/` sont des restes de Tauri, non utilisés par electron-builder.
