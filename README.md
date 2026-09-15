# 360° Virtual Tour

An interactive, photo-based 360° virtual tour built with [Marzipano](https://www.marzipano.net/),
plain HTML, CSS and JavaScript. No build step, no framework, no backend — copy the folder
onto any static host and it runs.

The whole tour is described by one file: **`config/tour.json`**. Adding a room, connecting
two rooms, placing a pin on the floor plan or adding a video never requires touching the
JavaScript — and the built-in editor writes that file for you.

---

## Contents

1. [Quick start](#1-quick-start)
2. [Project structure](#2-project-structure)
3. [The panoramas in this project](#3-the-panoramas-in-this-project)
4. [Editing the tour](#4-editing-the-tour) — scenes, hotspots, videos, info panels, minimap
5. [The editor (`?edit=1`)](#5-the-editor-edit1)
6. [Settings reference](#6-settings-reference)
7. [Replacing the sample assets](#7-replacing-the-sample-assets)
8. [Equirectangular vs multiresolution](#8-equirectangular-vs-multiresolution)
9. [Preparing multiresolution tiles](#9-preparing-multiresolution-tiles)
10. [Deploying](#10-deploying)
11. [Testing checklist](#11-testing-checklist)
12. [Known limitations and TODOs](#12-known-limitations-and-todos)

---

## 1. Quick start

### Just double-click

| Your computer | Double-click this |
| --- | --- |
| **Windows** | **`start-windows.bat`** |
| **macOS / Linux** | **`start-macos.command`** |

A small window opens, the tour launches in your browser, and that is it. Close the window
(or press `Ctrl+C` in it) to stop.

> **macOS, first time only.** macOS will not run a file it does not consider executable.
> Open Terminal in this folder once and run `chmod +x start-macos.command`. After that,
> double-clicking works forever. If you would rather not, you can always start it with
> `bash start-macos.command`.

**Why is a launcher needed at all?** The tour reads `config/tour.json` with `fetch()`, which
every browser blocks on `file://` pages. So `index.html` cannot simply be opened from
Finder or Explorer — it has to be served over `http://`. The launcher starts a tiny local
server for exactly that and nothing else.

**What it needs installed:** either **Python 3** or **Node.js** — whichever you already
have. The launcher checks for both and uses the first it finds. If neither is present it
prints download links and stops. Nothing else is ever installed; the tour itself has no
dependencies.

### Options

Both launchers pass their arguments straight through:

```bash
start-windows.bat --edit          # open directly into the editor, and let it save
start-windows.bat --lan           # also reachable from a phone on the same Wi-Fi
start-windows.bat --port 9000     # choose the port
start-windows.bat --no-browser    # do not open a browser

./start-macos.command --edit      # same flags on macOS
```

`--edit` does two things: it opens the browser at `?edit=1`, and it lets the local server
accept `PUT /api/tour-config`, which is how the editor's **저장 (Save)** button writes
`config/tour.json`. Without `--edit` the server is strictly read-only, so nothing can
overwrite the tour by accident. Combining `--edit` with `--lan` exposes that write endpoint
to everyone on the network — fine at a desk, not on a café Wi-Fi.

`--lan` is the quick way to check the tour on a real phone: it prints an address like
`http://192.168.0.14:8000/` that you type into the phone's browser while on the same Wi-Fi.
If the port is busy the server quietly moves to the next free one.

### Starting it by hand

If you prefer a terminal, or you are on a server:

```bash
python3 tools/serve.py            # same server the launchers use
node    tools/serve.js            # identical Node version, used when Python is absent

# or any other static server, e.g.
python -m http.server 8000
npx serve .
```

Then open **<http://localhost:8000/>**.

| URL | What it does |
| --- | --- |
| `http://localhost:8000/` | Opens the default scene |
| `http://localhost:8000/?scene=scene02` | Opens a specific scene |
| `http://localhost:8000/#scene02` | Same, using a hash |
| `http://localhost:8000/?edit=1` | Opens the tour **plus the editor** |

An unknown scene id falls back to the default scene and logs a warning — it never breaks
the page.

---

## 2. Project structure

```
/
├── start-windows.bat           ← double-click on Windows
├── start-macos.command         ← double-click on macOS / Linux
├── index.html                  page shell + UI markup
├── css/style.css               all styling
├── js/
│   ├── app.js                  bootstrap: loads config, wires everything, URL routing
│   ├── config.js               loads + validates tour.json (no Marzipano, no DOM)
│   ├── tour.js                 THE ONLY FILE THAT CALLS MARZIPANO
│   ├── hotspots.js             builds the DOM element for each hotspot type
│   ├── minimap.js              floor plan + pins, bottom right
│   ├── modal.js                accessible dialog + YouTube embed + info content
│   ├── ui.js                   scene title, scene menu, fullscreen, loader, errors
│   └── editor.js               ?edit=1 developer tool
├── config/
│   └── tour.json               ← the entire tour lives here
├── assets/
│   ├── icons/                  pin.svg + pin-active.svg (minimap), optional hotspot icons
│   ├── source-map/             floor plan used by the minimap
│   ├── source-panoramas/       ORIGINAL 8192×4096 photos — never modified
│   └── panoramas/
│       ├── equirect/           web-sized copies the tour actually loads
│       └── multires/           cube tiles (scene06 generated as a working example)
├── tools/
│   ├── serve.py                local web server the launchers use (Python)
│   ├── serve.js                the same server for machines without Python (Node)
│   ├── make-web-equirect.ps1   source photos → web-sized equirectangular copies
│   └── make-multires.py        source photos → Marzipano cube tiles
├── vendor/marzipano.js         Marzipano 0.10.2, vendored (no CDN dependency)
└── README.md
```

**Architecture in three sentences.** `config.js` turns `tour.json` into a validated object
and drops anything that could not work, with a console warning explaining why. `tour.js` is
the only module that knows Marzipano exists, so swapping or upgrading the renderer touches
one file. Everything else — hotspots, modal, chrome, editor — is plain DOM code that talks
to `tour.js` through a handful of methods.

**Files you edit when adding a scene:** `config/tour.json`, and nothing else.

---

## 3. The panoramas in this project

`assets/source-panoramas/` holds **26** original photos: `001.jpg`–`024.jpg`, plus `009a.jpg`
and `011b.jpg` for second viewpoints inside rooms that needed two. Scene ids mirror the file
names, letter suffixes included, so the mapping stays obvious: `006.jpg` → `scene06`,
`011b.jpg` → `scene11b`.

All originals are 8192 × 4096 equirectangular JPEGs. **They are never read by the website
and are never modified** — they are the master copies that the two scripts in `tools/`
derive from.

The tour is ordered as a walk: arrive in the lobby, take in the café and the amenities, pass
the ticket gate into the B1 exhibition, work through the multi hall and the mural corridors,
and come out at the lifts.

| Scene id | Name | Source | Minimap x, y |
| --- | --- | --- | --- |
| `scene01` | 계단 상부 라운지 | `001.jpg` | 0.29, 0.86 |
| `scene06` | 중앙 로비 *(default)* | `006.jpg` | 0.46, 0.72 |
| `scene02` | 카페 | `002.jpg` | 0.63, 0.86 |
| `scene05` | 물품보관함 라운지 | `005.jpg` | 0.56, 0.78 |
| `scene03` | 편의시설 복도 | `003.jpg` | 0.8, 0.85 |
| `scene04` | 수유실 | `004.jpg` | 0.76, 0.79 |
| `scene07` | 전시 입구 | `007.jpg` | 0.4, 0.66 |
| `scene12` | 티켓 게이트 | `012.jpg` | 0.5, 0.63 |
| `scene08` | 멀티홀 인트로 | `008.jpg` | 0.46, 0.55 |
| `scene23` | 멀티홀 중앙 | `023.jpg` | 0.41, 0.46 |
| `scene09` | 영상 코너 | `009.jpg` | 0.34, 0.51 |
| `scene09a` | 영상 코너 안쪽 | `009a.jpg` | 0.29, 0.46 |
| `scene24` | 멀티홀 서편 | `024.jpg` | 0.33, 0.37 |
| `scene10` | 멀티홀 북편 | `010.jpg` | 0.25, 0.33 |
| `scene11` | 미디어 아카이브 | `011.jpg` | 0.19, 0.41 |
| `scene11b` | 아카이브 안쪽 | `011b.jpg` | 0.175, 0.31 |
| `scene13` | 암막 영상실 | `013.jpg` | 0.095, 0.55 |
| `scene14` | 영상 복도 | `014.jpg` | 0.095, 0.42 |
| `scene15` | 연결 복도 | `015.jpg` | 0.095, 0.28 |
| `scene16` | 벽화 갤러리 A | `016.jpg` | 0.17, 0.145 |
| `scene17` | 벽화 갤러리 B | `017.jpg` | 0.31, 0.145 |
| `scene18` | 벽화 갤러리 C | `018.jpg` | 0.45, 0.145 |
| `scene19` | 벽화 갤러리 D | `019.jpg` | 0.59, 0.145 |
| `scene20` | 퍼플 갤러리 | `020.jpg` | 0.78, 0.16 |
| `scene21` | 상영실 | `021.jpg` | 0.89, 0.4 |
| `scene22` | 엘리베이터 홀 | `022.jpg` | 0.9, 0.87 |

> **Scene names, connections and positions are a careful first pass, not surveyed fact.**
> The yaw/pitch of every arrow and every minimap coordinate was estimated from the photos
> and the floor plan rather than measured. Walk the tour with `?edit=1`, drag whatever sits
> wrong, and press 저장 — see [section 5](#5-the-editor-edit1).

---

## 4. Editing the tour

Everything below happens in `config/tour.json`. It is ordinary JSON: **no comments, no
trailing commas.** Keys beginning with `_` (like `_note`, `_source`) are ignored
by the app, so you can leave notes for yourself there.

Angles are in **radians**:

| | |
| --- | --- |
| `yaw` | left / right. `0` is the centre of the source photo. Range `-3.14` … `3.14`. |
| `pitch` | up / down. `0` is the horizon. **Positive is DOWN**, negative is up. |
| `fov` | vertical field of view. `1.4` ≈ 80°. Smaller = zoomed in. |

You never have to work these out by hand — see [the editor](#5-the-editor-edit1).

### 4.1 Adding a panorama

1. Put the original photo in `assets/source-panoramas/` (2:1 equirectangular JPEG).
2. Generate the web-sized copies:

   ```powershell
   pwsh tools/make-web-equirect.ps1
   ```

   This writes `sceneNN_0.jpg` (1024 px preview) and `sceneNN_1.jpg` (4096 px) into
   `assets/panoramas/equirect/`, derived from the file name: `020.jpg` → `scene20`,
   `020b.jpg` → `scene20b`. A letter suffix is how you add a second viewpoint in a room
   you have already numbered.
3. Add the scene to `tour.json` (next step).

### 4.2 Adding a scene

Append an object to the `"scenes"` array:

```json
{
  "id": "scene20",
  "name": "테라스",
  "panorama": {
    "type": "equirectangular",
    "url": "assets/panoramas/equirect/scene20_{z}.jpg",
    "levels": [{ "width": 1024 }, { "width": 4096 }]
  },
  "initialView": { "yaw": 0, "pitch": 0, "fov": 1.4 },
  "map": { "x": 0.5, "y": 0.5 },
  "hotspots": []
}
```

`{z}` is the resolution level; Marzipano fills it in with `0` for the small preview and `1`
for the full image, so the visitor sees something immediately while the large file arrives.

`map` is where the scene's pin sits on the minimap — see [4.7](#47-the-minimap). Leave it
out and the scene simply has no pin.

Reload the page — the scene appears in the scene menu straight away.

### 4.3 Connecting two scenes

A `"scene"` hotspot is a one-way door. Add one in each direction to make it two-way.

In `scene06`:

```json
{
  "id": "scene06-to-scene20",
  "type": "scene",
  "target": "scene20",
  "yaw": 1.25,
  "pitch": 0.25,
  "label": "테라스"
}
```

And the return trip, in `scene20`:

```json
{
  "id": "scene20-to-scene06",
  "type": "scene",
  "target": "scene06",
  "yaw": -1.9,
  "pitch": 0.25,
  "label": "중앙 로비"
}
```

`pitch` around `0.2`–`0.3` places the arrow slightly below the horizon, which reads as
"walk this way". Optionally add `"targetView": { "yaw": 0.5, "pitch": 0, "fov": 1.4 }` to
control which way the visitor is facing when they arrive.

If `target` names a scene that does not exist, the hotspot is removed at load time and a
console warning tells you which one — the tour still works.

### 4.4 Adding a YouTube hotspot

```json
{
  "id": "scene08-video",
  "type": "youtube",
  "videoId": "aqz-KE-bpKQ",
  "title": "Introduction film",
  "yaw": 0,
  "pitch": -0.05,
  "label": "Watch the intro film"
}
```

- `videoId` accepts either the bare 11-character id **or** a full YouTube URL
  (`https://youtu.be/…`, `…/watch?v=…`, `…/embed/…`, `…/shorts/…`). Anything else is
  rejected with a console warning rather than being pushed into an iframe.
- Add `"start": 30` to begin 30 seconds in.
- The iframe is created only when the hotspot is clicked and **destroyed when the modal
  closes**, so no video keeps playing in the background and the page never loads ten
  players at once.
- Embeds use `youtube-nocookie.com`.

### 4.5 Adding an info hotspot

```json
{
  "id": "scene07-info",
  "type": "info",
  "title": "Current exhibition",
  "content": "First paragraph.\n\nSecond paragraph.",
  "image": "assets/icons/info.svg",
  "yaw": -0.3,
  "pitch": -0.1,
  "label": "Exhibition information"
}
```

Blank lines (`\n\n`) start a new paragraph. Text is inserted with `textContent`, so HTML in
this field is shown literally rather than executed. `image` is optional.

### 4.6 Changing the initial camera direction

`initialView` is where the camera points when a scene opens. Open `?edit=1`, drag until the
view looks right and press **시작 화면으로 지정 (Use current view)**.

### 4.7 The minimap

The floor plan in the bottom-right corner is driven by `settings.minimap` plus one `map`
block per scene. Every scene with a `map` gets a pin; the scene you are standing in swaps to
the highlight pin and clicking any pin jumps to that scene.

```json
"minimap": {
  "enabled": true,
  "image": "assets/source-map/hm_map.png",
  "title": "B1 안내도",
  "pin": "assets/icons/pin.svg",
  "pinActive": "assets/icons/pin-active.svg",
  "width": 300,
  "startCollapsed": false
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | `false` hides the minimap without deleting the coordinates. |
| `image` | — | **Required.** Floor plan, any web image format. Without it the minimap turns itself off with a console warning. |
| `title` | `""` | Caption on the panel header. An empty string leaves just the collapse chevron. |
| `pin` | `assets/icons/pin.svg` | Pin for every scene. |
| `pinActive` | `assets/icons/pin-active.svg` | Pin for the scene currently on screen. |
| `width` | `260` | Panel width in px, clamped to 140–520. Narrow screens cap it further. |
| `startCollapsed` | `false` | Open the tour with the plan folded away. |

The two pins are separate SVG files rather than one file recoloured in CSS, so the highlight
colour is a decision you make in `assets/icons/` — swap in your own artwork and nothing in
the code needs to know. Keep both files the same size and shape: the pin's **tip** is what
lands on the coordinate, so a taller replacement will appear to sit somewhere else.

A scene's position is a fraction of the image, not a pixel:

```json
"map": { "x": 0.46, "y": 0.72 }
```

`x` runs 0 (left edge) → 1 (right edge), `y` runs 0 (top) → 1 (bottom). Fractions mean the
coordinates survive replacing the floor plan with a larger export. You do not have to work
them out: in `?edit=1`, drag the pin or click the plan.

---

## 5. The editor (`?edit=1`)

Add `?edit=1` to the URL — for example `http://localhost:8000/?edit=1` — and a panel appears
in the top-left. **It is never present without that query parameter**, so production
visitors cannot see it.

The editor changes the tour live: drag an arrow and it moves under your cursor, drag a pin
and the floor plan updates. Nothing is written to disk until you press **저장 (Save)**.

### What the panel does

```
편집기                     ← collapse with the – button
  장면   scene06           ← live camera readout, updates as you drag
  Yaw    0.25  (14.3°)
  Pitch  0.03  (1.7°)
  FOV    1.28  (73.4°)
  [시작 화면으로 지정]  [되돌리기]

이동 포인트                 3
  카페                     카페        ← click to select; hover to find it on screen
  계단 위 라운지            계단 상부 라운지
  전시 입구                 전시 입구
  [+ 이동 포인트 추가]
  종류 / 대상 장면 / 라벨    ← the selected point's fields
  yaw -1.4 · pitch 0.26  (-80.2° / 14.9°)
  [화면에서 위치 지정]  [삭제]

미니맵 위치
  x 0.46 · y 0.72
  [핀 없애기]

[저장]  [JSON 복사]  [내려받기]
```

### Moving a navigation point

**Drag it.** With the editor open every hotspot is draggable: press on the arrow, move, let
go. It follows the pointer across the panorama and the yaw/pitch readout updates as it goes.
A drag never triggers the arrow's own click, so you cannot accidentally navigate away.

Three other ways, for when dragging is awkward:

| Way | When it helps |
| --- | --- |
| **화면에서 위치 지정** then click the spot | The target is far from the arrow's current position |
| **Arrow keys** (`Shift` for bigger steps) | Final 1–2° of alignment. Press `Esc` to deselect and give the arrow keys back to the camera |
| Edit `yaw`/`pitch` in `tour.json` | You already know the numbers |

### Adding, retargeting and deleting

**+ 이동 포인트 추가** drops a new point in the middle of the current view, aimed at a scene
this one does not link to yet, and selects it. Set **대상 장면** (which scene it leads to)
and **라벨** (the caption on hover); both take effect immediately. **종류** switches a point
between a scene jump, a YouTube modal and an info panel. **삭제** removes the selected point.

### Moving a minimap pin

Drag the pin on the floor plan, or click any empty part of the plan to move the **current**
scene's pin there. `핀 없애기` removes the pin, leaving the scene reachable only from the
scene menu and its arrows. The readout shows the stored fraction, e.g. `x 0.46 · y 0.72`.

### Saving

| Button | What happens |
| --- | --- |
| **저장** | `PUT`s the whole file to the local server, which writes `config/tour.json` and keeps the previous version as `config/tour.json.bak` |
| **JSON 복사** | Copies the file to the clipboard |
| **내려받기** | Downloads `tour.json` for you to drop into `config/` yourself |

**저장 only works on a server started with `--edit`** (`tools/serve.py --edit`, or
`start-windows.bat --edit`). Any other server — including GitHub Pages — refuses the write,
and the editor says so and points you at 내려받기. Before writing, it checks that no scene
arrow points at a missing scene and no video hotspot is missing its id, because either would
silently vanish on the next reload; if one does, it names the problem and saves nothing.

The saved file is the file you had, with your edits in it: key order, `_source` notes,
comments in `_README` and the hand-tuned formatting all survive. A save that changes one
arrow produces a two-line diff.

---

## 6. Settings reference

The `"settings"` block at the top of `tour.json`:

| Key | Default | Meaning |
| --- | --- | --- |
| `defaultScene` | first scene | Scene shown when no `?scene=` is given. An unknown id falls back to the first scene. |
| `autorotate` | `false` | Slowly pan when the visitor is idle. |
| `autorotateIdleDelayMs` | `4000` | Idle time before autorotate starts. |
| `sceneMenu` | `true` | Show the ☰ scene list. |
| `fullscreen` | `true` | Show the fullscreen button *where the browser supports it*. |
| `showSceneName` | `true` | Show the scene name in the top-left. |
| `showHint` | `true` | Show "Drag to look around" on the first visit only. |
| `transitionDurationMs` | `500` | Cross-fade between scenes. `0` disables it. |
| `updateUrlOnSceneChange` | `true` | Keep `?scene=` in the address bar so any view is linkable. |
| `minFov` / `maxFov` | `0.45` / `1.85` | Zoom limits in radians. |
| `minimap` | *(none)* | Floor plan in the bottom-right. Its own keys are in [4.7](#47-the-minimap); omit the block entirely for no minimap. |

---

## 7. Replacing the sample assets

Two things in this repository still want a human eye:

| What | Where | Replace with |
| --- | --- | --- |
| Estimated arrow positions | every `yaw`/`pitch` in `tour.json` | positions dragged in `?edit=1` |
| Estimated minimap positions | every `map` block | pins dragged onto the floor plan |

There is no placeholder video or info text left in `tour.json` — the tour is 26 scene-to-scene
links and nothing else. Add videos and info panels as you need them ([4.4](#44-adding-a-youtube-hotspot),
[4.5](#45-adding-an-info-hotspot)).

The **hotspot** icons in `assets/icons/` (`arrow.svg`, `video.svg`, `info.svg`) are **not**
used by default — those icons are inlined in `js/hotspots.js` so they inherit colour and cost
no extra request. To use a custom image for one hotspot, add
`"icon": "assets/icons/my-icon.svg"` to it. The **minimap** pins are the opposite: `pin.svg`
and `pin-active.svg` are real files, loaded as images, precisely so you can restyle them
without touching code.

The floor plan is used exactly as it sits in `assets/source-map/` — it is already web-sized,
so unlike the panoramas it needs no derived copy. Swapping in a different plan means dropping
the file in, pointing `settings.minimap.image` at it, and re-placing the pins in `?edit=1`
(the stored fractions only stay right if the new plan frames the building the same way).

The favicon is an inline SVG in `index.html`; replace it with a real file if you prefer.

---

## 8. Equirectangular vs multiresolution

Both are supported, per scene, and can be mixed in one tour.

|  | **Equirectangular** *(current setup)* | **Multiresolution** |
| --- | --- | --- |
| What it is | one 2:1 JPEG per resolution level | the sphere cut into 6 cube faces, each split into a pyramid of small tiles |
| Files per scene | 2 | ~127 |
| Bytes per scene here | ~0.8 MB | ~2.5 MB total, but only the visible tiles download |
| First paint | whole image must arrive | a few KB of preview, then tiles stream in |
| Sharpness when zoomed | limited by the single texture (4096 px) | limited only by the tile pyramid (2048 px **per face**, ≈ 8192 px equirect equivalent) |
| GPU memory | one large texture, always resident | small tiles, only what is on screen |
| Best for | development, quick previews, small tours | production, high-resolution photos, mobile |

**Why the tour ships equirectangular today:** it is one file per scene, trivially editable,
and works immediately. **Why you should switch for production:** the source photos are
8192 px wide, and a single-texture equirect panorama has to be cut to 4096 px to stay within
safe mobile GPU texture limits — so half the detail you paid for is currently thrown away.
Multires keeps it.

### Recommended image dimensions

| Purpose | Size | Notes |
| --- | --- | --- |
| Source / master | **8192 × 4096** (what you have) | 2:1 exactly. Keep the originals. |
| Equirect, full level | 4096 × 2048 | safe on every GPU; ~0.5–1.2 MB at quality 3 |
| Equirect, preview level | 1024 × 512 | loads in a blink, hides the wait |
| Multires face size | 2048 | matches an 8192-wide source without upscaling |
| Multires tile size | 512 | Marzipano's convention; 256 also works |

A 2:1 aspect ratio is required. Anything else will look stretched.

---

## 9. Preparing multiresolution tiles

### Option A — the script in this repo *(verified against these photos)*

```bash
pip install pillow numpy

python tools/make-multires.py              # all 26 panoramas
python tools/make-multires.py 006 011b     # just these two
python tools/make-multires.py --face-size 1024   # smaller/faster
```

It writes, for each scene:

```
assets/panoramas/multires/sceneNN/
    preview.jpg           six faces stacked vertically, order b d f l r u
    0/<face>/0/0.jpg      512 px face  — single tile, used as the fallback level
    1/<face>/<y>/<x>.jpg  1024 px face — 2×2 tiles
    2/<face>/<y>/<x>.jpg  2048 px face — 4×4 tiles
```

Then change that scene's `panorama` block:

```json
"panorama": {
  "type": "multires",
  "path": "assets/panoramas/multires/scene06",
  "faceSize": 2048,
  "tileSize": 512
}
```

That is the only edit needed — nothing else in the config or the code changes.

**`scene06` has already been converted** as a working example. Paste the block above over
`scene06`'s `panorama` in `tour.json` and reload to see it. Expect roughly 30 s per
panorama.

If your tiles were produced by another tool with a different pyramid, you can spell the
levels out instead of using `faceSize`/`tileSize`:

```json
"levels": [
  { "tileSize": 512, "size": 512, "fallbackOnly": true },
  { "tileSize": 512, "size": 1024 },
  { "tileSize": 512, "size": 2048 }
]
```

Set `"preview": false` if there is no `preview.jpg`.

### Option B — the official Marzipano Tool

<https://www.marzipano.net/tool/> — drag the photos in, export, and copy the generated
`tiles/<id>/` folders into `assets/panoramas/multires/`. It produces the same layout
(`{z}/{f}/{y}/{x}.jpg` plus `preview.jpg`), so the config block above works unchanged. Useful
if you would rather not run Python.

### After converting

Re-run the tour and check a few scenes at full zoom and straight up/down. Once you are happy,
`assets/panoramas/equirect/` can be deleted — but keep `assets/source-panoramas/`, since
every derived format is regenerated from it.

---

## 10. Deploying

The site is fully static. There is nothing to build and no server-side code.

### GitHub Pages — already set up

**Live site: <https://jdlaboratory.github.io/vr-hm2609/>**

`.github/workflows/deploy-pages.yml` publishes the repository on every push to `main`.
Nothing to configure — the workflow turns Pages on by itself the first time it runs. To
redeploy without changing anything, open the **Actions** tab and run *Deploy to GitHub
Pages* manually.

The whole repository is published, `assets/source-panoramas/` included, so the ~28 MB of
originals are downloadable from the live site too. To stop publishing them later, add an
exclusion to the upload step in the workflow.

Because the site lives under `/vr-hm2609/` rather than at a domain root, **every path in
the project is relative** — `css/style.css`, `assets/panoramas/…`, `config/tour.json`.
Keep it that way: a leading `/` in any path would break the deployed site while still
working locally. The same trap applies to capitalisation, since GitHub Pages is
case-sensitive and Windows is not.

### Other hosts

**Cloudflare Pages** — connect the repo, set *Build command* to none/empty and
*Build output directory* to `/`. Or drag the folder into the dashboard.

**Vercel** — `vercel deploy` (or import the repo). Framework preset: **Other**. No build
command, output directory `.`.

**Netlify** — drag the folder onto <https://app.netlify.com/drop>, or connect the repo with
no build command and publish directory `.`.

**Amazon S3 + CloudFront** —

```bash
aws s3 sync . s3://your-bucket --exclude ".git/*" --exclude "assets/source-panoramas/*"
```

Enable static website hosting and put CloudFront in front of it.

**Any other host** — upload the folder. The only requirements are that the server sends
`.json` and `.js` with sensible content types (every mainstream host does) and that
directory listings are not required.

### Deployment notes

- **Do not upload `assets/source-panoramas/`.** It is ~30 MB of masters the site never
  loads. Exclude it, or keep it out of the deployed branch.
- `start-windows.bat`, `start-macos.command` and `tools/` are development helpers. They are
  harmless if uploaded (a static host will never execute them) but there is no reason to.
- The tiles and panoramas are immutable once generated — set a long `Cache-Control`
  (`max-age=31536000`) on `assets/**` and a short one on `config/tour.json` so content
  edits go live immediately.
- HTTPS matters for two features: the editor's **Copy** buttons use the Clipboard API
  (there is a select-the-text fallback), and the Fullscreen API is restricted on insecure
  origins. `localhost` counts as secure.

---

## 11. Testing checklist

The panorama rebuild, the minimap and every editing interaction below were driven through
headless Chrome against this build and passed. To re-check by hand after your edits:

| | Check | Expected |
| --- | --- | --- |
| A | Page loads | panorama fills the window |
| B | Default scene | `settings.defaultScene` is shown, URL gains `?scene=…` |
| C | Mouse drag / touch drag | view rotates; pinch zooms on touch |
| D | Click an arrow | scene changes with a short cross-fade |
| E | Click the return arrow | you are back where you started |
| F | Click a video hotspot | modal opens with a 16:9 player |
| G | Close the modal | **audio stops immediately** (the iframe is removed) |
| H | Press `Esc` | modal closes, focus returns to the hotspot |
| I | Narrow the window to 390 px | no horizontal scrollbar, minimap shrinks, modal still fits |
| J | Minimap | one pin per placed scene; the open scene's pin is the highlight colour |
| K | Click another pin | that scene loads and its pin becomes the highlighted one |
| L | Collapse the minimap | plan folds away, chevron rotates, tour unaffected |
| M | Add `?edit=1` | editor panel appears (and never appears without it) |
| N | Drag an arrow | it follows the pointer, yaw/pitch updates, and it does **not** navigate |
| O | Drag a minimap pin | pin moves, `미니맵 위치` readout updates |
| P | 저장 on a `--edit` server | `config/tour.json` rewritten, `.bak` kept, diff limited to what you changed |
| Q | 저장 on any other server | refused with a message, nothing lost — 내려받기 still works |
| R | `?scene=nonsense` | default scene loads, warning in console, no crash |
| S | Break a `videoId` in `tour.json` | that hotspot disappears with a warning; tour still works |
| T | Browser without fullscreen | button is hidden, not broken |

Accessibility: hotspots are real `<button>`s with `aria-label`s and are keyboard reachable;
the modal is a labelled `aria-modal` dialog with a focus trap and focus restoration; the
hotspot pulse and all transitions are disabled under `prefers-reduced-motion`.

---

## 12. Known limitations and TODOs

- **Arrow and pin positions are estimates.** Each arrow was aimed at the doorway visible in
  its photo and each pin dropped on the room it looked like, but nothing was surveyed. Walk
  the tour with `?edit=1`, drag what sits wrong and press 저장 — this is the main outstanding
  task, and the editor exists to make it quick.
- **Scene names are inferred from the photos** (카페, 수유실, 벽화 갤러리 A…). Rename them to
  whatever the client calls these spaces.
- **The floor plan covers B1 only.** `scene01` and `scene07` are around the stairs at the
  level above, and sit on the stair block of the plan for want of anywhere better. A second
  plan per floor would be the honest fix; `settings.minimap` currently takes one image.
- **26 pins on one small plan is dense.** In the multi hall the pins nearly touch. Fine to
  read, but if the tour grows, consider a larger `width` or grouping viewpoints.
- **Still on equirectangular.** Working and fast, but capped at 4096 px. Run
  `tools/make-multires.py` before launch to use the full 8192 px source detail — see
  section 9.
- **No videos or info panels yet.** The tour is navigation only; both hotspot types still
  work and are documented in 4.4 and 4.5.
- **No preloading of the next scene.** Marzipano loads a panorama when you arrive. A
  neighbour-preloading pass would make navigation feel instant, at the cost of bandwidth on
  mobile. Deliberately left out.
- **iPhone Safari has no element fullscreen**, so the fullscreen button hides itself there.
  That is the correct behaviour, not a bug.
- **`start-macos.command` needs `chmod +x` once** on each machine. macOS will not run a
  file it does not consider executable, and the permission bit is lost whenever the folder
  travels through a ZIP or a Windows filesystem. There is no way around this short of
  shipping a signed `.app` bundle.
- **The launchers are not standalone executables.** They need Python 3 or Node.js present.
  A true self-contained `.exe`/`.app` would mean adding a packaging toolchain, and a macOS
  binary cannot be built from Windows at all — so the launchers detect what is installed
  instead.
- **Autorotate is off** (`settings.autorotate: false`). Turn it on if you want the tour to
  drift when idle.
- **Gyroscope / device-orientation control is not implemented.** Marzipano supports it via
  an extra control method if you later want look-around-by-tilting on phones.
