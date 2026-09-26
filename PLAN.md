# uploadmycut plan (draft for Dalton, 2026-09-26)

**Status 2026-09-26:** phase 1 is built and tested locally (open SVG / shapes / text, jobs, border,
red-spot checks, carved preview, download, teacher page). Not deployed: the domain is not bought.
Feeds are starting values, not tested on the school machine.

A classroom web app, with teacher-set limits, for the donated Shapeoko. Fourth site in the family, after
uploadmycode, uploadmylaser and uploadmymodel. Students open a drawing, say which lines get cut
out, engraved or pocketed, see the toolpath, and get a `.nc` file. The teacher locks the bit,
material, speeds and depths. Later the page can send the file to the machine over USB, like
uploadmylaser does for the laser.

## 1. The machine (from Dalton's photo, 2026-08-29)

Best guess, to confirm at school (see §6):

| What | Guess | Why |
|---|---|---|
| Model | Shapeoko 3, standard size | Black steel end plates, thin single X rail, belt-driven Z, near-square frame. A Shapeoko 4 has taller rails and a lead-screw Z. |
| Router | Makita RT0701-type trim router | Blue Makita body in the Z mount. Has its own on/off switch and speed dial. The machine cannot turn it on or off. |
| Dust | SUCKIT dust boot | Label on the gantry. |
| Wasteboard | MDF with threaded holes | Visible under the clutter. |

Hardware facts with sources go in docs/HARDWARE.md. Until a fact there has a source, it is a guess.

## 2. What students do

1. **Open a drawing**: SVG (Inkscape, Canva, Google Drawings, Tinkercad export all make SVG), or
   type text, or add a basic shape (circle, box, heart, star). DXF later if needed.
2. **Place it on the board.** The board (stock) size and thickness come from the teacher, for
   example "pine, 5.5 in x 8 in x 0.75 in". Drag, scale, rotate, mirror, undo.
3. **Pick a job for each shape** (colour coded, like laser layers):
   - **Cut out**: bit goes around the outside of the line and cuts the part free. Tabs hold it.
   - **Cut hole**: bit goes inside the line (holes, letter centres).
   - **Engrave**: bit follows the line, shallow. Best with a V-bit.
   - **Pocket**: clear out the inside to a depth (coasters, trays, inlays).
   Default: the outer closed shape is Cut out, closed shapes inside it are Cut hole, open lines and
   text are Engrave.
4. **Checks before download**, in plain words:
   - Detail smaller than the bit (a 1/8 in bit cannot cut a 1 mm gap): shown red on the drawing.
   - Shape off the board, or too close to the edge or to a clamp zone.
   - Cut out with no tabs (the part comes loose and can fly).
   - Time estimate.
5. **Preview**: top view with every toolpath, then a simple 3D "carved board" preview.
6. **Download** `name.nc`. The teacher opens it in Carbide Motion and runs it (phase 1).

Students never set feeds, speeds, plunge rate, depth per pass, spindle, safe height, or tabs off.
Those come only from the teacher.

## 3. What the teacher sets (`/teacher/`)

