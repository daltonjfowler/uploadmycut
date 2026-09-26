# Hardware facts

Every fact has a source. **UNCONFIRMED** = no good source found. **DERIVED** = we worked it out
from a sourced rule; nobody published it. **SCHOOL** = seen on the class machine (none yet).
Research done 2026-09-26.

## 0. The class machine (from Dalton's photo, 2026-08-29)

Best guess until someone checks at school:

- **Shapeoko 3, standard size.** Black steel end plates, thin X rail, belt-driven Z, square frame.
  A Shapeoko 4 has 15 mm belts, a lead-screw Z and a hybrid aluminium table (§1).
- **Makita RT0701-type router** (blue body). Own switch and speed dial. The controller cannot
  switch it on or off.
- **SUCKIT dust boot**, MDF wasteboard.
- To confirm: Z drive (belt or screw), belt width, homing switches, controller board version,
  `$I` output, collet size, bits on hand.

## 1. Telling a Shapeoko 3 from a Shapeoko 4

| Feature | Shapeoko 3 (2015-2021) | Shapeoko 4 (2021+) |
|---|---|---|
| Belts | 9 mm wide GT2 (2 mm pitch, 20T pulleys) | 15 mm wide, "over 60% stiffer than the 9mm belts used in Shapeoko 3" |
| Table / frame | MDF wasteboard on sub-rails | "Hybrid Table": aluminium T-slot + MDF strips |
| Z axis | Belt-driven Z at first. Z-Plus (leadscrew) optional from Feb 2020. HDZ upgrade | Z-Plus leadscrew as standard; HDZ optional |
| Homing switches | Earliest units: none. Then mechanical switches. Proximity kit needs PCB v2.4d+ (about Feb 2017) | Inductive (proximity) switches |
| Controller | Carbide Motion PCB v2.x | Carbide Motion V3.0 PCB |

Sources: https://carbide3d.com/blog/shapeoko-4/, https://shop.carbide3d.com/products/shapeoko4,
https://raw.githubusercontent.com/gnea/grbl/master/grbl/defaults.h (DEFAULTS_SHAPEOKO_3),
https://community.carbide3d.com/t/shapeoko-z-plus/19301,
https://shop.carbide3d.com/products/proximity-switch-kit,
https://community.carbide3d.com/t/no-homing-switches-on-older-shapeoko-3/69879 (first S3s had no
homing switches; old machines on Grbl 0.9 need Carbide Motion 3).

