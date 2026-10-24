# Toffee board configurator

Current handover: **21 October 2026 (Australia/Sydney)**. This is the VIA fork
for configuring the physical Toffee Module, not the customer shopfront.

**21 October — single-button updates and guided recovery.** `/toffee-firmware/`
uses one panel and one primary action through bootloader permission, flashing and
post-reboot verification. **Recover an interrupted update** opens
`/toffee-firmware/?recovery=1`. Select the matching saved attempt and confirm the
connected keyboard before recovery. Already-verified bytes skip erase/program;
a partial image is rewritten and read back against the saved target. If Module
has restarted, recovery can finish settings checks without reflashing.

Exact target UF2s, original affected sectors and available VIA settings are kept
locally. Verification is persisted before reboot; completion follows mode/protocol,
15-second uptime and settings checks. Older backups require the same release hash.
No-backup reinstall is explicit and cannot restore missing settings. The same-origin
update lock does not control other origins or native tools; close those first.
A matching bootloader serial plus user confirmation is required where recorded.

Physical interrupted-update qualification and the exact screenless PCB bootloader
procedure remain pending. A partially written board may need physical bootloader
entry; reconnecting alone is not a guarantee. Browser-only backups are lost if site
data is cleared. Recovery does not automatically downgrade firmware or promise
uninterrupted typing. Firmware images, current estimation and limiter settings
are unchanged by this web release.

**19 October — integrated browser WebUSB updater.**
`/toffee-firmware/` remains isolated from Redux/VIA polling, but now writes via
the RP2040 ROM's vendor PICOBOOT interface: Update firmware → browser device
permissions → automatic backup/write/readback/reboot/VIA verification. No Finder,
manual UF2 copying or Python installation. Already-granted devices reconnect
automatically where the browser permits; otherwise a permission button appears.
All three catalogue variants are supported; DEBUG_ENABLED still gates everything.
Private VIA and original affected firmware sectors are stored only in this
browser's dedicated IndexedDB, before boot/erase respectively. Originals retain
the unused final-sector tail; the entire written range is byte-verified before
reboot. Failed backups stop writing; uncertain writes are never automatically
retried. Optional recovery downloads remain, but no private data is uploaded.

Render connector diagnosis: service/main deploy6369444 contains the updater
chunk, but direct requests for firmware/lighting/debug paths return404. Other
sidebar links use React navigation; Firmware Update deliberately reloads the
page to isolate HID, exposing the missing effective SPA rewrite. The approved
fix emits `dist/toffee-firmware/index.html` from the same built React HTML and
handles trailing slashes. It works on plain static hosting without a Dashboard
change. Other app deep links still need a general Render SPA rewrite if desired.

The integration is simulated/tested without a connected PCB. The underlying
transport's physical12 October result does not prove this new end-to-end UI on
hardware. Normal v3 binary is unchanged from the15 October flash; matching
firmware source is now published through275ff49cb2 before this release.106 offline
tests/10423 assertions, complete browser simulations, static-host checks, Debug-off
checks and production builds pass. Same11 pre-existing TypeScript errors remain.
Deployment status is recorded separately; a source push is not proof of a live
site. [Implementation and verification](../AUTORESEARCH/04-09-2026%20PCB%20Lacking%20Current/web-updater-20261019-xTZnlx/README.md).

The following15 October implementation-only status is historical:
**15 October — implemented locally, NOT FLASHED/PUSHED/DEPLOYED:** lighting
protocol3 adds45 front choices (reactive typing, splash, heatmap, digital rain,
etc.) and independent badge Off/Solid/Breathing/Rainbow Cycle/Chase/Typing Pulse
with speed. Existing effect IDs0–8,940mA estimate, front/badge200 and1s-dark/1s-fade
remain. Storage v1 migrates without startup writes. Protocol2 boards keep only
their supported controls and show an update hint. The local updater now bundles
new normal candidates and verifies lighting protocol too; the manual image and
saved measurement data are unchanged. Publish matching firmware source before
externally distributing the new candidates.97 tests/10363 assertions, seven
menu browser checks, five updater browser checks, full sanitizer firmware suite
and both QMK builds pass. Same11 pre-existing TS errors; no physical validation.
[Evidence](../AUTORESEARCH/04-09-2026%20PCB%20Lacking%20Current/effects-20261015-vQCnqK/README.md).