- Machine size (Shapeoko 3 standard, 4, XL) and whether it has homing switches.
- The bits on hand (for example #102 1/8 in flat, #201 1/4 in flat, #301 90° V-bit).
- Materials, each with feed, plunge, depth per pass and router dial per bit. Starting values from
  Carbide 3D's chart, marked "school tested" once Dalton runs them.
- Board presets (size + thickness), edge margin, tab size and count.
- Which jobs students may use (for example no pockets on day one).
- Note to class. Same shared TEACHER_KEY as the other three sites.

## 4. How it works (and why it costs $0)

- **All CAM in the browser.** 2D toolpaths (offsets for cut out / hole, pocket clearing, engrave on
  line, tabs, depth passes) are plain geometry. A polygon-offset library (Clipper) does this fast in
  JavaScript, even on a Chromebook. No container, so no container bill (unlike uploadmymodel).
- **The Worker** only serves the page and keeps the teacher's class setup in its own KV namespace
  (`uploadmycut-CLASS_KV`, never another site's).
- **G-code**: a small GRBL 1.1 subset that Carbide Motion accepts: `G21 G90 G17`, `G0`, `G1`,
  `G2/G3`, `M3 S` / `M5`, no tool changes. Job zero is the **front-left corner, top of the board**
  (Carbide Create's default), so the teacher zeros the machine the usual way.
- **One G-code checker** (`shared/check-gcode.js`) reads any `.nc` file and refuses it if it leaves
  the board, cuts deeper than the board plus a small margin, goes faster than the teacher's limit,
  or has anything outside the allowed command list (no `$` settings, no `M6`, no `G28/G30`, no
  `G92`). The page runs it before download, and the USB sender (phase 2) runs it again before any
  line leaves the browser, whatever program made the file.

## 5. Phases

| Phase | What | Needs |
|---|---|---|
| 0 | School facts (§6). Clear the bed. Run one Carbide Create job by hand so we have a known-good file. | Dalton at school |
| 1 | Student page: open SVG / text / shapes, jobs, checks, preview, download `.nc`. Teacher page. **Built, local only.** Deploy at uploadmycut.com. | Domain bought on Cloudflare, Dalton's go |
| 2 | Read-only USB test page (`/usb-test/`): connect, ask `$I` and `?` status, show position. Sends nothing that moves. **Built** (tested against a pretend GRBL, not the real machine yet). | Test at school |
| 3 | USB send, built the uploadmylaser way (section 8): teacher switch off by default, frame required, router switch as the physical gate, pause / stop, live position. | Phase 2 works on the real machine |
| 4 | Nice to have: V-carve text, inlays, DXF, 3D preview of the finished part. | |

## 6. Questions for Dalton (school, Monday 2026-09-28)

1. **Model check**: does the Z axis move by a belt (Shapeoko 3) or a screw (Shapeoko 4 / Z-Plus / HDZ)?
   A photo of the Z axis and the controller box settles it.
2. **What computer runs it?** Carbide Motion runs on Windows and Mac, not Chromebooks. If the only
   computers near the machine are Chromebooks, phase 3 (send from the browser) matters a lot more.
3. **Controller and firmware**: connect in Carbide Motion, open MDI, type `$I`, photo the answer.
   Also photo `$$` (the settings list). We read these, we never change them.
4. **Homing switches**: small switches at the ends of the rails? Does Carbide Motion "Initialize"
   home the machine, or does it skip homing?
5. **Bits on hand**: what end mills and V-bits came with it, and what collet is in the Makita (1/4 in
   or 1/8 in, or 6 mm)?
6. **Materials**: pine? MDF? plywood? acrylic? What thickness?
7. **Workholding**: clamps, double-sided tape, or both? Where do clamps usually go?
8. **Safety gear**: eye and ear protection, shop vac on the SUCKIT boot, a switched power strip
   for the router within reach.
9. **Who runs it**: teacher only, or trained students with the teacher in the room?
10. **Domain**: buy `uploadmycut.com` on Cloudflare (same account as the other three).

## 7. Safety rules the app keeps

- Students never choose speeds, feeds or depth per pass.
- Every cut out gets tabs unless the teacher turns tabs off for a material.
- Nothing cuts outside the board or deeper than the board plus the teacher's through-margin.
- The page never sends GRBL settings (`$x=`), never resets settings (`$RST`), never unlocks
  (`$X`) on its own.
- In phase 3, STOP works from the browser without the network, and the page shows, every time, that
  the router must be switched off by hand.
- The app is a helper. The teacher stays at the machine for every cut, with eye protection, and
  never leaves it running.

## 8. Lessons from uploadmylaser (applied here)

uploadmylaser reached the real classroom laser first. What it taught, and what uploadmycut does with it:

1. **Frame before every job.** Dalton made Frame required before every laser Send. uploadmycut now
   makes a frame check file next to every cut file (`name-frame.nc`): router off, the bit traces the
   cut area at the safe height, so the teacher sees where it cuts and that it clears the clamps. Phase 3
   USB send will refuse to start a job until its frame has run in the same session.
2. **Never filter the USB picker.** The first real laser connect failed until the port filter was
   loosened. `/usb-test/` asks for any port; record `port.getInfo()` at school before ever filtering.
3. **A physical gate at the machine.** The laser's own touchscreen (Send to panel) makes someone stand at
   the machine to start a job. The Shapeoko has no touchscreen, but the Makita has its own switch: a
   job cannot cut until a person switches the router on. Phase 3 sends the job with a pause (`M0`)
   after the first move to the start point, and the page says "switch the router on, then press
   Continue" while the teacher is at the machine. Every stop also says "switch the router off".
4. **Teacher switch, off by default.** uploadmylaser's Send to panel stays off until tested on the real
   laser. uploadmycut's USB send ships the same way: a teacher setting, off, until the school test
   passes (docs/FIRST_CUT.md).
5. **Only public protocols, never another program's traffic.** uploadmylaser's LightBurn capture had to
   be removed from the public repo (LightBurn's licence forbids reverse engineering). uploadmycut uses
   only GRBL's public docs (github.com/gnea/grbl/wiki) and MIT code such as cncjs. Never capture,
   decode or copy Carbide Motion or Carbide Create traffic, files or behaviour.
6. **District IT.** For uploadmycode, district IT only had to unblock the site; Web Serial needed no
   policy change. Ask IT to allow uploadmycut.com before the first class.
7. **Test the real thing before calling it done.** Both siblings hit things only the real machine
   showed (the USB filter, controller replies). Nothing in phase 3 counts as working until it has run
   on the school Shapeoko with the teacher at the machine.
