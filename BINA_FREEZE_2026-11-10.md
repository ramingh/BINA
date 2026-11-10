# BINA — Checkpoint / Freeze 2026-11-10

**Status:** frozen source snapshot for subsequent tab development (not an assertion that every menu is implemented).

**Source baseline before freeze:** `11df5d99a2479c06d014f6fa77fbb591846d327b` (branch `main`).

## Included project components
- `FINAL/`: current sidebar, implemented accounting pages, translation dictionary client, palette, grid, and report/data readers.
- `admin/manager/`: SQL WebService → IndexedDB manager.
- `admin/sql/` and `admin/tests/`: local SQL runner and unit tests.
- `legacy/`: archived historical source, **not** the active production UI.
- Root-level architecture references.

## Naming rule
Sidebar codes in `Sidbar.xlsx` control future form file names:
`15-1` → `Bina15_1.html`, `Bina15_1.js`, `Bina15_1.css`.
The current accounting-documents form is:
`FINAL/pages/Bina15_1.html`, `FINAL/app/bina/Bina15_1.js`, `FINAL/css/Bina15_1.css`.

## Verified structural checks
1. Current `FINAL/side_bar.html` links the accounting-documents menu to `pages/Bina15_1.html`.
2. `Bina15_1.html` references the form's renamed JS/CSS and the common BINA modules.
3. The `FINAL` and `admin` directories contain the common data, grid, query, translation and palette modules.
4. GitHub repository source snapshot measured 124 tracked files before this checkpoint.

## Known open items (deliberately **not** silently fixed)
1. **37 sidebar destinations** point to `FINAL/pages/tab-XX.html` placeholders not yet developed in active `FINAL/pages` (they exist only as older `legacy` material or have not been built).
2. A few older pages (`tab-01`, `tab-02`, `tab-13`, `app/pages/tab-13`, `Grocj.html`) have unresolved local JS/CSS fallback paths, some including `dic_sek.Js` vs `Dic_sek.Js` filename casing. CDN dependencies may mask some missing fallbacks when online.
3. The root `FastDataHandler.ashx` file is just an ASP.NET handler directive pointing at `FastDataHandler.ashx.vb`. Its server-side implementation is **not** included; SQL→IndexedDB sync needs the deployed external endpoint.
4. `ARCHITECTURE.md` is an older design document; some of its database naming details differ from the implemented per-company IndexedDB strategy. Source code and `admin/README_FA.md` are more useful for the current runtime.
5. Actual browser execution with the user's SQL Server, populated IndexedDB, CORS and network environment is **not** established by static inspection or Node unit tests.
6. The historical source `legacy/bina_db-v01.js` contains a JavaScript syntax error. It is **archived and excluded from active-source syntax checks**, not silently repaired.

## Automated checks
A GitHub Actions checkpoint workflow runs:
- `node --check` for active first-party JavaScript (`FINAL` + `admin`, excluding minified vendor scripts); historical `.Js` source files are fed on standard input for Node compatibility;
- `admin/tests/run_tests.sh` (manager/SQL tests). Its test doubles were updated to use the current `getServerTables()` and `_saveServerTables()` method names; runtime manager code was not modified;
- essential active form reference checks;
- creation and validation of a frozen source ZIP.

The workflow reports test outcomes in its logs. An existing issue must not be treated as resolved merely because a source archive was produced.

## Archive
`releases/BINA_FINAL_2026-11-10_SOURCE.zip` will contain the Git-tracked source code of this checkpoint, preserving repository paths.

- Older nested ZIP/RAR distributables and font binaries are **excluded** from this source ZIP. Those are not required source files; use font files already available in the local project.
- The `releases/` directory is excluded to avoid recursively packing other ZIP files.
- The ZIP includes `SOURCE_MANIFEST.txt`, listing the source commit and checksums.
- The archive contains no IndexedDB browser data or server/database credentials.

**No runtime behavior has been modified to create this checkpoint.**