The following13 October publication status is historical:
The lighting work and regression tools are published on `lighting-fix`.
The authorised release merges them into `main` with `DEBUG_ENABLED=true`.
Both branches' histories and non-conflicting earlier `main` changes are retained
by a normal merge, not a reset, rebase or force-push. The five conflict files
retain the tested `lighting-fix` implementation, as Ethan explicitly approved.
GitHub authentication is now configured locally for this checkout as
`ToffeeStudio`, with credentials stored in macOS Keychain. The isolated GitHub
CLI configuration is under `.git/toffee-gh`; the repository-local HTTPS helper
uses it without changing the global `ethanhaan` account or other checkouts.
Write access to both ToffeeStudio repositories is verified. The earlier403
failures were from `ethanhaan`'s read-only access, not lost commits.
The matching firmware source and configurator feature branch are pushed.
After the `main` push, verify deployment separately; Git publication alone
does not confirm that Render has completed a successful deployment.

### 13 October release checkpoints

The commit series covers HID/VIA reply isolation, independent lighting controls
and firmware telemetry, the150-state manual checklist, connected-board startup
ordering, debug firmware downloads/updater, browser flashing experiments, and
the research/regression harnesses. The final documentation checkpoint includes
the existing branding changes. Earlier session records below remain historical.

Release checks:93 offline JavaScript tests /9707 assertions, the complete
sanitizer-enabled lighting host suite,29 mocked Python updater/rescue tests and
`bun run build` pass. Python tests use `/Users/ethanhan/.pyenv/shims/python3`;
the Homebrew Python lacks the existing `hid` dependency. No hardware, camera,
lighting commands or flashing occurred while preparing these commits.
Private settings, browser observations and recovery images remain outside Git.
Post-merge checks repeat all93 tests/9707 assertions and the production build.
The startup fixture now includes fail-fast mocks for two retained legacy imports;
an automatically merged duplicate GIF import was removed. Type checking still
reports the same11 pre-existing errors, not new merge errors. Earlier whitespace
warnings are retained without broad formatting changes. No hardware was accessed.
Matching firmware checkpoints and build instructions are bundled in
`firmware-downloads/README.txt`. Corresponding `qmk_firmware/screenless-pcb`
source is now published through commit `3b891b475f7b91757645149b69fcdb42cd37ead5`,
before publishing the configurator downloads. A push to this repository's `main` triggers
`.github/workflows/trigger-deploy.yml` and its configured deploy hook; the
workflow firing is not proof that Render finished deployment successfully.

## Current board support

**12 October direct WebUSB experiment succeeded.** Actual Chrome vendor-interface
PICOBOOT read/erase/program/readback/reboot worked, without a native flashing
bridge or RPI-RP2 filesystem copy. SAME installed normal9/940mA/front-badge200
image;90112 affected bytes compared exactly, original sector tail preserved.
Browser/native15s uptime, all lighting prefs/VIA/66 overrides preserved; Ethan
confirmed typing. Flash reads require EXIT_XIP before ENTER_CMD_XIP. The
debug-gated experiment lives in `tests/browser-webusb-experiment.html` with
`tests/picoboot.mjs`; production `/toffee-firmware` still guides manual UF2 copy.
Hardware integration is NOT implemented yet. Real Module/RP2 permission prompts
remain; this run required Module approval again after reboot. Private backups
and raw sector archives are outside this repository and must not be bundled.
[Results and preservation evidence](../AUTORESEARCH/04-09-2026%20PCB%20Lacking%20Current/webusb-20261012-1waEAk/README.md).

**11 October deployment follow-up:** normal profile9 below is now flashed to the
connected PCB. Read-only firmware telemetry confirms front/badge max200 and940 mA
estimated-current limit. Use `/toffee-lighting`; manual checklist remains blocked
for normal firmware. [Evidence](../AUTORESEARCH/04-09-2026%20PCB%20Lacking%20Current/front-badge-flash-20261011-TlZZYB/README.md).

**11 October source update:** normal firmware profile9 (built, not yet flashed)
rescales front/badge RGB to200/255; rear remains255. The UI does not scale slider
writes. Debug reads the actual cap from0x88 schema2 byte24 and labels requested
current as before output rescaling; effective current comes from final firmware
output. Earlier schema1 remains supported without inventing cap information.
`src/config/debug.ts` → `DEBUG_ENABLED=false`, followed by rebuild/deploy, hides
the panels/navigation, blocks direct debug routes and prevents debug polling.
Keep it true locally for testing. This is a UI feature switch, not firmware
authorization or a security boundary against custom HID clients.
No change to normal slider ranges, saved readings or the940 mA firmware limit.

