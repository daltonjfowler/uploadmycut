# uploadmycut: teacher guide

Students design and download a `.nc` file. You run every cut in Carbide Motion. For the machine
facts and their sources, see [HARDWARE.md](HARDWARE.md). For your first cut on this machine,
use [FIRST_CUT.md](FIRST_CUT.md).

## Safety first

- **Stay at the machine for every cut.** Eye protection and ear protection on everyone near it.
- **Pause or Stop in Carbide Motion does not stop the router.** The router (Makita) has its own
  switch. Keep a switched power strip for the router within reach, and switch it off whenever
  you stop.
- The bed holds only the clamped board. Nothing else: no boxes, tape rolls, cables or tools.
- Clamps outside the cut, and lower than the safe height (5 mm above the board by default).
- Vacuum on the dust boot. MDF dust is fine and harmful: use a HEPA shop vac.
- Never reach under the gantry while the router spins.

## The class setup (`/teacher/`)

Log in with the shared teacher password (the same as uploadmycode, uploadmylaser and
uploadmymodel). Everything here is what students cannot change.

- **Machine, router, bit.** One bit for the whole class, so every file runs without a bit change.
  The #102 1/8 in flat end mill is the default: it cuts out, engraves and pockets.
- **Materials.** Each has a board size (the piece students design on), a thickness, and speeds.
  *Starting values* fills in speeds for the chosen bit and wood kind. **These are starting values,
  not tested on this machine.** Watch the first cuts. If the router sounds bogged down or the bit
  squeals or burns, lower the feed; if chips are fine dust, the feed may be too slow.
- **What students may do.** Turn off pockets (or any job) for a first project.
- **Cut rules.**
  - *Tab width / height*: the bridges that hold cut-out parts. Default 6 mm wide, 2.5 mm tall.
  - *Engrave depth*: default 1 mm.
  - *Deepest pocket*: the most students can pick.
  - *Safe height*: how high the bit travels between cuts. It must clear your clamps.
  - *Cut below the board*: how far a through-cut goes into the wasteboard. Default 0.3 mm.
  - *Edge margin*: how close to the board edge students may cut.
- **Note to the class** shows on every student's panel.

Students get a new setup when they reload the page.

## Running a student's file

1. Clamp or tape the board the file was made for (the preview's teacher steps show its size).
2. Put in the class bit.
3. Carbide Motion: *Load File*.
4. Jog to the **front-left corner** of the board and zero X and Y there. Zero Z on the **top** of
   the board.
5. **Frame first:** run the `-frame.nc` file that came with it, router off. The bit traces the cut
   area at the safe height. Check it stays on the board and clears every clamp.
6. Set the router dial to the number in the file's steps (also in the file's first lines).
7. Start. When Carbide Motion asks, switch the router on.
8. After the cut, router off, vacuum, then free the parts from their tabs.

Every file passed a check in the browser before download: it stays on the board, is no deeper than
the board plus the cut-below depth, uses the class speeds, and has no machine settings, tool
changes or homing commands in it. That check reduces mistakes; it does not make a cut safe. You
check the file and stay at the machine.

## The USB test page (`/usb-test/`)

A read-only check that a computer can talk to the Shapeoko over USB. It asks four questions
(status, version, settings list, parser state) and cannot move the machine or change a setting.
Close Carbide Motion first. Connecting restarts the controller, so Carbide Motion asks you to
home again afterwards. *Save report* makes a text file with the answers.
