# CLAUDE.md

Kid-safe CAM for the classroom Shapeoko (probably a Shapeoko 3 standard with a Makita router, see
docs/HARDWARE.md). Read PLAN.md first. Fourth family site after uploadmycode, uploadmylaser and
uploadmymodel; the Worker, headers, theme button and icon recipe follow uploadmymodel.

All cutting maths runs in the student's browser. There is no container, so no container bill.

## Layout
- `shared/`: pure JS (no DOM), used by the page, the Worker and Node tests.
  - `svg-path.js`: SVG path data, basic shapes, transforms, units → polylines.
  - `geometry.js`: offsets / unions via `clipper-lib` (1 unit = 1 µm). Not `clipper2-js`: its
    1.2.4 offset gave wrong shapes for a plain square.
  - `design.js`: parts (one drawing / shape / text each), transforms, first-guess jobs
    (`autoJobs` by nesting for drawings, `autoJobsByFill` by winding for text), hit testing,
    border, fit on board.
  - `cam.js`: `planCut` → tool moves for one bit; `estimateSeconds`.
  - `gcode.js`: moves → G-code (GRBL 1.1 subset, mm, zero = front-left corner, top of board).
  - `check-gcode.js`: the safety check every file passes before download (and later before USB).
  - `settings.js`: **the class setup**: machines, bits, routers, starting feeds, hard LIMITS,
    `validateClassConfig` (the Worker refuses anything else), `cutRules`, `checkLimits`.
  - `shapes.js`: ready-made shapes.
  - `grbl.js`: GRBL status / settings readers and `READ_ONLY`, the only bytes the USB test page
    may send (`?`, `$I`, `$$`, `$G`).
- `web/`: Vite multi-page (index, teacher/), no framework. `main.js` app state + panel,
  `board-view.js` 2D canvas board, `carve-preview.js` height-map preview, `svg-import.js` DOM walk,
  `text.js` opentype.js + fonts in `web/public/fonts` (OFL, loaded on demand), `plan-worker.js`
  runs `planCut` in a Web Worker (a newer request terminates an older one), `design-store.js`
  autosaves to IndexedDB (read back through `revivePart`). `usb-test/` + `usb-test.js`: read-only
  Web Serial check (sends only `grbl.js` READ_ONLY). `?debug` puts `window.umc` on the page for
  browser tests (`umc.settled()` waits for planning).
- `src/worker.js`: https / www redirects, security headers + CSP, `/api/health`, `/api/class`
  (public), `/api/teacher/class` (GET/PUT/DELETE, `x-teacher-key`). KV key `class`.
- `scripts/make-icons.mjs`: draws the icon (blue tile `#1E3A8A`, arrow `#60A5FA`). Edit there.

## Safety invariants (never break these)
1. Students never set feeds, plunge, depth per pass, router speed, safe height, bit or tabs. Those
   come from the class setup; the Worker validates it against `LIMITS`.
2. Run order in `planCut`: engrave, pockets, then holes and cut outs innermost first. A part cut
   free may shift, so nothing inside it may be cut after it.
3. Cut outs and islands get tabs (and big hole slugs too); a small part gets fewer tabs, and a part
   too small for even one is a blocking `noTabs` warning. Only the teacher's tab settings change that.
   Cut outs are grouped by nesting depth (a part inside another part's hole is never merged with
   it), and a hole touching a part (inside it or across its edge) is cut as part of that part's
   outline. Engrave never goes deeper than board - 0.5 mm; pockets never deeper than the
   teacher's deepest pocket or board - 1 mm.
4. Every file passes `checkGcode` before download: on the board, not deeper than board + through
   margin, no rapid into or sideways inside the wood, no sideways move below safe height off the
   board, first move Z only, feed within the class limit, only the allowed commands (no `$`, `M6`,
   `G28/G30/G92/G53`, `G91`), and no `! ~ ?` or non-ASCII anywhere (GRBL realtime bytes act even
   inside comments). Never loosen it to make a file pass. test/review.test.mjs holds the bugs the
   2026-09-26 safety review found; keep it passing.
5. The app never sends GRBL settings (`$x=`, `$RST`, `$N`) and never unlocks (`$X`) on its own.
6. With a manual router, feed hold / reset / M5 do NOT stop the bit. Every STOP and every teacher
   step says to switch the router off too.
7. Use this app's own KV namespace (`uploadmycut-CLASS_KV`). Never another site's.

## Commands
`npm test` (Node unit tests), `npm run build`, `npm run dev` (build + wrangler dev on
127.0.0.1:8791), `npm run test:browser` (needs dev running and Chrome), `npm run icons`,
`npm run deploy` (only with Dalton's go-ahead; domain not bought yet).
Speed: `node test/browser/perf.test.mjs` (heavy drawing, CPU 4x slower); keep the page drawing
frames while planning.

Windows: after each `npm run build`, restart wrangler dev (it keeps the old asset list). Stopping a
background `wrangler dev` shell leaves its `workerd.exe` running and still listening on 8791, so
tests can hit an OLD build: before restarting, stop every workerd whose command line mentions
uploadmycut (and the wrangler node processes), and check only one listener is left on 8791. Local dev
key lives in gitignored `.dev.vars`; the teacher test reads it from there (or `UMC_TEACHER_KEY`),
never from the command line.

## Style
Match the existing code. Short comments only where the why is not obvious. Student-facing text is
plain, friendly sentences.
