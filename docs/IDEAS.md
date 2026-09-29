# Ideas for later (review, 2026-09-29)

Not built yet. Sizes: S small, M medium, L large.

## Before the first real cut

1. **Ramp into the cut** instead of a straight plunge (teacher switch, on by default). Every cut and
   pocket goes straight down today (`shared/cam.js`). With a 1/8 in bit that is the usual way to snap
   bits and burn MDF. The file check needs to allow the ramp moves. M
2. **Setup sheet for the teacher**: one printable page per job: board size and thickness, where to set
   zero (front-left, top), the bit, clamp spots, time, file names. Carbide Motion shows none of it. S
3. **Export for teacher**: one zip with the `.nc`, the frame file, the setup sheet and the design, like
   uploadmylaser's. S

## Same as uploadmylaser

4. **DXF import** (AutoCAD). uploadmylaser's browser DXF reader (`web/src/dxf.ts`) already turns a DXF
   into lines. M
5. **Save / Open a design file**, so work moves between Chromebooks. Autosave only keeps it in one
   browser. S
6. **Box select, Group, right-click menu, Hide per job**, the same controls as the laser. M
7. **Help window** with the shortcuts. S

## Later

8. **Play the cut**: animate the bit along its path with a time slider. M
9. **Finishing pass** on cut outs (a last thin pass at full depth), teacher setting. S
10. **More starter projects**: coaster (pocket), finger-joint box, puzzle. M
11. **Send over USB** (PLAN.md phase 3), after the first cut proves the files run in Carbide Motion. L

Not yet: turning V-carve on, and tuning feeds. Both wait for real test cuts.
