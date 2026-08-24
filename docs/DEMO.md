# Recording a StreetSmart demo

A 60–90 second video: hook → live detection → the map → the loop → the vision.

## The cheat code: Demo Drive mode

The app's **"▶ Demo drive (simulated)"** button replays a synthetic road
through the **real** detection engine in real time (~35 s): speed climbs to
30 mph, four jolts fire with vibration — a pothole, a speed bump (correctly
identified as one!), a moderate pothole, and a severe one — then it auto-ends
on the review screen with severity-colored pins on the map. It's honest
(badged **SIMULATED DRIVE** on screen) and 100% repeatable, so you can nail
the recording in one take at your desk. Demo detections are never saved to
training data.

## Recording setup

- **Phone screen:** use the built-in recorder (iPhone: Control Center →
  Screen Recording; Android: Quick Settings → Screen record). Do NOT film the
  phone with another camera for UI shots — screen recordings look 10× better.
- **Real-drive footage (optional but great):** a passenger films the mounted
  phone from the side as a jolt fires, OR screen-record during a real drive
  and cut the best 10 seconds. Never operate the phone while driving.
- **Dashboard:** on the computer, open the scorecard site (`apps/dashboard`:
  `pnpm exec next dev`) and record the browser (Win+G game bar, or OBS).
- **Server moment:** keep the ingestion terminal visible and tap "Upload to
  server" on camera — the request landing in the terminal is a great beat.

## Suggested script (75 s)

1. **Hook (10 s)** — text over b-roll of a rough road: "Pothole damage costs
   U.S. drivers billions a year. Your phone already has every sensor needed
   to fix that."
2. **Detection (25 s)** — screen recording of a drive (real or Demo mode):
   speed on screen, jolt count ticking up, phone buzzing per hit.
3. **The map (15 s)** — review screen: pins colored by severity, tap one to
   show "pothole · severity 78% · confidence 84%". Label one ✓ on camera:
   "every driver confirmation trains the detector."
4. **The loop (15 s)** — tap Upload → terminal shows the data arrive → cut to
   the dashboard scorecards: "reports file to the city automatically, and the
   same detection verifies when they're actually fixed."
5. **Close (10 s)** — logo/name over the map: "StreetSmart. Every commute is
   a road survey."

## Editing

Any free editor works: CapCut (easiest), iMovie (Mac), Clipchamp (built into
Windows 11). Portrait 9:16 if the primary audience is phones/social; 16:9 if
it's a slide deck. Big captions — most viewers watch muted.

## Before you deploy for real

A demo video ≠ deployment. The known pre-deploy list: auth on the ingestion
server, cloud hosting for server + dashboard, and a store-distributable app
build (EAS). Record the demo first — it's the best artifact for recruiting
testers, and nothing in it depends on deployment.
