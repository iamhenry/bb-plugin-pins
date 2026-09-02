# Pins

A [BB](https://getbb.app) plugin that shows pinned in-progress threads side by side in a horizontal strip.

Left rail → **Pins**. Drag a column header to reorder (BB pin order). **+** next to the title starts a new pinned thread.

## Install

```sh
bb plugin install git:https://github.com/iamhenry/bb-plugin-pins.git --yes
```

From a local checkout:

```sh
npm install
bb plugin install . --yes
```

Requires BB `>=0.39`. Git installs need `npm` on PATH (BB builds the app bundle at install time).

Reload after edits:

```sh
bb plugin reload pins
```

## Marketplace (GitHub, not npm)

BB’s catalog is [get-bb/marketplace](https://github.com/get-bb/marketplace). A catalog refresh does **not** install anything; users still install themselves.

To list Pins there:

1. Tag a release (`v0.1.0`) on this repo.
2. Fork the marketplace repo.
3. Add `entries/pins.json` (file name = plugin id `pins`).
4. Open a pull request.

```json
{
  "id": "pins",
  "displayName": "Pins",
  "description": "Pinned threads in a horizontal live-chat strip. Drag headers to reorder.",
  "icon": "Pin",
  "tags": ["pins", "threads", "layout"],
  "author": {
    "name": "Henry Moran",
    "github": "iamhenry",
    "url": "https://github.com/iamhenry"
  },
  "category": "thread-management",
  "source": {
    "git": {
      "url": "https://github.com/iamhenry/bb-plugin-pins.git",
      "range": "^0.1.0"
    }
  }
}
```

`source.git` must be a public Git repo (or npm). Do not use npm unless you publish a package.

## License

MIT