Carbide support identifies a machine from a photo sent to support@carbide3d.com
(https://guides.carbide3d.com/faq/buying-used-shapeoko/).

## 2. Work area

| Model | Published cutting area | Carbide Motion max travel ($130 x $131) |
|---|---|---|
| S3 Standard | 16" x 16" (406 x 406 mm) | 420 x 430 mm |
| S3 XL | 33" x 16" | 830 x 430 mm |
| S3 XXL | 33" x 33" | 830 x 850 mm |
| S4 Standard | 17.5" x 17.5" x 4" (444.5 x 444.5 x 101.6 mm) | UNCONFIRMED |
| S4 XL | 33" x 17.5" x 4" | UNCONFIRMED |

Sources: https://shapeokoenthusiasts.gitbook.io/shapeoko-cnc-a-to-z/anatomy-of-a-shapeoko,
https://community.carbide3d.com/t/setting-grbl-configuration-in-cm-517-and-later/27681,
https://shop.carbide3d.com/products/shapeoko4.

- Z travel ($132): belt Z 100 mm, Z-Plus 95 mm, HDZ 140 mm (CM 517 thread above).
- Homing goes to the **back right** (https://carbide3d.com/hub/docs/shapeoko-setup/).
- The app caps the board size at the published cutting area (`shared/settings.js` MACHINES).

## 3. Controller

- ATmega328P running GRBL, with an ATmega16U2 as USB-serial (like an Arduino Uno) and a USB
  isolator (https://shapeokoenthusiasts.gitbook.io/shapeoko-cnc-a-to-z/anatomy-of-a-shapeoko,
  https://community.carbide3d.com/t/carbide-motion-v2-3-board-layout/12150).
- Carbide uses its own USB VID/PID. **UNCONFIRMED** numbers: record `port.getInfo()` on the real
  machine; never hard-filter the port picker until then (uploadmylaser learned this the hard way).
- Firmware GRBL 1.1 (a Carbide log shows "1.1f":
  https://community.carbide3d.com/t/grbl-operation-and-settings/82769). Old S3s may run 0.9.
- Baud 115200 (GRBL default, `config.h`). UNCONFIRMED for Carbide's build, very likely.
- RX buffer 128 bytes, line buffer 80 characters (gnea/grbl `serial.h`, `protocol.h`).
- Opening the port probably resets the board (DTR), which loses work zero held in RAM
  (https://github.com/gnea/grbl/issues/160). After `open()`, wait for the `Grbl 1.1x` banner.
- With homing enabled, GRBL boots in `Alarm` (`[MSG:'$H'|'$X' to unlock]`).
- Status: `<Idle|MPos:0.000,0.000,0.000|FS:0,0>` (may carry WPos, WCO, Bf, Pn, Ov, A, Ln). Parse
  both MPos and WPos+WCO (https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface).

**Settings the app must never change.** Carbide Motion's "Send Configuration Data" writes them per
machine and Z type; wrong values can crash the Z: `$100`/`$101` = 40 steps/mm, `$102` = 40 (belt
Z) / 200 (Z-Plus) / 320 (HDZ), `$130-$132`, `$3`, `$20-$27`, `$110-$122`. The app treats `$$` as
read-only and never sends `$x=`, `$RST=` or `$N`. Recovery is Carbide Motion → Settings → Send
Configuration Data.

## 4. GRBL 1.1 streaming (for phase 3)

Sources: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface,
https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands,
https://raw.githubusercontent.com/gnea/grbl/master/doc/script/stream.py.

- Send-response (one line, wait for `ok` / `error:N`) or character counting (sum of line lengths
  + 1 under 127; cncjs keeps `128 - 8`).
- EEPROM writes (`G10 L2/L20`, `G28.1`, `G30.1`, `$x=`, `$I=`, `$Nx=`, `$RST=`) must go alone with
  an empty buffer. We never send any of them.
- Realtime bytes (not counted): `?` status, `!` feed hold, `~` resume, `0x18` soft reset, `0x85`
  jog cancel, `0x90-0x94` feed override, `0x95-0x97` rapid override.
- `$H` homes, `$X` unlocks (emergencies only), `$J=G91 G21 X10 F1000` jogs.
- Soft reset while moving → `ALARM:3`, position lost, re-home
  (https://guides.carbide3d.com/faq/error-codes/).
- Stock GRBL 1.1 **rejects** `M6`, `G41/G42`, plain `G43`, `G81-G89` and `%` lines; comments and
  lowercase are fine; lines over 80 characters overflow (gnea/grbl `gcode.c`, `protocol.c`).

**Speak clear: with a manual router (Makita or Carbide Compact Router plugged into the wall),
feed hold, soft reset, alarms and M5 do NOT stop the bit spinning.** The controller has no power
over it (https://shapeokoenthusiasts.gitbook.io/shapeoko-cnc-a-to-z/cad-cam-tools). Every STOP in
the app must also tell the person to switch the router off.

## 5. Carbide Motion and Carbide Create

- Carbide Motion accepts G0-G4, G17-G21, G28, G28.2, G90, G91; ignores G40, G43, G49, G54-G59,
  M7, M9; M0, M1, M2, M30, M3, M5, and M6 (tool change prompt)
  (https://guides.carbide3d.com/faq/supported-gcodes/).
- File extension `.nc` (also `.gc`, `.gcode`; `.tap` from build 536)
  (https://community.carbide3d.com/t/tap-files-conversion-to-nc/77124).
- Manual router: "no automatic control of the router activation nor RPM". With "Show popups on
  RPM change" on, Carbide Motion asks the person to switch the router on at speed, and off at the
  end (https://carbide3d.com/hub/docs/shapeoko-setup/,
  https://community.carbide3d.com/t/carbide-motion-prompts/37032). Exact wording UNCONFIRMED.
  So our `M3 S<rpm>` line matters: it is what triggers that prompt.
- Job zero: any corner, as long as you zero there. Z0 usually top of stock. **We use front-left
  corner, top of board** (https://community.carbide3d.com/t/zeroing-at-center-vs-zeroing-to-lower-left/32117).
- Carbide Create output starts `G90`, `G21`, then `G53G0Z-5.000` (safe Z in machine coordinates),
  `M6T..`, `M03S10000`, and ends `M02`
  (example: https://github.com/BenjaminPoilve/minichord/blob/main/hardware/graphics/keycap_cut.nc).
  Our checker refuses `G53` and `M6`, so Carbide Create files will not pass it as-is. Fine for
  phase 1 (we only check our own files); phase 3 needs a decision.

## 6. Routers: dial → rpm (approximate)

| Dial | Carbide Compact Router (shop page) | Makita RT0701 (community) |
|---|---|---|
| 1 | 11,000 | 10,000 |
| 2 | 13,500 | 12,000 |
| 3 | 18,250 | 17,000 |
| 4 | 24,500 | 22,000 |
| 5 | 29,250 | 27,000 |
| 6 | 31,000 | 30,000 |

Sources: https://shop.carbide3d.com/products/carbide-compact-router,
https://community.carbide3d.com/t/add-speeds-for-makita-0701-to-speed-chart/8148, Makita range
10,000-30,000 (https://makitatools.com/products/details/RT0701C). The official S3 chart lists
10K / 12.5K / 17.2K / 22.3K / 27.2K / 30K.

## 7. Feeds and speeds

The only official Carbide chart is "Shapeoko 3 Feeds & Speeds, .25 in" for #201/#202
(https://web.archive.org/web/20211118030340/https://docs.carbide3d.com/support/supportfiles/S3_feeds_250.pdf):

| Material (#201, 1/4" 3F) | DOC | Dial | Feed | Plunge |
|---|---|---|---|---|
| MDF | 7.6 mm | 3 | 2032 mm/min | 762 |
| Pine | 10.2 mm | 3.75 | 1905 | 1016 |
| Mahogany | 2.5 mm | 3.5 | 1651 | 813 |
| Plywood | 6.35 mm | 3.5 | 2540 | 1270 |

No official numbers found for #102 (1/8"), #122 (1/16"), #301 (V-bit), maple or oak.

**Our class starting values (DERIVED, not school tested)** are in `shared/settings.js`
STARTING_FEEDS:

- #102 in pine / MDF: dial 3 (~17,000-18,000 rpm) × 2 flutes × 0.025 mm chip load ≈ 900 mm/min,
  plunge 300, 1.0 mm per pass. Hardwood 450 mm/min, 0.5 mm per pass. Chip loads from
  https://shapeokoenthusiasts.gitbook.io/shapeoko-cnc-a-to-z/feeds-and-speeds-basics.
- #201: the chart's feeds with well under half its depth per pass (the chart is aggressive).
- #122: a quarter of the diameter per pass, slow feed.

## 8. Safety

From https://carbide3d.com/hub/docs/machine-safety/: impact-rated eye protection, hearing
protection, dust protection, nothing loose near the bit, never reach in while running, **never
leave the machine running unattended**. Dust: grounded vacuum hose; HEPA for MDF
(https://carbide3d.com/learn/cnc-dust-collection/). Workholding: clamps or tape, clamps out of the
path, **use tabs** so a cut-free part cannot fly
(https://shapeokoenthusiasts.gitbook.io/shapeoko-cnc-a-to-z/workholding). Keep an extinguisher near
(UNCONFIRMED exact source). Cut router power at the source to stop it.

## 9. Code to learn from

MIT, fine to learn from and reuse: cncjs (Sender.js: send-response and char-counting), cncjs
gcode-parser / gcode-toolpath, Kiri:Moto (GridSpace/grid-apps). **Do not copy** GPL/AGPL code:
Universal G-Code Sender, gSender, OpenBuilds CONTROL, LaserWeb4, jscut, GRBL itself (reading its
docs is fine). Polygon offsets: `clipper-lib` (Boost licence). `clipper2-js` 1.2.4 gave wrong
offsets for a plain square in our test (2026-09-26), so it is not used.
