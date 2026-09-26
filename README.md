# uploadmycut

Kid-safe cut files for the classroom Shapeoko CNC, built for Chromebook classrooms. Students open
a drawing (SVG), pick a shape, or type text; place it on the board; give each line a job (cut out,
cut hole, engrave, pocket); fix the red spots where the bit is too thick; preview the carved board;
and download a `.nc` file for the teacher to run in Carbide Motion. The bit, materials, speeds,
depths and tabs come only from the teacher's class setup. Internal district tool, sibling of
[uploadmycode](https://uploadmycode.com), [uploadmylaser](https://uploadmylaser.com) and
[uploadmymodel](https://uploadmymodel.com). Made by [Dalton Fowler](https://daltonjfowler.com).

**Status (2026-09-26):** phase 1 built and tested locally, not deployed. Feeds are starting values,
not tested on the school machine. See [PLAN.md](PLAN.md) and [docs/HARDWARE.md](docs/HARDWARE.md).

All cutting maths runs in the browser. Nothing a student draws is sent to the server.

Guides: [students](docs/STUDENT_GUIDE.md) · [teachers](docs/TEACHER_GUIDE.md) · [first cut checklist](docs/FIRST_CUT.md).

## Teacher key

The teacher page (`/teacher/`) needs the `TEACHER_KEY` Worker secret, the same shared password as
the sibling sites: `npx wrangler secret put TEACHER_KEY`. For local dev, put a throwaway key in
`.dev.vars` (gitignored).

## Commands

```sh
npm install
npm test              # unit tests: SVG reader, toolpaths, G-code, checker, settings
npm run dev           # build, then wrangler dev on http://127.0.0.1:8791
npm run test:browser  # browser tests against npm run dev (needs Chrome)
node test/browser/perf.test.mjs  # speed on a slow Chromebook (CPU 4x slower)
npm run icons         # redraw the icons into web/public
npm run deploy        # build and deploy
```

## Credits

Polygon offsets by [Clipper](https://github.com/junmer/clipper-lib) (Angus Johnson, Boost licence).
Fonts read with [opentype.js](https://github.com/opentypejs/opentype.js) (MIT). Fonts: Lilita One
(Juan Montoreano) and Pacifico (The Pacifico Project Authors), both SIL Open Font License 1.1,
licence files in `web/public/fonts/`.

## License

MIT, see [LICENSE](LICENSE). The fonts keep their own licence (OFL 1.1).
