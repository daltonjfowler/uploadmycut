# First cut on the school Shapeoko (checklist for Dalton)

Goal for Monday 2026-09-28: learn what the machine is, prove it runs a known-good file, then run
one uploadmycut file. Tick each line. Anything surprising: stop and take a photo.

## A. Look (machine off, unplugged)

- [ ] Photo of the Z axis: **belt** on the Z (Shapeoko 3) or a **screw** (Z-Plus / HDZ).
- [ ] Belt width on X and Y: about 9 mm (Shapeoko 3) or 15 mm (Shapeoko 4).
- [ ] Photo of the controller box and any label or sticker on it.
- [ ] Small switches at the ends of the rails (homing switches)? Photo.
- [ ] Router model (sticker on the Makita) and the collet size in it (1/4 in, 1/8 in, or 6 mm).
- [ ] Which bits are there (numbers on the shanks or packets: #102, #201, #301…).
- [ ] Clamps, double-sided tape, and the wasteboard: flat, not cut up too much?
- [ ] **Clear the bed**: nothing on it but the wasteboard.
- [ ] Router on a switched power strip within reach. Shop vac for the dust boot.
- [ ] Eye and ear protection ready.

## B. Talk to it

- [ ] Which computer runs Carbide Motion? (Windows / Mac: it does not run on Chromebooks.)
- [ ] Carbide Motion version (Help / About).
- [ ] Connect, then *Initialize*: does it home to the back right? Any alarm?
- [ ] MDI: type `$I`, photo the answer. Type `$$`, photo the list. **Only look. Do not change any
      setting.**
- [ ] Or: close Carbide Motion and use `/usb-test/` (read only), then *Save report*. This needs
      the site online (not yet), or this laptop running `npm run dev` in `Desktop\uploadmycut`.

## C. Air cut (no bit, router OFF)

- [ ] Make a keychain tag in uploadmycut (online, or `npm run dev` on the laptop) and download it with the **MDF 6 mm** material picked (its deepest
      cut is 6.3 mm). Not the pine setup: that one goes 19.3 mm deep.
- [ ] Zero X/Y at the board's front-left corner, and Z **30 mm above** the board top, so even the
      deepest move stays over 20 mm in the air.
- [ ] Run it. Watch that it moves inside the board outline and goes down and up where expected.

## D. Real cut

- [ ] Scrap board clamped, bit in, Z zeroed on the top of the board.
- [ ] Router dial as the file says. Router on when Carbide Motion asks.
- [ ] Stay at the machine. Listen: steady hum = good; bogging, squealing, smoke = stop and switch
      the router off.
- [ ] Tabs held the part? Did it cut through (0.3 mm into the wasteboard)?
- [ ] Measure the part: a 70 × 30 mm tag should measure 70 × 30 mm.

## E. Tell Rocky

- Model, Z type, collet, bits, computer, Carbide Motion version, `$I` / `$$` photos or the USB
  report, and how the cut sounded and looked. The feeds get marked "school tested" from that.
