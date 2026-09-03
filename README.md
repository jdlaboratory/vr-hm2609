# 360° Virtual Tour

An interactive, photo-based 360° virtual tour built with [Marzipano](https://www.marzipano.net/),
plain HTML, CSS and JavaScript. No build step, no framework, no backend — copy the folder
onto any static host and it runs.

The whole tour is described by one file: **`config/tour.json`**. Adding a room, connecting
two rooms or adding a video never requires touching the JavaScript.

---

## Contents

1. [Quick start](#1-quick-start)
2. [Project structure](#2-project-structure)
3. [The panoramas in this project](#3-the-panoramas-in-this-project)
4. [Editing the tour](#4-editing-the-tour) — scenes, hotspots, videos, info panels
5. [The hotspot editor (`?edit=1`)](#5-the-hotspot-editor-edit1)
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
start-windows.bat --edit          # open directly into the hotspot editor
start-windows.bat --lan           # also reachable from a phone on the same Wi-Fi
start-windows.bat --port 9000     # choose the port
start-windows.bat --no-browser    # do not open a browser

./start-macos.command --edit      # same flags on macOS
```

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
| `http://localhost:8000/?edit=1` | Opens the tour **plus the hotspot editor** |

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
│   ├── modal.js                accessible dialog + YouTube embed + info content
│   ├── ui.js                   scene title, scene menu, fullscreen, loader, errors
│   └── editor.js               ?edit=1 developer tool
├── config/
│   └── tour.json               ← the entire tour lives here
├── assets/
│   ├── icons/                  arrow.svg, video.svg, info.svg (optional overrides)
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

`assets/source-panoramas/` holds **18** original photos, `001.jpg`–`010.jpg` and
`012.jpg`–`019.jpg`. There is no `011.jpg` in the source set, so there is no `scene11`;
scene ids deliberately mirror the source file numbers so the mapping stays obvious.

All originals are 8192 × 4096 equirectangular JPEGs. **They are never read by the website
and are never modified** — they are the master copies that the two scripts in `tools/`
derive from.

| Scene id | Name | Source |
| --- | --- | --- |
| `scene01` | Upper Landing | `001.jpg` |
| `scene02` | Café | `002.jpg` |
| `scene03` | Amenities Corridor | `003.jpg` |
| `scene04` | Nursing Room | `004.jpg` |
| `scene05` | Lockers & Reading Nook | `005.jpg` |
| `scene06` | Main Lobby *(default)* | `006.jpg` |
| `scene07` | Exhibition Entrance | `007.jpg` |
| `scene08` | Intro Projection | `008.jpg` |
| `scene09` | Screening Room | `009.jpg` |
| `scene10` | Dark Hall | `010.jpg` |
| `scene12` | Gallery Passage | `012.jpg` |
| `scene13` | Ticket Desk | `013.jpg` |
| `scene14` | Projection Room | `014.jpg` |
| `scene15` | Video Installation | `015.jpg` |
| `scene16` | Dark Corridor | `016.jpg` |
| `scene17` | Mural Gallery A | `017.jpg` |
| `scene18` | Mural Gallery B | `018.jpg` |
| `scene19` | Mural Gallery C | `019.jpg` |

> **The scene names and the way the scenes connect are a sensible first guess, not surveyed
> fact.** Every hotspot in `tour.json` is marked `"_sample": true` because its yaw/pitch was
> estimated from the photos rather than measured. Rename scenes freely, and use the editor
> (section 5) to put each arrow exactly on its doorway.

---

## 4. Editing the tour

Everything below happens in `config/tour.json`. It is ordinary JSON: **no comments, no
trailing commas.** Keys beginning with `_` (like `_note`, `_sample`, `_source`) are ignored
by the app, so you can leave notes for yourself there.

Angles are in **radians**:

| | |
| --- | --- |
| `yaw` | left / right. `0` is the centre of the source photo. Range `-3.14` … `3.14`. |
| `pitch` | up / down. `0` is the horizon. **Positive is DOWN**, negative is up. |
| `fov` | vertical field of view. `1.4` ≈ 80°. Smaller = zoomed in. |

You never have to work these out by hand — see [the editor](#5-the-hotspot-editor-edit1).

### 4.1 Adding a panorama

1. Put the original photo in `assets/source-panoramas/` (2:1 equirectangular JPEG).
2. Generate the web-sized copies:

   ```powershell
   pwsh tools/make-web-equirect.ps1
   ```

   This writes `sceneNN_0.jpg` (1024 px preview) and `sceneNN_1.jpg` (4096 px) into
   `assets/panoramas/equirect/`, derived from the file number: `020.jpg` → `scene20`.
3. Add the scene to `tour.json` (next step).

### 4.2 Adding a scene

Append an object to the `"scenes"` array:

```json
{
  "id": "scene20",
  "name": "Terrace",
  "panorama": {
    "type": "equirectangular",
    "url": "assets/panoramas/equirect/scene20_{z}.jpg",
    "levels": [{ "width": 1024 }, { "width": 4096 }]
  },
  "initialView": { "yaw": 0, "pitch": 0, "fov": 1.4 },
  "hotspots": []
}
```

`{z}` is the resolution level; Marzipano fills it in with `0` for the small preview and `1`
for the full image, so the visitor sees something immediately while the large file arrives.

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
  "label": "Terrace"
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
  "label": "Main Lobby"
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
view looks right, press **Copy current view**, and paste the result over `initialView`.

---

## 5. The hotspot editor (`?edit=1`)

Add `?edit=1` to the URL — for example `http://localhost:8000/?edit=1` — and a panel appears
in the top-left. **It is never present without that query parameter**, so production
visitors cannot see it.

The panel shows the live camera as you drag:

```
Scene   scene06
Yaw     0.5    (28.6°)
Pitch   0.02   (1.1°)
FOV     1.385  (79.3°)
```

### Getting a hotspot's yaw and pitch

1. Drag the panorama until the doorway (or screen, or object) is visible.
2. Click **Pick position** — the cursor becomes a crosshair.
3. Click the exact spot in the panorama. The captured coordinates appear immediately:
   `yaw 0.82 · pitch -0.103 (47° / -5.9°)`.
4. Choose the **Type** — `Scene`, `YouTube video` or `Info panel`. The form shows only the
   fields that type needs (target scene dropdown / video id / title + content).
5. Fill in the label and the type-specific fields.
6. The JSON box updates as you type:

   ```json
   {
     "id": "scene06-scene-1",
     "type": "scene",
     "target": "scene02",
     "yaw": 0.82,
     "pitch": -0.103,
     "label": "Café"
   }
   ```

7. Press **Copy JSON**, paste it into that scene's `"hotspots"` array in `config/tour.json`,
   and reload. The new hotspot is there.

**Copy current view** does the same thing for `initialView`. **Reset view** returns the
camera to the scene's configured `initialView`.

The editor never writes to `tour.json`; you always paste the result yourself.

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

---

## 7. Replacing the sample assets

Three things in this repository are placeholders:

| What | Where | Replace with |
| --- | --- | --- |
| Sample video id `aqz-KE-bpKQ` | `scene08`, `scene15` in `tour.json` | your own YouTube id |
| Sample info text (`"SAMPLE - …"`) | `scene01`, `scene07` | your own copy |
| Estimated hotspot positions (`"_sample": true`) | every hotspot | positions picked with `?edit=1` |

Search `tour.json` for `SAMPLE` and `_sample` to find all of them.

The hotspot icons in `assets/icons/` are **not** used by default — the icons are inlined in
`js/hotspots.js` so they can inherit colour and cost no extra request. To use a custom
image for one hotspot, add `"icon": "assets/icons/my-icon.svg"` to it.

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

python tools/make-multires.py              # all 18 panoramas
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

This build was driven through headless Chrome; **45/45 checks passed with zero console
errors, warnings, or failed requests**. To re-check by hand after your edits:

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
| I | Narrow the window to 390 px | no horizontal scrollbar, modal still fits |
| J | Add `?edit=1` | editor panel appears (and never appears without it) |
| K | Pick position → click | yaw/pitch captured |
| L | Copy JSON | valid, complete hotspot object |
| M | `?scene=nonsense` | default scene loads, warning in console, no crash |
| N | Break a `videoId` in `tour.json` | that hotspot disappears with a warning; tour still works |
| O | Browser without fullscreen | button is hidden, not broken |

Accessibility: hotspots are real `<button>`s with `aria-label`s and are keyboard reachable;
the modal is a labelled `aria-modal` dialog with a focus trap and focus restoration; the
hotspot pulse and all transitions are disabled under `prefers-reduced-motion`.

---

## 12. Known limitations and TODOs

- **Hotspot positions are estimates.** Every hotspot is marked `"_sample": true`. They are
  placed plausibly, not accurately, and the scene-to-scene connections are a guess at the
  building's layout. Walk the tour with `?edit=1` and re-pick each one — this is the main
  outstanding task.
- **Scene names are inferred from the photos** (Café, Nursing Room, Mural Gallery A…).
  Rename them to whatever the client calls these spaces.
- **There is no `scene11`.** The source set has no `011.jpg`. If that photo exists, drop it
  in and add the scene.
- **Still on equirectangular.** Working and fast, but capped at 4096 px. Run
  `tools/make-multires.py` before launch to use the full 8192 px source detail — see
  section 9.
- **Sample video and info text** must be replaced (section 7).
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
