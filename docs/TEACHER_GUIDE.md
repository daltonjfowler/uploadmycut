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

**Rule: only run files that pass the file check.** Open [`/check/`](https://uploadmycut.com/check/)
and drop the student's `.nc` file (and its `-frame.nc`) on it. It says **OK to run** or **Do not
run**, with each reason in plain words. A student can hand you any `.nc` file, not only one this
site made, so check every file, every time. The file never leaves your computer.

1. Check the file on [`/check/`](https://uploadmycut.com/check/). If it says *Do not run*, the
   student makes it again on the student page.
2. Clamp or tape the board the file was made for (the preview's teacher steps show its size;
   the file check shows which material it checked).
3. Put in the class bit.
4. Carbide Motion: *Load File*.
5. Jog to the **front-left corner** of the board and zero X and Y there. Zero Z on the **top** of
   the board.
6. **Frame first:** run the `-frame.nc` file that came with it, router off. The bit traces the cut
   area at the safe height. Check it stays on the board and clears every clamp.
7. Set the router dial to the number in the file's steps (also in the file's first lines).
8. Start. When Carbide Motion asks, switch the router on.
9. After the cut, router off, vacuum, then free the parts from their tabs.

The student page runs the same check before every download, and `/check/` runs it again on the file
you were actually handed: millimetres and absolute moves set first, every move on the board and no
higher than the safe height, no deeper than the board plus the cut-below depth, the class speeds,
and no machine settings, unlock, tool change or homing commands in it. That check reduces
mistakes; it does not make a cut safe. You check the file and stay at the machine.

## The file check page (`/check/`)

Drop one or more `.nc` files. Each is checked against the class setup saved right now, for the
material named in the file's first lines (files from the student page name it). Pick a material
in the list to check for a different board, or when the file names none. If the page says the
class setup did not load, it checks nothing: reload when the internet is back. If you change the
class setup (a lower safe height, a smaller board, slower speeds), files made before may no longer
pass: the student makes them again.

## The USB test page (`/usb-test/`)

A read-only check that a computer can talk to the Shapeoko over USB. It asks four questions
(status, version, settings list, parser state) and cannot move the machine or change a setting.
Close Carbide Motion first. Connecting restarts the controller, so Carbide Motion asks you to
home again afterwards. *Save report* makes a text file with the answers.
