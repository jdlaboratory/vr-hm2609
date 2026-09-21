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
4. [Editing the tour](#4-editing-the-tour) — scenes, hotspots, videos, info panels, minimap,
   title bar
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

| What you want | Windows | macOS / Linux |
| --- | --- | --- |
| **Show the tour** | **`start-windows.bat`** | **`start-macos.command`** |
| **Edit it** | **`start-editor-windows.bat`** | **`start-editor-macos.command`** |

A small window opens, the tour launches in your browser, and that is it. Close the window
(or press `Ctrl+C` in it) to stop.

`start-windows.bat` and `start-macos.command` serve the site **read-only** — nothing
reached through them can overwrite the tour, which is what you want when someone else is
looking at it.

The editor launchers are the same servers with editing switched on, and they differ from
each other:

| | `start-editor-windows.bat` | `start-editor-macos.command` |
| --- | --- | --- |
| Opens at `?edit=1` | yes | yes |
| Writes `config/tour.json` | when you press 저장 | **by itself, on every change** |
| Picks up edits to `css/`, `js/`, `index.html` | on a manual reload | **as soon as you save the file** |
| Flags it passes | `--edit` | `--autosave --live` |

Either one can have the other's behaviour — the flags are just flags, and
`./start-macos.command --edit` still gives you the plain button-press editor. See
[§1 Options](#options) for what each flag does, and
[Autosave and live reload](#autosave-and-live-reload) for how they behave while you
work.

> **macOS, first time only.** macOS will not run a file it does not consider executable.
> Open Terminal in this folder once and run
> `chmod +x start-macos.command start-editor-macos.command`. After that, double-clicking
> works forever. If you would rather not, you can always start either one with
> `bash start-macos.command`. (The editor launcher runs its companion through `bash`, so
> only the file you actually double-click needs the permission bit.)

**Why is a launcher needed at all?** The tour reads `config/tour.json` with `fetch()`, which
every browser blocks on `file://` pages. So `index.html` cannot simply be opened from
Finder or Explorer — it has to be served over `http://`. The launcher starts a tiny local
server for exactly that and nothing else.

**What it needs installed:** either **Python 3** or **Node.js** — whichever you already
have. The launcher checks for both and uses the first it finds. If neither is present it
prints download links and stops. Nothing else is ever installed; the tour itself has no
dependencies.

### Options

All four launchers pass their arguments straight through:

```bash
start-windows.bat --edit          # what start-editor-windows.bat does for you
start-windows.bat --lan           # also reachable from a phone on the same Wi-Fi
start-windows.bat --port 9000     # choose the port
start-windows.bat --no-browser    # do not open a browser

start-editor-windows.bat --lan    # editor, and reachable from a phone too

./start-macos.command --lan          # same flags on macOS
./start-editor-macos.command --lan   # editor there too

# the two the macOS editor launcher turns on for you
tools/serve.py --autosave         # editor saves every change itself (implies --edit)
tools/serve.py --live             # reload the open page when a source file changes
```

`--edit` does two things: it opens the browser at `?edit=1`, and it lets the local server
accept `PUT /api/tour-config`, which is how the editor's **저장 (Save)** button writes
`config/tour.json`. `--autosave` turns that button into a formality — the editor writes
every change by itself — and implies `--edit`, so you never have to pass both.
`--live` is unrelated to saving: it watches `index.html`, `css/` and `js/` and updates the
open page when you save one of them. (Two read-only companions, `GET /api/tour-config` and
`GET /api/panoramas`, answer on any local server: the editor uses them to tell you up front
whether saving will work, and which panoramas a new viewpoint could use.) Without `--edit` the server is strictly read-only, so nothing can
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
├── start-windows.bat           ← double-click on Windows (read-only)
├── start-editor-windows.bat    ← double-click on Windows to edit (saving on)
├── start-macos.command         ← double-click on macOS / Linux (read-only)
├── start-editor-macos.command  ← double-click on macOS / Linux to edit (autosave + live reload)
├── index.html                  page shell + UI markup
├── css/style.css               all styling
├── js/
│   ├── app.js                  bootstrap: loads config, wires everything, URL routing
│   ├── config.js               loads + validates tour.json (no Marzipano, no DOM)
│   ├── tour.js                 THE ONLY FILE THAT CALLS MARZIPANO
│   ├── hotspots.js             builds the DOM element for each hotspot type
│   ├── minimap.js              floor plan + pins, bottom right
│   ├── modal.js                accessible dialog + Vimeo embed + info content
│   ├── ui.js                   scene title, scene menu, fullscreen, loader, errors
│   ├── livereload.js           dev only: reloads the page when a source file changes
│   └── editor.js               ?edit=1 developer tool
├── config/
│   └── tour.json               ← the entire tour lives here
├── assets/
│   ├── icons/                  optional hotspot icons (the defaults are inlined in JS)
│   ├── meta/                   metaimg.png — the social sharing card
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
and `011b.jpg`. Scene ids mirror the file names, letter suffixes included, so the mapping
stays obvious: `006.jpg` → `scene06`, `011b.jpg` → `scene11b`.

**The tour uses 22 of them.** Four were dropped as second angles on rooms that already had
one: `009a` and `011b` never had web copies made, and `scene09` and `scene10` were taken out
of `tour.json` during the walk-through. Nothing was deleted —
`assets/panoramas/equirect/` still holds `scene09` and `scene10`, so either can be put back
by adding it again in `?edit=1` (**추가할 파노라마** lists exactly the panoramas that are on
disk but not in the tour), with no re-processing.

All originals are 8192 × 4096 equirectangular JPEGs. **They are never read by the website
and are never modified** — they are the master copies that the two scripts in `tools/`
derive from.

The tour is ordered as a walk: arrive at the top of the stairs, come down to the lobby, take
in the café and the amenities, pass the ticket gate into the B1 exhibition, work through the
multi hall and the mural corridors, and come out at the lifts.

| Scene id | Name | Source | Minimap x, y | Video point |
| --- | --- | --- | --- | --- |
| `scene01` | 계단 위 *(opens here)* | `001.jpg` | 0.2933, 0.884 | Asylum of the Birds |
| `scene07` | 전시 입구 | `007.jpg` | 0.2408, 0.6927 |  |
| `scene06` | 중앙 로비 | `006.jpg` | 0.3894, 0.6959 |  |
| `scene08` | 멀티홀 중앙 | `008.jpg` | 0.3186, 0.5078 | Theatre of Apparitions |
| `scene11` | 멀티홀 외벽1 | `011.jpg` | 0.1765, 0.3696 |  |
| `scene24` | 멀티홀 외벽2 | `024.jpg` | 0.315, 0.3173 |  |
| `scene23` | 멀티홀 외벽3 | `023.jpg` | 0.4504, 0.3397 | Roger the Rat |
| `scene12` | 티켓 게이트 | `012.jpg` | 0.1442, 0.6617 |  |
| `scene13` | 복도 1 | `013.jpg` | 0.1026, 0.4907 |  |
| `scene14` | 복도 2 | `014.jpg` | 0.1042, 0.3148 | I Fink U Freeky |
| `scene15` | 복도 3 | `015.jpg` | 0.1042, 0.139 |  |
| `scene17` | 벽화 갤러리 1 | `017.jpg` | 0.2384, 0.1398 |  |
| `scene16` | 벽화 갤러리 2 | `016.jpg` | 0.3621, 0.1417 |  |
| `scene18` | 벽화 갤러리 3 | `018.jpg` | 0.5006, 0.138 |  |
| `scene19` | 벽화 갤러리 4 | `019.jpg` | 0.655, 0.1342 |  |
| `scene20` | 미디어 갤러리 1 | `020.jpg` | 0.8787, 0.1772 | Ballenesque |
| `scene21` | 미디어 갤러리 2 | `021.jpg` | 0.8811, 0.4312 | Outland |
| `scene22` | 엘리베이터 홀 | `022.jpg` | 0.8934, 0.6759 |  |
| `scene05` | 정원 입구 | `005.jpg` | 0.8027, 0.6143 |  |
| `scene03` | 화장실 앞 | `003.jpg` | 0.8039, 0.7544 |  |
| `scene04` | 수유실 | `004.jpg` | 0.8301, 0.9084 |  |
| `scene02` | 카페 | `002.jpg` | 0.6442, 0.7228 |  |

**22 scenes, 58 hotspots:** 52 scene-to-scene arrows and 6 Vimeo points. The tour opens at the top of this list.

> **Names and positions have been worked over in the editor, but never surveyed.** Every
> arrow angle and every minimap coordinate began as an estimate read off the photos and the
> floor plan; many have since been dragged into place in `?edit=1`, and the scene names are
> the ones chosen during that pass. If something still sits wrong, drag it and press 저장 —
> see [section 5](#5-the-editor-edit1).

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
   `assets/panoramas/equirect/`, derived from the file name: `025.jpg` → `scene25`,
   `025b.jpg` → `scene25b`. A letter suffix is how you add a second viewpoint in a room
   you have already numbered.
3. Add the scene to `tour.json` (next step).

### 4.2 Adding a scene

Append an object to the `"scenes"` array:

```json
{
  "id": "scene25",
  "name": "테라스",
  "panorama": {
    "type": "equirectangular",
    "url": "assets/panoramas/equirect/scene25_{z}.jpg",
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
  "id": "scene06-to-scene25",
  "type": "scene",
  "target": "scene25",
  "yaw": 1.25,
  "pitch": 0.25,
  "label": "테라스"
}
```

And the return trip, in `scene25`:

```json
{
  "id": "scene25-to-scene06",
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

### 4.4 Adding a Vimeo hotspot

```json
{
  "id": "scene08-video",
  "type": "vimeo",
  "videoId": "https://vimeo.com/76979871/abc123def4",
  "title": "Introduction film",
  "yaw": 0,
  "pitch": -0.05,
  "label": "Watch the intro film"
}
```

- `videoId` accepts the bare numeric id (`76979871`), `id/hash`, or a full Vimeo address —
  `https://vimeo.com/…`, `…/channels/name/…`, `…/groups/name/videos/…`,
  `https://player.vimeo.com/video/…?h=…`. Anything else is rejected with a console warning
  rather than being pushed into an iframe.
- **Unlisted videos need their privacy hash.** It is the second part of the share link
  (`vimeo.com/76979871/abc123def4`) or the `?h=` parameter. Paste the whole address and the
  hash is kept for you; paste only the id and an unlisted video will refuse to play.
- **Up to two videos per hotspot.** Add `"videoId2"` (same formats as `videoId`) and an
  optional `"title2"`, and the dialog stacks the two players vertically — `title` above the
  first, `title2` above the second. Only the first autoplays. An invalid `videoId2` drops
  just the second video; the first still plays.
- Add `"start": 30` to begin 30 seconds in.
- The iframe is created only when the hotspot is clicked and **destroyed when the modal
  closes**, so no video keeps playing in the background and the page never loads ten
  players at once.
- The player is asked not to track the visitor (`dnt=1`), and the byline, portrait and
  title overlays are turned off.
- On the panorama a video point wears the same dark circle as a 이동 포인트; only the
  glyph differs — an oversized white play triangle (44px against the 22px the other types
  share) that reads as a film without breaking the family. See
  `.hotspot-video .hotspot-icon svg` in `css/style.css`.

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

The floor plan is driven by `settings.minimap` plus one `map` block per scene. Every scene
with a `map` gets a dot; the scene you are standing in sends echo rings out across the
plan, scenes holding a video are orange, and clicking any dot jumps to that scene.

```json
"minimap": {
  "enabled": true,
  "image": "assets/source-map/hm_map.png",
  "title": "",
  "width": 560,
  "position": { "corner": "bottom-right", "x": 25, "y": 30 },
  "startCollapsed": false
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | `false` hides the minimap without deleting the coordinates. |
| `image` | — | **Required.** Floor plan, any web image format. It supplies its own background — see below. Without it the minimap turns itself off with a console warning. |
| `title` | `""` | Caption above the plan. Empty (as shipped) leaves only the collapse chevron, tucked into the corner — the header strip shrinks with it rather than pushing the plan down. |
| `width` | `260` | Panel width in px, clamped to 140–560. Narrow screens cap it further. |
| `position` | bottom-right, 16/16 | Where the panel sits — see below. |
| `startCollapsed` | `false` | Open the tour with the plan folded away. |

**The dots.** Each placed scene is a small circle drawn by `css/style.css` — there is no pin
artwork and no `pin`/`pinActive` setting (a leftover pair in an older `tour.json` is
ignored). The dot is centred on its stored coordinate, and wears one of three states:

| State | Looks like | Means |
| --- | --- | --- |
| resting | near-black circle, white hairline ring | a scene you can walk to |
| `.has-video` | **orange** | that scene holds at least one Vimeo point |
| `.is-active` | **echo rings** spreading out of the dot, and a shallow breath on the dot itself | the scene on screen |

The open scene echoes rather than changing colour, because the dot may already be carrying
the orange that means "there is a video here" and one dot cannot say two things in one
colour. Two rings run 2.4 s apart on a 1.2 s stagger, so the plan always has one on its way
out rather than a gap between beats, and they are drawn in `currentColor` — on a video
scene the echo is orange too.

Details worth knowing if you retune it:

- The rings grow by **width and height, not `transform: scale()`**. Scaling would blow the
  1.5 px stroke up to 5 px on the way out, and a thickening, blurring ring does not read as
  one ring travelling outward.
- Their timing is **`linear`**. The project's `--ease` covers most of the travel in the
  first third and then hangs, which reads as a stutter rather than a ripple.
- They rest at `opacity: 0` and are `pointer-events: none`, so stopping the animation hides
  them cleanly and a ring well outside the dot never eats a click meant for it.
- Both the rings and the breath **stop under the cursor and mid-drag**, where they read as a
  rendering fault rather than a highlight.
- Under `prefers-reduced-motion` there is no echo at all, so the open scene gets a standing
  white ring instead — the state still has to be visible when the animation is not.

The dot itself is a `<span class="minimap-pin-dot">` inside the button rather than the
button's own background: the breath is an opacity animation, and a parent's opacity would
drag the echo rings down with it.

Three custom properties at the top of the `.minimap` block in `css/style.css` cover the
look: `--minimap-pin-width`, `--minimap-pin-fill` and `--minimap-pin-video`.

**Size and placement.** `width` is the panel's width in px; the plan scales to fit it and the
dots scale with it, so a 22-dot plan stays readable at every size. `position` anchors the
panel to one corner rather than to absolute coordinates, so it keeps its margin when the
window is resized:

```json
"position": { "corner": "bottom-right", "x": 16, "y": 16 }
```

`corner` is one of `bottom-right`, `bottom-left`, `top-right`, `top-left`; `x` and `y` are
the gaps in px from that corner's edges. On a phone the offsets are widened automatically
where the screen has a notch, so a corner panel never lands under one. The top corners are
allowed but already hold the scene title and the menu buttons — check the overlap before
choosing one. Both values are editable by hand or, more easily, by dragging the panel in
`?edit=1`.

**The panel behind the plan is fully transparent** — no scrim, no frame, no shadow. The
floor plan image is what the visitor sees, so it has to carry its own background:
`hm_map.png` is a line drawing on a 60% white ground, which reads over both a sunlit lobby
and a blacked-out gallery while still letting the panorama through. Swap in an image with no
ground at all and the lines will float unreadably over bright walls; swap in a fully opaque
one and you get a hard rectangle. The chevron, and a title if you set one, keep a text shadow —
they have nothing behind them either.

A scene's position is a fraction of the image, not a pixel:

```json
"map": { "x": 0.3894, "y": 0.6959 }
```

`x` runs 0 (left edge) → 1 (right edge), `y` runs 0 (top) → 1 (bottom). Fractions mean the
coordinates survive replacing the floor plan with a larger export. You do not have to work
them out: in `?edit=1`, drag the pin or click the plan.

### 4.8 The title bar

The strip across the top is plain HTML rather than configuration — it reads the same on
every scene, so there is nothing for `tour.json` to vary. Change the wording in
`index.html`:

```html
<header class="titlebar" id="titlebar">
  <h1 class="titlebar-title">Roger Ballen 2026 - Museum Hanmi</h1>
</header>
```

Its look is three custom properties at the top of `css/style.css`:

| Property | Default | |
| --- | --- | --- |
| `--titlebar-bg` | `#2b2b30` | the bar's background |
| `--titlebar-height` | `52px` | 46px below 560px wide, 42px on a landscape phone |
| `--chrome-top` | `--titlebar-height` + the notch inset | derived — do not set it by hand |

Nothing sits *underneath* the bar: the panorama, the UI layer, the scene menu, the editor
panel and a top-corner minimap are all positioned from `--chrome-top`. So the bar never
hides part of the image, and a drag that starts at the top of the panorama is still a drag.
Changing the height means changing `--titlebar-height` and nothing else.

The title is the page's only `<h1>`; the scene name under it is an `<h2>`.

**The bar and the browser tab are separate.** The tab reads `<title>` — currently
*《미술관 B1: 다음 구역은 로저 발렌입니다》* — and stays put as you walk the tour; the scene
name is already on screen, and a title that changes underfoot makes the tour hard to find
again in a row of tabs. Change the two independently, or write the same words in both.

The title is kept to one line — a wrapped title would change the bar's height, and every
other element is measured from it. A title too long for a phone is truncated with an
ellipsis rather than pushing the tour down.

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
                          (☰ 목록의 손잡이를 끌어 장면 순서를 바꿉니다)
  Yaw    0.25  (14.3°)
  Pitch  0.03  (1.7°)
  FOV    1.28  (73.4°)
  [시작 화면으로 지정]  [되돌리기]

포인트                      22        ← the viewpoint you are standing in
  이름  [중앙 로비            ]
  006.jpg                            ← which photo this is
  추가할 파노라마 [scene09 ▾] [추가]
  [이 포인트 삭제]

이동 포인트                 4         ← the points leading out of it
  카페                     카페   ▲ ▼  ← click to select; hover to find it on screen
  계단 위 라운지            계단 위 ▲ ▼  ← ▲ ▼ move it up or down the list
  전시 입구                 전시 입구 ▲ ▼
  멀티홀 중앙               멀티홀 중앙 ▲ ▼
  [+ 이동 포인트 추가]
  종류 / 대상 장면 / 라벨    ← the selected point's fields
  yaw -1.4 · pitch 0.26  (-80.2° / 14.9°)
  [화면에서 위치 지정]  [삭제]

미니맵 핀 위치                ← this scene's pin
  x 0.46 · y 0.72
  [핀 없애기]

미니맵 패널                360px  ← the panel itself
  크기   [======|=======]
  기준 모서리  [우측 하단 ▾]
  우측 하단 · 가로 16px · 세로 16px
  [처음 상태로]

[저장]  [JSON 복사]  [내려받기]
```

### Renaming, adding and deleting a viewpoint

Under **포인트**:

| Control | What it does |
| --- | --- |
| **이름** | Renames the scene as you type. The title bar, the scene menu, the browser tab and the pin's screen-reader name all follow in one go — and so do the arrow captions, see below |
| The file name under it | The original photo this viewpoint was built from, taken from the scene's `_source` note — the one thing the name cannot tell you when matching the tour against a folder of originals. Hover it for the full paths, source and web copy both |
| **추가할 파노라마** + **추가** | Creates a new viewpoint from a panorama that is on disk but not in the tour yet |
| **이 포인트 삭제** | Removes this viewpoint, after a confirmation that says how many arrows point at it |

A viewpoint cannot be invented — it needs a picture behind it. So the dropdown lists what is
actually in `assets/panoramas/equirect/`, minus whatever the tour already uses. Drop a new
photo into `assets/source-panoramas/`, run `tools/make-web-equirect.ps1`, reload the editor,
and it appears in the list. When the list is empty, every panorama you have is already in the
tour. (The list comes from the local server, so on a static host the control is disabled.)

**A rename follows the name everywhere it is shown**: the title over the panorama, the ☰
scene list, the browser tab, the minimap pin's screen-reader name, the 이동 포인트 list, the
대상 장면 dropdown — and the captions of the arrows that lead here.

An arrow's caption is its own string, not a view of its target's name: `"로비로 나가기"` is
deliberately not what the lobby is called. So a rename rewrites only the captions that were
*showing* the old name, exactly; anything phrased differently is left as it was written, and
the editor says how many captions moved with the name. Arrows in scenes you have not opened
yet are updated in the file just the same — they are simply built with the new caption when
you get there.

The same rule runs the other way. A new arrow starts out captioned with where it goes, and
changing its **대상 장면** re-captions it — unless you have written a caption of your own, in
which case it stays untouched.

A new viewpoint arrives named after its id, aimed straight ahead, with its pin in the middle
of the floor plan and no arrows — the editor jumps to it and puts the caret in **이름** so
you can name it first. Then drag its pin where it belongs and add arrows as usual. It is
written to the file in the same shape as every hand-written scene, including the `_source`
note, so a saved file does not betray which scenes the editor made.

**Deleting takes the arrows with it.** Any arrow in any other scene that pointed at the
deleted viewpoint is removed too — otherwise the next reload would drop them anyway, with a
console warning. The confirmation says how many. If you delete the scene named in
`settings.defaultScene`, the default moves to the scene you land on. When the file names no
default — as this one does not — nothing is written: the entry point simply stays the top of
the list. The last remaining
scene cannot be deleted; a tour with no scenes does not load.

### Reordering the scene list

Open the **☰** list with the editor running and each row grows a **grip** on its right.
Drag it and the row follows, the other rows opening to let it through — what you see while
dragging is the order you get. Let go and it is committed. The grip is a separate control
from the row itself, so grabbing it never walks into that scene, and a press that goes
nowhere leaves the list alone.

The list scrolls while you drag against its top or bottom edge, so a scene can be carried
the length of a 22-row tour in one go. Without a mouse, focus a grip and press **↑ / ↓** —
one place per press.

That order is the tour's own: the ☰ list, the **대상 장면** dropdown, the order scenes are
written in `tour.json`, and **which scene the tour opens at** — this tour names no
`settings.defaultScene`, so the top row is the entry point (see
[6](#6-settings-reference)). It is not the order a visitor walks in; that is decided by the
arrows.

**Reordering cannot break a link.** An arrow points at a scene *id*, never at a position, so
nothing that joins two scenes cares where either one sits in the list. Everything inside a
scene — its arrows, pin, name, panorama — travels with the row. The one thing the order does
decide is where the tour opens, above.

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
between a scene jump, a Vimeo modal and an info panel. **삭제** removes the selected point.

### Reordering the points in a scene

The **▲ ▼** buttons at the right of each row move that point one place up or down. The
order is carried into `tour.json` when you save, so the list reads the way you leave it the
next time the tour is opened.

**Reordering cannot break a link.** What a point does is its `target`, and a target is a
scene *id*, never a position — so moving a row changes nothing about where it leads, and the
matching point in the other scene is not affected either. Ids, targets, labels and angles
all travel with the row.

Two things the order does *not* change: the arrows already drawn on the panorama keep the
stacking they were built with until the page is reloaded, and no other scene's list moves.
It is the order of one scene's points, in the panel and in the file.

### Moving a minimap pin

Drag the pin on the floor plan, or click any empty part of the plan to move the **current**
scene's pin there. `핀 없애기` removes the pin, leaving the scene reachable only from the
scene menu and its arrows. The readout shows the stored fraction, e.g. `x 0.46 · y 0.72`.

### Resizing and moving the minimap itself

Under **미니맵 패널**:

| Control | What it does |
| --- | --- |
| **크기** slider | 140–560 px, applied as you drag it. The pins scale with the panel. |
| **기준 모서리** | Jumps the panel to one of the four corners, keeping the current margins |
| **Drag the plan's title bar** | Moves the whole panel. It anchors to whichever corner it is closest to when you let go, and the margins from that corner are what gets saved |
| **처음 상태로** | Back to the size and place it had when you opened the editor |

Dragging the title bar never folds the panel away, and a plain click on it still does.

### Saving

| Button | What happens |
| --- | --- |
| **저장** | `PUT`s the whole file to the local server, which writes `config/tour.json`. The first save of each server run copies the file it replaces to `config/tour.json.bak` |
| **JSON 복사** | Copies the file to the clipboard |
| **내려받기** | Downloads `tour.json` for you to drop into `config/` yourself |

**저장 only works on a server started with `--edit`.** Double-click
**`start-editor-windows.bat`** on Windows or **`start-editor-macos.command`** on macOS —
that is the whole point of those files. Elsewhere use `tools/serve.py --edit`.
Double-clicking a plain launcher and then typing `?edit=1` yourself gives you the editor
but a read-only server, which is the usual reason saving fails.

You do not have to discover that by losing work: the editor asks the server at startup
whether it will accept a save, and puts a yellow warning under the buttons when it will not.
Press 저장 anyway and the server's own answer appears — *"Saving is off. Restart the server
with --edit"*. Any host without the endpoint at all, GitHub Pages included, says so too, and
내려받기 keeps working everywhere.

Before writing, the editor checks that no scene arrow points at a missing scene and no video
hotspot is missing its id, because either would silently vanish on the next reload; if one
does, it names the problem and saves nothing. The server checks the file it receives the
same way — every scene needs an `id` and a `panorama` block — so a misdirected request
cannot replace the tour with something that does not load.

The saved file is the file you had, with your edits in it: key order, `_source` notes,
comments in `_README` and the hand-tuned formatting all survive. A save that changes one
arrow produces a two-line diff.

**`config/tour.json.bak` is a snapshot of where you started, not of your last save.** It is
written once per server run, before the first save, and then left alone. On a server with
`--autosave` a per-save backup would be a copy from one second ago, which is no undo at
all; this way stopping the server and copying `.bak` back always returns you to the tour as
it was when you opened the editor.

### Autosave and live reload

Two conveniences for working on the tour rather than showing it. Both are off unless the
server was started with the flag, and `start-editor-macos.command` starts it with both.

**`--autosave`** — the editor writes `config/tour.json` on every change; 저장 becomes a way
to skip the wait rather than something you have to remember. It waits 600 ms after you stop
before writing, so dragging a point across the panorama is one save and not eighty, and
saves are queued rather than overlapped, so two of them can never race and leave the older
one on disk. A change the file validator rejects — an arrow pointing at a scene that no
longer exists — holds autosave rather than failing it: the panel says so, and fixing the
point lets the next change through. The note under the buttons tells you which mode you are
in before you touch anything.

**`--live`** — the server watches `index.html`, `css/` and `js/`, and tells the open page
when one of them changes:

- a **`.css`** change is swapped into the running page. The panorama keeps its position,
  the editor keeps its state, and you see the new styling immediately.
- **anything else** reloads the page, because the JavaScript it is running is now stale.
  The scene you were in survives — app.js keeps it in the URL — and the editor is asked to
  finish any autosave still on its timer first, so a reload cannot swallow an edit you made
  a moment earlier.
- **restarting the server** reloads the page too. The browser reconnects by itself, notices
  it is talking to a different run, and reloads — which is what you want after editing
  `tools/serve.py`.

`config/` is deliberately *not* watched: the editor writes `tour.json` itself, and reloading
on it would mean autosave kicking the page out from under you every time you moved a pin.

The browser end is `js/livereload.js`, and app.js only imports it when the page is being
served from this machine or a private network address — a deployed tour never downloads it,
and never asks a static host for an endpoint it cannot have. The server end is
`GET /api/live`, a server-sent-events stream that exists only under `--live`.

---

## 6. Settings reference

The `"settings"` block at the top of `tour.json`:

| Key | Default | Meaning |
| --- | --- | --- |
| `defaultScene` | first scene | Scene shown when no `?scene=` is given. **Left out of this tour on purpose**, so the entry point follows the ☰ list and changes when you reorder it. Name a scene here to pin it instead; an unknown id falls back to the first scene. |
| `autorotate` | `false` | Slowly pan when the visitor is idle. |
| `autorotateIdleDelayMs` | `4000` | Idle time before autorotate starts. |
| `sceneMenu` | `true` | Show the ☰ scene list. |
| `fullscreen` | `true` | Show the fullscreen button *where the browser supports it*. |
| `showSceneName` | `true` | Show the scene name in the top-left. |
| `showHint` | `true` | Show "Drag to look around" on the first visit only. |
| `transitionDurationMs` | `500` | Cross-fade between scenes. `0` disables it. |
| `walkTransition` | `true` | Walk through doorways instead of cutting — see below. `false` leaves the cross-fade alone. |
| `updateUrlOnSceneChange` | `true` | Keep `?scene=` in the address bar so any view is linkable. |
| `minFov` / `maxFov` | `0.45` / `1.85` | Zoom limits in radians. |
| `minimap` | *(none)* | Floor plan in the bottom-right. Its own keys are in [4.7](#47-the-minimap); omit the block entirely for no minimap. |

### The walk-through transition

Clicking an arrow does not cut to the next scene. The camera **turns to face the arrow and
pushes into it**; a moment later the room you are leaving starts **dissolving while it is
still moving**, and the new one — opening a step wider than its resting view — settles down
to it underneath.

The whole move is one continuous narrowing of the field of view, which is the point: moving
forward makes what is ahead of you grow, so a view that keeps magnifying reads as walking,
where a plain cross-fade reads as the picture changing. It accelerates from a standstill, is
still moving as the two rooms cross, and comes to rest in the new one; slowing down at the
end of each half would put a stall in the middle.

**The dissolve overlaps the step rather than following it.** Both panoramas move while they
cross — Marzipano steps a movement from the render loop, so the room being left keeps turning
even though it is no longer the current scene. Waiting for the whole step to finish first
left that room on screen for a second with nothing happening, which read as the tour being
stuck; starting the fade at the very first frame read as being snatched away before you had
seen the step begin. So it holds briefly, then crosses.

| | |
| --- | --- |
| `fadeDelayMs` **450 ms** | the room you are leaving turns and pushes in at full opacity — you see the step start |
| `leadMs` **1150 ms** | the step in full: the crossing runs from 450 ms to here, both rooms moving |
| `settleMs` **2200 ms** | the whole move from the click; the last second is the new room settling |

The scene title, the ☰ list, the pin on the plan and the URL all change when the crossing
begins, not at the click — the tour says where you are when you can see it.

- **The ☰ list, a pin on the plan and a `?scene=` link** have no doorway to turn toward, so
  they push straight ahead instead. The first scene of a visit simply appears; there is
  nowhere to walk from.
- **A click while the camera is still turning is ignored** — it is a double click, or
  impatience with a destination already chosen. The arrows stop taking clicks for that
  second (`.pano.is-walking`) so a dead button never looks like a missed one; Marzipano
  stops the drag controls over the same stretch. Once the new scene is showing, an arrow in
  it works immediately, while the view is still settling.
- **Walking back shows the room as you left it**, not the doorway you walked out of: the
  camera's position is restored behind the transition.
- **`prefers-reduced-motion` turns it off**, as it does every animation in this build, and
  so does `"walkTransition": false`.

The timings live in one `WALK` block at the top of `js/tour.js`. To make the whole thing
quicker or slower, scale `fadeDelayMs`, `leadMs` and `settleMs` together; to change only how
long the old room holds before the crossing, move `fadeDelayMs` alone. `push` and `standBack` are
distances, not speeds: changing them changes how far you seem to travel, not how long it
takes. `settings.transitionDurationMs` still sets the fade for everything that is **not** a
walk — the walk uses `leadMs` so its fade and its step end together.

---

## 7. Replacing the sample assets

Two things in this repository still want a human eye:

| What | Where | Replace with |
| --- | --- | --- |
| Estimated arrow positions | every `yaw`/`pitch` in `tour.json` | positions dragged in `?edit=1` |
| Estimated minimap positions | every `map` block | pins dragged onto the floor plan |

Nothing placeholder is left in `tour.json`: the 22 scenes carry 52 real arrows and 6 real
Vimeo points (the exhibition films, one per room that shows one). There are **no info
panels** yet — add them as you need them ([4.5](#45-adding-an-info-hotspot)).

The **hotspot** icons in `assets/icons/` (`arrow.svg`, `video.svg`, `info.svg`) are **not**
used by default — those icons are inlined in `js/hotspots.js` so they inherit colour and cost
no extra request. To use a custom image for one hotspot, add
`"icon": "assets/icons/my-icon.svg"` to it. The **minimap** dots are drawn in CSS for the
same reason — they have three states between them, and a state is a class rather than a
file. Recolour or resize them through the custom properties at the top of the `.minimap`
block in `css/style.css`.

The floor plan is used exactly as it sits in `assets/source-map/`: it is already web-sized,
and it already carries the translucent ground the panel relies on, so unlike the panoramas it
needs no derived copy. Swapping in a different plan means dropping
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

python tools/make-multires.py              # every source photo
python tools/make-multires.py 006 013      # just these two
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
- `js/livereload.js` is a development file, but it is safe to upload and there is no
  reason to strip it: app.js only imports it when the page came from localhost or a private
  network address, so a visitor never downloads it.
- The four `start-*` launchers and `tools/` are development helpers. They are
  harmless if uploaded (a static host will never execute them) but there is no reason to.
- The tiles and panoramas are immutable once generated — set a long `Cache-Control`
  (`max-age=31536000`) on `assets/**` and a short one on `config/tour.json` so content
  edits go live immediately.
- HTTPS matters for two features: the editor's **Copy** buttons use the Clipboard API
  (there is a select-the-text fallback), and the Fullscreen API is restricted on insecure
  origins. `localhost` counts as secure.
- **The social card URLs in `index.html` are absolute** — `og:url`, `og:image` and
  `twitter:image` all name `https://jdlaboratory.github.io/vr-hm2609/`. They have to be:
  a crawler fetches them with no page to resolve a relative path against, so a relative one
  yields no image at all. **Publishing to a different address means editing those three
  lines**, or the card will keep pointing at this one. The card itself is
  `assets/meta/metaimg.png` (1000×563); the tags declare those dimensions, so replacing the
  file with a different size means updating `og:image:width` / `og:image:height` too.
- Facebook and LinkedIn cache a card the first time they see it. After changing the image,
  push through their debuggers rather than waiting for the cache to expire.

---

## 11. Testing checklist

The panorama rebuild, the minimap and every editing interaction below were driven through
headless Chrome against this build and passed. The layout was measured at **320, 360, 390,
414, 768 and 1280 px wide, plus a landscape phone (844×390)**, with and without the editor:
nothing scrolls sideways and nothing lands off screen at any of them. To re-check by hand
after your edits:

| | Check | Expected |
| --- | --- | --- |
| A | Page loads | panorama fills the window |
| B | Opening scene | the top of the ☰ list is shown, URL gains `?scene=…` |
| B2 | Drag a new scene to the top, 저장, reload | the tour now opens there |
| C | Mouse drag / touch drag | view rotates; pinch zooms on touch |
| D | Click an arrow | scene changes with a short cross-fade |
| E | Click the return arrow | you are back where you started, looking the way you were |
| E2 | Watch an arrow click closely | the old room turns for a beat at full opacity, **then** the two cross while both still move |
| E3 | Turn on reduced motion, click an arrow | it cuts straight through, no walk |
| F | Click the play-triangle point in `scene01` | modal opens with the Vimeo player, 16:9 |
| G | Close the modal | **audio stops immediately** (the iframe is removed) |
| H | Press `Esc` | modal closes, focus returns to the hotspot |
| I | Narrow the window to 390 px | no horizontal scrollbar; the plan caps at 52vw and the hint clears it |
| I2 | Landscape phone, open a video | the 16:9 player is capped by the **height** and stays on screen |
| I3 | `?edit=1` on a phone | the panel is a sheet across the top; scene title and ☰ sit below it, reachable |
| J | Minimap | one dot per placed scene; rings spread out of the open scene's dot, one every 1.2 s |
| J2 | Look at a scene holding a Vimeo point | its dot is orange — and so are its echo rings while it is the open scene |
| J3 | Hover the open scene's dot | the rings and the breath both stop while the cursor is on it |
| J4 | Turn on reduced motion | no echo; the open scene's dot wears a standing white ring instead |
| J5 | Retype a point to 비메오 in `?edit=1` | that scene's dot turns orange straight away |
| J6 | Watch a ring reach full size | the stroke stays hairline the whole way out, and fades before it stops |
| K | Click another dot | that scene loads and its dot takes over the echo |
| L | Collapse the minimap | plan folds away, chevron rotates, tour unaffected |
| M | Add `?edit=1` | editor panel appears (and never appears without it) |
| N | Rename in 이름 | title bar, scene menu, tab title and pin name all change |
| N2 | 추가 a viewpoint | new scene appears in menu and on the plan, editor jumps to it |
| N3 | 이 포인트 삭제 | scene and every arrow pointing at it are gone, you land on a neighbour |
| N4 | Drag an arrow | it follows the pointer, yaw/pitch updates, and it does **not** navigate |
| N5 | ▲ ▼ on a point | it swaps with its neighbour; ▲ is dead on the first row, ▼ on the last |
| N6 | 저장 after ▲ ▼ | the diff is only the moved block — every id, target and label intact |
| N7 | Drag a grip several rows | it crosses **every** row on the way, not one per drag |
| N8 | Click a grip without moving | nothing reorders, and you do **not** travel to that scene |
| N9 | Focus a grip, press ↑ / ↓ | the row moves one place |
| N10 | Walk an arrow after N7 | it still leads where it did; 대상 장면 lists the new order |
| O | Drag a minimap pin | pin moves, `미니맵 핀 위치` readout updates |
| O2 | Drag the minimap title bar | panel moves, snaps to the nearest corner, does not collapse |
| O3 | Move the 크기 slider | panel and pins resize live, readout follows |
| P | 저장 on a `--edit` server | `config/tour.json` rewritten, `.bak` kept, diff limited to what you changed |
| Q | Double-click `start-editor-windows.bat` / `start-editor-macos.command` | browser opens at `?edit=1`, 저장 writes the file |
| Q4 | `--autosave`: drag a point and let go | one `PUT` about 600 ms later, panel says 자동 저장됨, `config/tour.json` changed on disk |
| Q5 | `--autosave`: drag across the panorama without stopping | still **one** save, not one per pointer move |
| Q6 | `--autosave`: save twice with nothing changed | the second is a no-op — the server does not rewrite the file |
| Q7 | `--autosave`: check `config/tour.json.bak` after several saves | it still holds the tour as it was when the server started |
| Q8 | `--live`: save an edit to `css/style.css` | the styling changes with **no reload** — the panorama does not move |
| Q9 | `--live`: save an edit to any `js/*.js` | the page reloads and comes back to the same scene |
| Q10 | `--live`: stop the server and start it again | the open page reloads by itself once it reconnects |
| Q2 | Open the editor on a server without `--edit` | yellow warning under the save buttons, before anything is edited |
| Q3 | 저장 on any other server | refused with the reason, nothing lost — 내려받기 still works |
| R | `?scene=nonsense` | default scene loads, warning in console, no crash |
| S | Break a `videoId` in `tour.json` | that hotspot disappears with a warning; tour still works |
| T | Browser without fullscreen | button is hidden, not broken |
| U | Walk the tour, watch the tab | the title stays 《미술관 B1: …》, it does not follow the scene |
| V | Paste the live URL into a chat | the card shows `metaimg.png`, the title and the description |

Accessibility: hotspots are real `<button>`s with `aria-label`s and are keyboard reachable;
the modal is a labelled `aria-modal` dialog with a focus trap and focus restoration; the
hotspot pulse and all transitions are disabled under `prefers-reduced-motion`.

---

## 12. Known limitations and TODOs

- **Arrow and pin positions are estimates.** Each arrow was aimed at the doorway visible in
  its photo and each pin dropped on the room it looked like, but nothing was surveyed. Walk
  the tour with `?edit=1`, drag what sits wrong and press 저장 — this is the main outstanding
  task, and the editor exists to make it quick.
- **Scene names came from the walk-through, not from a floor plan legend** (카페, 수유실,
  벽화 갤러리 1…). Rename any of them in `?edit=1` — the name follows into the scene menu,
  the pin, the tab title and every arrow captioned with it.
- **The floor plan covers B1 only.** `scene01` and `scene07` are around the stairs at the
  level above, and sit on the stair block of the plan for want of anywhere better. A second
  plan per floor would be the honest fix; `settings.minimap` currently takes one image.
- **22 dots on one small plan is dense.** In the multi hall the dots nearly touch. The
  panel has been widened to 560 px to compensate; if the tour grows again, consider
  grouping viewpoints rather than widening further.
- **On a phone the dots are too small to aim at.** Capped at 52vw the plan is about 200 px
  wide and each dot is about 7 px across. Its invisible hit area is roughly 39 px square —
  close to, but still under, a 44 px touch target, and in the multi hall the targets
  overlap. The ☰ list is the dependable way to move around on a phone; the plan is a
  locator there, not a control. Growing the hit area further would help a lone dot and make
  a cluster worse, so it is held at the size the old teardrop pins had.
- **On a tablet the plan takes about 73% of the width** (560 px of 768). The 52vw cap only
  applies below 560 px. Lower `settings.minimap.width`, or add a cap for tablet widths, if
  that is too much.
- **Still on equirectangular.** Working and fast, but capped at 4096 px. Run
  `tools/make-multires.py` before launch to use the full 8192 px source detail — see
  section 9.
- **The Vimeo ids carry no privacy hash.** All six are stored as bare numeric ids, which is
  all a public video needs. If any of those films is set to *unlisted* on Vimeo, it will
  refuse to play here until the id is replaced with the full share link — see
  [4.4](#44-adding-a-vimeo-hotspot).
- **No info panels yet.** That hotspot type works and is documented in 4.5; the tour simply
  does not use it.
- **No preloading of the next scene.** Marzipano loads a panorama when you arrive. A
  neighbour-preloading pass would make navigation feel instant, at the cost of bandwidth on
  mobile. Deliberately left out.
- **iPhone Safari has no element fullscreen**, so the fullscreen button hides itself there.
  That is the correct behaviour, not a bug.
- **The `.command` launchers need `chmod +x` once** on each machine. macOS will not run a
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