**10 October newest:150 cases, PCB-B flashed with unlimited0x26101002.**
Five higher-current mixed rows146–150 append to the unchanged145 cases. Static
point-selection estimates903/925/941/960/979 mA use the fitted model, not a live
meter or active limit. New jump link; actual RGB and manual recording unchanged.
Both mixed builds01/02 and their stored records remain supported. No high-current
hardware sweep was run; user applies these rows while watching the meter.
[Build, tests and deployment](../AUTORESEARCH/04-09-2026%20PCB%20Lacking%20Current/high-mixed-20261010-Ad4Mie/README.md).

**10 October: 25 mixed-colour cases added, matching test firmware on PCB-B.**
`/toffee-debug` now has145 fixed cases + baseline. Original120 are unchanged;
rows121–145 independently colour front, rear and badge at fixed brightnesses.
Jump link, exact RGB details, Apply/manual amps/Save, per-PCB progress and exports
are available. Original local records remain unchanged; CSV adds three group-RGB
columns. New mixed records retain actual final0x89 RGB sums, checked again on Save.
Unlimited0x26101001 is required for mixed rows; older0x26100601 still supports
original rows. Normal firmware stays rejected. The new atomic command0x8C is
manual-only, with no timeout/limiter/saves; restart starts dark. Closing the page
does not blank the board. `DEBUG_ENABLED` still disables all debug UI/helpers.
PCB-B is now flashed/verified and dark; PCB-A remains normal profile6. Debug
estimates come from whichever firmware is installed: this manual build retains
the old0x8006 coefficients, not normal6's fit. No camera or auto-measurement.
[Tests, exact artifacts and deployment](../AUTORESEARCH/04-09-2026%20PCB%20Lacking%20Current/mixed-checklist-20261010-uLN8o3/README.md).

**8 October model fitting:** 176 saved manual measurements were preserved and
fitted (A121/B55). Held-out prediction MAE falls from146.41 to14.55 mA. Normal
firmware source profile5 targets900 mA estimated whole-board current with B's
110 mA measured baseline,790 mA LED allowance and fitted unpadded RGB weights.
It is built/archived **NOT FLASHED**; installed unlimited0x26100601/profile0x8006
and its old live estimates remain unchanged, pending the user's mode choice.
Debug displays the installed firmware's telemetry, not this offline fit; it does
not enforce limits. The manual checklist intentionally rejects normal limited
firmware, so a switch to normal firmware means using `/toffee-lighting` instead.
No runtime code, saved reading, preset or storage schema changed in this fit.
[Data, fitted model and candidate](../AUTORESEARCH/04-09-2026%20PCB%20Lacking%20Current/fitted-model-20261008-IuYfWL/README.md).

**6 October fixed checklist + unlimited firmware deployed:** use **Lighting Debug** in the sidebar or
[http://127.0.0.1:5173/toffee-debug](http://127.0.0.1:5173/toffee-debug).
The page is a static list of120 states: front/rear/badge/all ×red/green/blue/white/
orange ×6 fixed brightness levels, plus baseline. Each row has **Apply → amps → Save**.
No configurable group/colour/population/brightness controls or automatic advance.
Levels span low output toward roughly1 A according to the old model;255 endpoints
are used where the full group is below that estimate. This is not active limiting
or a safe-current guarantee. Watch the physical meter and skip higher rows if needed.
Per-PCB progress/readings persist locally; CSV/JSON exports retain older custom
records too. Use the same numbered state to compare another labelled PCB.

Set `DEBUG_ENABLED = false` in [src/config/debug.ts](src/config/debug.ts) to hide
and disable the measurement page, deprecated Toffee Test route/menu, and inline
power Debug UI/polling. The new debug HID helpers also reject commands while
disabled. Reload/rebuild after changing the switch. This is a UI feature switch,
not security isolation or a firmware setting; it does not blank a running board
or re-enable firmware limiting. Existing ordinary lighting controls stay available.

The page rejects normal/limited firmware for presets. Required unlimited build
**0x26100601**, model **0x8006**, is now **FLASHED** at fresh USB0x01100000,
RP2 serialE0C9125B0D9B.15 s USB/VIA checks and read-only preservation checks pass;
output starts dark. Ethan confirmed typing works. No camera or automated lit
hardware sweep; UI checks use a simulated board.
[Flash/checklist record](../AUTORESEARCH/04-09-2026%20PCB%20Lacking%20Current/manual-checklist-flash-20261006-1f6iPy/README.md).

**6 October manual test firmware support (now deployed):** Debug decodes
new0x88 bit5 (`manualMeasurement`) and explicitly shows LIMITER DISABLED, no timeout,
no saves and a non-enforced reference budget. Above-reference output is accepted
only in this mode; normal firmware checks still reject inconsistent over-budget
telemetry. Candidate0x26100601/profile0x8006 starts dark with RAM-only test lighting
and no current/package caps or front160 scaling. Existing sliders control it;
closing the browser does not blank it. Proposed1000 mA total minus120 mA reserve
and50 mA margin gives830 mA informational LED allowance, not a hardware-safe rating.
The dedicated manual preset/data-entry page is implemented as described above.
The earlier build-only task did not access hardware; deployment is recorded above.
[Tests/build](../AUTORESEARCH/04-09-2026%20PCB%20Lacking%20Current/manual-unlimited-20261006-z6b0VE/README.md).

**Previous5 October normal deployment (superseded above):** normal firmware profile4 was installed,
with the provisional900 mA limiter enabled (120 mA reserve +100 mA margin,
680 mA LED allowance). The temporary five-second watchdog is gone; rear output
held eight seconds without keepalive. Normal firmware-owned auto-save is active.
All group brightness was intentionally saved zero using verified `0x8B ZERO`;
other saved preferences/66 overrides/private VIA are preserved. Reconnect the
board in the UI after flashing. No rescue/test controller remains. Firmware
SHA256 `6cbbc829dfca7f5d0a880dacf4678744ed3e909199a2834a703bc687021bf547`.
This is provisional, not source/thermal qualification. Physical cold-power and
typing checks remain untested. The earlier temporary/disabled-profile runtime
statements below are historical, superseded by this deployment.
[Evidence](../AUTORESEARCH/04-09-2026%20PCB%20Lacking%20Current/normal-deployment-20261005-jtjo5A/README.md).

**4 October Debug checkpoint:** Lighting has an optional **Debug: current budget**
panel above all four menus. It reads firmware command `0x88`, showing estimated
requested/effective LED mA, estimated board total, headroom, utilisation and
dimming. It does not set lighting, change saved preferences or permit overriding
the limit. Polling shares the existing HID queue, stops on failure/disconnect and
pauses when hidden; stale readings expire even behind queued slider writes.
Older firmware reports unsupported. These are estimates, not USB-meter telemetry.

**Latest5 October:** the sole PCB freshly enumerated at USB`0x02100000` runs
protected temporary build`0x26100407`, profile0x8005 (1100 mA temporary modeled
envelope,80 mA baseline,100 mA margin,920 mA LED allowance; nominal board demand
at most1000 mA). This implements authorised measurements toward1 A actual
current, NOT a change to the900 mA product budget. Exact raw test patterns fit
unchanged or are rejected; they are not silently dimmed. It is left dark;
saves disabled, startup-off and five-second watchdog.
Debug explicitly labels temporary firmware and the menus distinguish RAM-only
changes from normal auto-save. No rescue/measurement/controller loop remains.

The product900 mA budget is settled but provisional. Rough measured RGB
coefficients are recorded in normal source profile 3, which remains **disabled,
built but not flashed** pending higher-current source/thermal qualification.
The earlier83 accepted exact-output readings through770 mA are supplemented by
27 accepted build07 readings through940 mA, including25 front white255,
50 front orangeR255/G136, all104white58 and all104red150. All images, actual
RGB sums and accepted values are retained; these are not dimmed requests.
The nominal group-channel coefficients are12/15/13 mA per255 byte plus80 mA
baseline; white is conservatively overestimated. No source/thermal certification
or new normal-firmware deployment is implied.

Earlier build04 verification:39 selected JS tests /1426 assertions and Vite build pass. Visible
isolated Chrome against the actual app/PCB through native JS HID passes all six
sliders, rapid writes, effects, independent groups, per-key control, five reloads,
error/Retry, simulated reconnect and live Debug limiting. Closing the browser
caused the 5 s firmware watchdog to blank all RGB output. No personal browser
profile or keymap/macro writes; this run did not test the native WebHID chooser.
After a same-protected-UF2 reboot, original saved lighting/all 66 overrides and
VIA data match exactly. Physical cold-power and typing tests remain pending.
Latest read-only build07 check also confirms all saved/private data unchanged
and final RGB zero. Persistent camera was restarted on Ethan's request and
remains open at5174 (Node52797/helper52806); snapshots reuse the same capture.
The5 October resumption added19 readings (13 lit,6 off), bringing the total to129
including repeats/baselines. All104 orangeR110/G65 held930 mA; prior940 mA is
still the highest reading, not1 A. The nominal model overestimates some rear
mixed loads by189 mA; combined residual is approximately−189 to+40 mA.
Runner now requires holdMs5000–30000, captures then blanks/verifies zero BEFORE
image publication. Review of the historical image allows10 minutes while dark;
capture time/review delay are explicit, not fabricated freshness. Active-pulse
deadline45 seconds and firmware5-second heartbeat timeout remain.17 runner/
numerical tests pass302 assertions. Final independent settings check passes,
output zero and controller stopped. No new firmware flash or normal deployment.
See [current resumption](../AUTORESEARCH/04-09-2026%20PCB%20Lacking%20Current/resumed-20261005-vftxHC/README.md)
and [every higher-current reading](../AUTORESEARCH/04-09-2026%20PCB%20Lacking%20Current/one-amp-20261004-kDqt5u/measurements.md).
Earlier dated checks below are historical; the same 11 legacy TypeScript errors
remain unrelated. Never restart the historical OCR runner or rescue loop.

See the [Module board README](../firmware/keyboards/toffee_studio/module/readme.md)
for board identity, firmware compatibility, verified LED maps and recovery
artifacts. Read [firmware safety instructions](../firmware/AGENTS.md) before
flashing. These sibling links assume the organised `projects/toffee/` workspace.

- **Underglow:** ten effects, speed, brightness and hue/saturation. The matching
  screenless firmware saves after a one-second pause and restores the saved
  settings at startup; there is no Save button or browser-side save timer.
- **Loading/errors:** disconnected, loading and failed requests are distinct;
  firmware rejection and timeouts display an error with Retry.
- **HID:** replies are listened for before sending; DataView offsets are honoured;
  commands are serialized across wrappers for the same HIDDevice, with cleanup
  after failure. Protocol-v2 replies match command and packet ID; VIA's reader
  ignores tagged custom traffic and purges old replies before sending rather
  than after awaiting a send. This does not lock other tabs/applications.
- **Front Lighting:** Off plus44 effects on protocol3, brightness, speed and colour.
  Protocol2 keeps Off plus eight effects.
- **Per-Key LED:** saved dimming/off for the verified 66 regular front LEDs;
  selecting a key reads its actual saved/current brightness.
- **Badge:** its own on/off, brightness and solid colour, independent of both
  front and rear. Protocol3 adds Breathing, Rainbow Cycle, Chase and Typing Pulse,
  with independent speed. Protocol2 remains solid-only.
- **Limits:** all four lighting menus require screenless lighting protocol v2 or v3.
  Older firmware reports a timeout/version error instead of hanging. Display
  and filesystem operations remain unsupported; legacy UI is still present.
- **Verification:** 17 HID/map tests / 1,068 assertions and Vite production build
  passed. The TypeScript check retains 11 unrelated legacy errors after fixing
  the lighting slider's type. Module B passes 470 live API checks, real-app
  headless Chrome controls/reload/error-retry through a native JS HID bridge,
  independent-group camera checks and saved-state reboot/reflash verification.
  Physical unplug/replug and typing confirmation remain pending. The equals
  LED's broken manual repair is a known hardware issue; its index stays 103.

## Local development

### Manual measurements

1. With the matching manual firmware installed, connect/select the PCB and
   click **Check firmware**. Give the board a physical label such as PCB-A.
2. Apply the baseline row and save its reading. Then work down the120-state list.
   Every state blanks first before applying its exact fixed RGB/bitmap.
3. Apply a row, enter amps in that row (e.g. `0.320`, not `320`), and Save.
   Only the applied row accepts a reading; Save does not apply the next state.
4. Save rechecks build/final RGB before appending; stale or changed output fails.
   Repeat readings remain in history; each checklist row shows its latest saved value.
5. Label the next PCB and apply the same numbered rows for comparison. Reusing a
   label restores progress; a new connection needs a fresh firmware check/PCB label.
6. Export a backup. JSON contains full settings/indices, firmware and output
   telemetry; CSV is a flat comparison table. These are observations, not a
   calibrated model or a certification of safe operation.

Storage key: `toffee.manual-current-readings.v1`, schema1. Data is tied to the
browser profile and exact origin: `localhost` and `127.0.0.1` (or another port)
do not share it. No server upload or cloud backup. Corrupt data is reported and
left untouched. Use one measurement tab/controller at a time; simultaneous
cross-tab edits are not a supported collaborative data-entry workflow.

**No limiter or timeout in the matching manual firmware.** It holds until changed,
starts dark on restart and does not save ordinary test lighting. This page does
not silently scale RGB or change the1000 mA informational reference. Closing it
leaves output on. Sticky **All off** uses volatile `0x7C`; it is not persistent
`0x8B ZERO` rescue and cannot rescue a device that is not connected/authorised.
The UI preserves accounting for all104 mapped indices including103; software
RGB verification cannot prove a broken physical LED emits light or draws current.

### Existing lighting development

**Visible native-browser verification:** after explicit UI-control authorisation,
a separate visible Chrome window passed the real WebHID permission picker,
mouse drags on all six sliders, badge toggles and reload with 11 PCB-state
comparisons. No headless HID bridge was used. Original settings/66 overrides and
both boards' VIA data are preserved. See the [visible UI report](../AUTORESEARCH/02-09-2026%20Extensive%20Test%20Plan/visible-ui-20261002-r5sRGo/README.md).

**2 October connection/slider fix:** the late startup scan that dropped Module
support has been fixed. `loadSupportedIds` now awaits custom-definition loading,
registers/persists the bundled Module definition, and only then scans. The
duplicate startup effect in `Routes.tsx` is removed; the connection overlay is
not hidden or bypassed. [Current evidence](../AUTORESEARCH/02-09-2026%20Extensive%20Test%20Plan/ui-fix-20261002-YcMyLx/README.md)
records two clean headless actual-app/Module B runs, all six sliders driven by
mouse and keyboard, rapid changes, real PCB readback, repeated reloads, injected
read/write errors and simulated WebHID reconnect. Group brightness is limited
to 18 during testing; settings are restored and independently verified afterward.
No firmware change/reflash. The latest offline suite passes 30 tests / 1,754
assertions; production build passes. The same 11 unrelated TypeScript errors remain.

From `/Users/ethanhan/Desktop/projects/toffee/board-configurator`, with the
existing dependencies installed:

```sh
bun run dev
```

This runs the definitions preparation script and Vite. The usual URL is
`http://localhost:5173`; use the actual address printed by Vite. To bind only
locally on the exact port with already-generated definitions (the last launch):

```sh
./node_modules/.bin/vite --host 127.0.0.1 --port 5173 --strictPort
```

Use the browser's device connection/selection flow, then Lighting → Underglow.
After a firmware reboot, reconnect/select the board again. If it reports a
firmware rejection, check which image is installed: the protected pre-change
discovery firmware does not support these underglow commands. Close the
configurator before using the native HID updater. A server being reachable
does not verify USB access or physical lighting.

## Appendix — implementation and checks

- [Debug source switch](src/config/debug.ts), [manual measurement page](src/components/toffee_studio/manual-measurement.tsx),
  [preset/protocol/storage helpers](src/utils/toffee_studio/manual-measurement.ts).
  Offline unit regressions: `bun test tests/manual-measurement.test.ts tests/toffee-lighting-hid.test.ts tests/lighting-map.test.ts tests/devices-startup.test.ts`
  (34 tests/4750 assertions). [Visible browser runner](tests/manual-measurement-browser.ts)
  takes dependency directory, local URL, new JSON report and screenshot paths;
  all11 checklist checks, including all120 Apply buttons, use simulated HID, never the PCB. Existing power-panel browser
  regression also passes12 checks. Build passes;11 unrelated legacy TypeScript
  diagnostics remain. Full evidence is linked in the6 October page checkpoint above.
- [Lighting pane](src/components/toffee_studio/toffee-lighting-menu.tsx): controls, state loading and error/retry UI.
- [HID transport and lighting API](src/utils/toffee_studio/hid.ts): request queue, timeouts and firmware status checks.
- [Power Debug panel](src/components/toffee_studio/power-debug.tsx): read-only live estimates beside existing sliders. [Offline browser runner](tests/power-debug-browser.ts) mounts the actual panel/slider with a fake HID device only; [fixture](tests/power-debug-fixture.tsx) numbers are not board ratings. Run with explicit dependency directory, `http://127.0.0.1:5173`, a new report path and screenshot path. Final evidence is in the current research folder, `budget-preflight-20261004-3YsgD5/debug-ui-07.json`.
- [Regression tests](tests/toffee-lighting-hid.test.ts): immediate replies, report offsets, rapid writes, rejection, incomplete state, timeouts and retry cleanup.
- [Current visible real-board UI runner](tests/browser-lighting.ts): explicit dependency directory, fresh USB location, local URL, new report path and required build ID. Only protected calibration0x8002 firmware is accepted; group requests capped150, final limiter/watchdog still active. Never restores high RAM lighting; cleanup blanks. [Read-only post-reboot preservation check](tests/verify-protected-settings.ts) compares the explicit private baseline without printing macros. [Visual calibration](tests/visual-calibration.ts) requires the agent to view every meter image and supply the reading; [numerical fitting](tests/fit-visual-model.ts) does not read images. These are opt-in hardware tools, not routine unit tests.
- Historical [live API](tests/live-lighting.ts), [cameras](tests/camera-lighting.ts) and [saved-state reboot](tests/reboot-lighting.ts) target older Module B locations and can restore lighting or reflash. Do not run them unreviewed against the current fixture or alongside another controller. Re-enumerate identity; old port labels are not physical identities.
- [Startup ordering tests](tests/devices-startup.test.ts): isolated cold/cached catalog cases, held IndexedDB completion, bundled definition persistence, preservation of other custom IDs and exactly one final scan. These fail against the previous startup order.
- [Session evidence](../AUTORESEARCH/01-09-2026%20Light%20testing/README.md): commands, original images, public reports and verification limitations. Private keymap/macro snapshots stay in `ARCHIVE/firmware-recovery`, never in reports or Git.
- [package.json](package.json): source of truth for local scripts. `start` and `test` scripts are not defined in this fork.

```sh
bun test tests/toffee-lighting-hid.test.ts tests/lighting-map.test.ts
./node_modules/.bin/vite build
```

The second command builds the frontend into `dist/` using existing definitions;
`bun run build` also regenerates keyboard definitions. Neither command publishes
the app. No dependency upgrades or deployment were part of the underglow fix.
The separate shopfront and legacy display service remain in their own repos.

## Upstream VIA background

[VIA Web Application](https://usevia.app) — upstream project information below.

![android-chrome-192x192](https://user-images.githubusercontent.com/1714072/222621960-ddfb8ee6-a486-4c66-8852-b204ba7c807b.png)

[![Azure Static Web Apps CI/CD](https://github.com/the-via/app/actions/workflows/azure.yml/badge.svg)](https://github.com/the-via/app/actions/workflows/azure.yml)

VIA is a powerful, open-source web-based interface for configuring your [QMK](https://qmk.fm)-powered mechanical keyboard. It allows you to customize your keymaps, create macros, and adjust RGB settings (if it has RGB) on the fly, without needing to recompile your keyboard's firmware. This makes keyboard customization easier and more accessible for everyone.

## Getting VIA to support your keyboard

Are you a keyboard maker or a developer interested in adding support for your keyboard? We welcome contributions to the VIA project!

1. The source code of the keyboard **has to be merged** in [QMK Firmware Repositories](https://github.com/qmk/qmk_firmware) Master branch.
2. Your `keymaps/via` keymap **has to be merged** in [VIA's QMK Userspace Repository](https://github.com/the-via/qmk_userspace_via) Main branch.
3. Create a definition in JSON format for your keyboard and submit it as a pull request to [VIA's Keyboards Repository](https://github.com/the-via/keyboards) Master branch.

Please follow our [Specification documentation](https://www.caniusevia.com/docs/specification) carefully to ensure your pull request is smoothly reviewed and merged.

This project is tested with [BrowserStack](https://www.browserstack.com/).

## Looking for an offline app?

@cebby2420 has kindly made a desktop app that does so.

You can find it at [https://github.com/cebby2420/via-desktop](https://github.com/cebby2420/via-desktop).

**NOTE: This project has no official affiliation with VIA, and we cannot provide support for it.**

## Facing Issues?

If you encounter any issues or bugs while using the [VIA web application](https://usevia.app), please report them by opening an issue in the [Issues section](https://github.com/the-via/app/issues). This will help us to track down and resolve problems, and improve the VIA experience for everyone.

Before reporting, please make sure to check if an issue has already been reported. Thank you!
# Debug firmware updater (11 October 2026)

Open `/toffee-firmware` or **Firmware Update** in the debug sidebar. It runs
without the normal VIA/lighting polling loop. Close other board tabs/HID tools
and connect only the intended Module.

Choose normal940mA/profile9, unlimited measurement0x26101002, or normal
current-unlimited/profile10. The last keeps saved lighting, startup fade and
front/badge200. Only manual test firmware enables the measurement checklist.
The firmware itself owns these behaviors; switching a dropdown does not flash.

Workflow: connect → download private VIA backup and verified UF2 → request
bootloader → drag that UF2 once to RPI-RP2 → reconnect, verify15s uptime/expected
profile and restore/read back VIA. The backup is keymap/macros/layout, not a
firmware dump or complete lighting backup. A reloaded page can import that
backup for verification/restoration. Physical typing/cold power remains a human
check. The browser cannot identify a physical USB port or attest flash bytes.
If HID is unresponsive, physical bootloader entry is still needed.

The same page downloads the existing macOS Python updater with its companion
module, dependency instructions and all three images. It automates the UF2 copy
using explicit, freshly checked USB location/bootloader serial. No private
recovery snapshots are distributed.

`src/config/debug.ts → DEBUG_ENABLED=false` removes debug navigation/routes,
polling and commands. `scripts/debug-firmware-assets.ts` also omits the updater
downloads from the production build. Deploy a clean build and remove old debug
assets/caches when switching off; this is a build feature gate, not authentication
or a way to revoke already downloaded files. Debug code must not be moved into
`public/`, which is copied unconditionally.

`firmware-downloads/` is the explicit release catalogue; firmware hashes are
validated before a boot request. To prepare another release, run
`bun scripts/package-firmware.ts NORMAL_UF2 MANUAL_UF2 UNLIMITED_UF2 FIRMWARE_ROOT NEW_OUTPUT_DIRECTORY`
with inspected, verified images; update catalogue identities and tests when
adding a new profile. Package generation never connects to USB. The package
README lists exact corresponding GPL source commits and build flags. Publish
the matching firmware source branch before distributing the downloads; until
that push succeeds this catalogue remains local, not a published release.

**25 October catalogue:** normal11 and current-unlimited12 use the current
estimate fitted specifically to repaired PCB-B (75 mA baseline). Normal11 keeps
the940 mA estimated-current limit and was physically validated with100 additional
held lighting profiles; current-unlimited12 was built/tested offline and has not
been physically flashed. Both retain lighting v3, front/badge200, saves and
startup fade. The manual measurement image is unchanged. Corresponding source
for both normal images is firmware commit`9e3b5087f9` on`screenless-pcb`; see the
bundled README for build flags and measurement/qualification limits. The browser
accepts profile12 telemetry while retaining profile10 support for saved recovery
records. Downloading this catalogue does not itself flash a connected board.

Updater tests: `bun test tests/firmware-update.test.ts`; visible fake-HID UI
runner: `tests/firmware-update-browser.ts`. No automated physical flashing
occurs in either. Existing checklist/browser measurements remain unchanged.

Real hardware experiment11 October: native browser HID backup/reboot and
permissioned RPI-RP2 read passed, but File System Access `write()` stalled before
completion on Chrome155/macOS. A separately logged native recovery restored the
same normal firmware with all preferences unchanged. Do not replace the manual
copy workflow with that unverified transport. Development-only
`tests/browser-uf2-experiment.{html,ts}` are explicit hardware experiments, never
routine tests; they contain no mocks/native HID bridge and permit one write only.
Details: [real browser experiment and recovery](../AUTORESEARCH/04-09-2026%20PCB%20Lacking%20Current/browser-flash-20261011-VWIF2M/README.md).
