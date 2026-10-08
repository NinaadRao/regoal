# Architecture

A short tour of how Regoal is put together and why. It is written so you can explain each choice in a design discussion.

## Shape of the system

```
 UI screens (imperative shell)         Engine (functional core)
 js/screens-*.js, app.js  ─────────►   js/engine.js  pure functions, no I/O
        │                                    ▲
        ▼                                    │ project(events)
 Store (js/store.js) ── append-only event log in IndexedDB ── media blobs (photos)
        │
        ├── Crypt: PBKDF2 → AES-GCM (backups, key vault, passcode hash)
        └── LLM adapters → provider APIs (only when you trigger a request)
```

## Key decisions

**Local-first.** All state is on the device. There is no sync service to run, secure or pay for, and the app works offline. The cost is that durability is your responsibility, so backup is a first-class feature, not an afterthought.

**Event sourcing with a projection.** Every change is an appended event (`weight_logged`, `set_logged`, `food_logged`, `workout_logged`, `session_moved`, `profile_edited`, `plan_revised`, `event_voided`...). Current state is `Engine.project(events)`. Benefits: undo is just a void event, the coach's changes are auditable (`src: 'coach'`), import and export are the log itself, and bugs in derived views can be fixed without migrating data. At this scale (thousands of events) folding the whole log on every change is fast enough, so there are no snapshots. If the log grew large, the next step would be periodic snapshots plus events after the snapshot.

**Functional core, imperative shell.** `engine.js` has no DOM, storage or network access. It computes the plan (Mifflin-St Jeor maintenance, goal-adjusted macros, block-periodised lift targets with deloads), validates changes and projects state. It runs unchanged in Node, so the maths is unit-tested without a browser.

**Canonical units.** Weights are stored in kg and lengths in cm; units are a display concern. Switching units never loses precision.

**Human in the loop for AI.** The model gets a read-only summary and a small tool set. Write-like tools only create *proposals*. Each proposal is validated against hard bounds and then shown to the person, who must tap Apply. Food estimates follow the same principle: the model returns a suggestion, the app sanity-checks it, the person edits and confirms, and only then is an event appended. This limits the blast radius of a wrong or manipulated model to "a suggestion was ignored".

**Bring your own key.** The browser calls the provider directly, so the app has no server cost and no central copy of anyone's data. Provider differences (Anthropic, OpenAI-compatible, Gemini) live behind one internal message format in `llm.js` (including Gemini 3's thought signatures, which ride along on a tool call and are sent back untouched), with streaming, retry with exponential backoff and jitter on 429 and 5xx, and cancellation through `AbortController`.

**Defence in depth on the client.** A strict CSP and Trusted Types, no `innerHTML`, no inline styles, an allow-listed `connect-src`, and a service worker that ignores cross-origin traffic. Each layer assumes the one before it might fail.

**Zero runtime dependencies, no build.** Classic scripts, one file per concern. Less supply-chain surface, nothing to rot, and it runs from a folder. The trade-off is manual module wiring and no tree-shaking, which is acceptable for a few thousand lines.

**Photos are derived views, not new state.** The photo trend and compare screens add no events. `Engine.checkIns` joins each photo to the numbers around its date (a 3-day mean of weigh-ins, the closest measurement within 10 days) and `Engine.goalDir` says which direction counts as progress, so the "green means toward your goal" colouring comes from the plan and is unit-tested. Exports are drawn on a canvas (`js/mediaexport.js`): a comparison image is a single draw, and a time-lapse is recorded from the canvas with `MediaRecorder` in real time and always saved as MP4 (H.264), which iPhones, laptops and Instagram all accept. A browser that can only record WebM gets no video option, and the image export still works. Redrawing the pixels drops all camera and location data, nothing is uploaded, and the finished file is only handed to the OS share sheet or a download on a fresh tap, because browsers require a user gesture for that and a long recording would have used it up.

**A food database as static data, not a service.** `data/foods.json` is one file of about 7,200 rows (`[name, diet, kcal, protein, carbs, fat, fibre, source, aliases]`, per 100 g), built offline by `scripts/build-foods.mjs` from USDA SR Legacy only (sources and licences in `data/SOURCES.md`). Data whose licence does not allow redistribution, such as IFCT 2017, is not bundled: a person can load their own list (CSV or JSON, checked row by row by `Foods.parseImport`) from Fuel, and it lives in the IndexedDB meta store, outside backups, searched as source `1`, "My list". `scripts/ifct-to-import.mjs` converts a copy of the IFCT table for that purpose and refuses to write inside the repository. The app fetches it from its own address on first use (`connect-src 'self'`), validates every row in `Foods.parseDb` and caches it in the shell, so search works offline and nothing is looked up remotely. The vegetarian, egg and non-veg tags are rules over the food's name and category, covered by `tests/foods.test.js`. They are a filter, not a guarantee, and the file says so in the UI. Logged foods still become ordinary `food_logged` events, so the database can be replaced without touching anyone's history.

**A library that references, not copies.** A workout photo or video is stored as a `clip_added` event (kind, date, tag, note, name, size, length) plus a preview of about 15 KB in the media store. The original is never stored, because on iPhone a second copy would double the storage. Chrome and Edge can keep a `FileSystemFileHandle` in the meta store (`clip_h_<id>`), so the original opens without asking; Safari on iPhone cannot keep a link into Photos, so the person picks the file again, and it is used in memory and released. The picker opens straight from the tap: a browser only allows it while it still counts the tap as a tap, and waiting on the database first can use that up on an iPhone, so the saved link (if any) is looked up when the item's sheet opens, not when Watch is pressed. `Engine.cleanClip` re-builds every entry from a whitelist whenever the log is projected, so a hostile backup cannot smuggle in a path-like id or a huge value. A form check decodes six evenly spaced frames from the original in memory (one for a photo), shows them, names the provider host, and sends nothing until the person confirms; the frames are never written anywhere.

**A reel is a canvas recording.** `js/reel.js` draws a title card, photos and playing video onto one canvas and records it with `MediaRecorder` in real time (MP4 only, no audio). Originals are opened one at a time with the next one prepared during the current item, and released as soon as their part is done, so a long reel never holds many decoders or files. The result is handed to the share sheet or a download and is not stored. It reads only files the person supplied for that reel, and adds no events.

**The diet plan is rules, not a model.** `js/diet.js` holds about 55 everyday foods (per 100 g, with tags such as dairy or gluten, a diet rank from vegan to meat, and a piece size for counted foods) and about 60 meal ideas, each listing foods with a starting, least and most amount. The person's preferences are one event, `diet_prefs_set`, rebuilt from a whitelist on every projection (`Engine.cleanDietPrefs`), and the latest one wins. A style of `null` means "follow the profile's diet". Preferences filter the ideas: the diet style and the foods to leave out are hard rules, judged only on a meal's essential foods (an optional side such as curd is dropped from a vegan plate and the name loses "with curd"), while dislikes and "quick only" are dropped first if nothing else would be left. Each meal aims at its share of what is still missing from the day, and its amounts are moved one step at a time (coordinate descent, whole pieces for counted foods) until calories, protein, carbs and fat are close, with protein weighted so that falling short costs more than going a little over. A protein food that suits the diet is added when protein is short, and different ones are used across a day. The week is a rotation through the remaining ideas from a shuffle number plus per-meal swap counts, so the same preferences always give the same plan, and no idea repeats within a day. "Eat next" (`Diet.eatNext`) is the same fit for one meal against today's targets minus what was logged, which is why portions shrink after a big meal, and it tags the idea the week's plan already had. Logging a suggestion appends ordinary `food_logged` events, one per food. The optional AI buttons only send text and show text back: nothing they return is parsed into the plan or the log.

**Remembering the key without a passphrase.** `Crypt.deviceSeal` makes a fresh AES-GCM 256 `CryptoKey` with `extractable: false`, encrypts the API key with it, and stores `{key, iv, data}` in the IndexedDB meta store under `keydev_<provider>`; the browser can keep a non-extractable key object but no script can read its bytes. The meta store is not part of a backup, so the key never travels, and each provider has its own slot. At start-up `App.loadRemembered` opens the record for the current provider and, if anything fails (storage cleared, key lost), quietly behaves as if there were no key. This is deliberately a convenience and the docs say so: code running in the page, or a person using the unlocked device, can still make the browser decrypt it. `LLM.isAuthFailure` recognises a rejected key from the status and wording (Google reports an expired key as a 400), `LLM.chat` calls `LLM.onAuthError`, and the app clears the key and asks for a new one.

**Offline through a service worker.** Cache the app shell, serve stale-while-revalidate. It never caches or reads user data: that lives in IndexedDB. Because the newest files are only used on the next load, the app watches for a new worker taking over and shows an "update ready" bar with a Reload button, and asks the browser to check for updates whenever it returns to the foreground.

**The app was called Orbit while it was built.** The rename touched everything a person sees. It left the names that data depends on alone, so nothing already stored or backed up stops working: the IndexedDB database is still called `orbit`, backup and profile files still carry `"orbit": 1` inside, `.orbitbackup` files still open (new ones are `.regoalbackup`, and the backup folder cleans up either kind), and `.orbitfoods.json` and `.orbit-private-terms` are still accepted. New names win where both exist.

**Workouts, streaks and moved sessions are events and derived numbers.** A workout is one `workout_logged` event (date, activity, minutes, effort, estimated or typed calories, optional strength session name and note); a strength workout's sets are ordinary `set_logged` events carrying the workout's id in `wo`, so lift status and charts need no special case and deleting the workout voids its sets. A moved session is a `session_moved` event (`date`, `session` name or `rest`); `Engine.sessionFor` reads the plan's weekday unless a move says otherwise, and `Engine.moveSession` returns the events for a move or a swap. Whether a session is done is derived, not stored: a strength workout tagged with it, or working sets on one day covering at least half of its exercises, anywhere in that plan week. That makes "moved" and "trained on another day" the same thing and lets `weekPlan` say done, today, upcoming or not-yet without any bookkeeping. Active days, day and week streaks, the weekly log and the activity mix (`activitySummary`, `activityWeeks`, `activityMix`) are folds over the projection, so they survive restore and edits. `Engine.cleanWorkout` rebuilds every workout from a whitelist on load (activity names must be known, minutes and calories are clamped, strings length-limited). Calories are `(MET - 1) x kg x hours` from a table of MET triples per activity; the estimate is stored with the event so history does not shift when weight changes, and typing a number overrides it. `activityDigest` is the note-free summary the coach sees.

**Goals are events, and progress is a fold over ordinary logs.** `goal_set` (a whole goal, replacing any earlier one with the same id) and `goal_entry` (a reading for a custom goal) go through the same whitelist-then-append path as everything else (`cleanGoal`, `cleanGoalEntry`), so editing a goal is just another event and undoing it is voiding that event. Endurance goals have no data of their own: `js/goals.js` folds the goal over the `workout_logged` events (which gained an optional `km`) to get the best session, best pace over the goal distance, or biggest week. `js/goals.js` is a pure module like `engine.js` and `diet.js`, with the path builders (`distancePath`, `volumePath`, `pacePath`), a feasibility check (`stepsNeeded`, `ambitious`, `suggestWeeks`), `progress` (ahead, on, behind, reached, ended, nodata, not started, closed), and `review` and `nextDraft` for the end of a cycle. Distances are kilometres and paces are seconds per kilometre in storage for every sport; only the screens convert. The strength plan is a goal without a `goal_set`: `strengthProgress` reads the plan and the sets. The plan's own length is `plan.weeks` (4 to 104), and `Engine.blockOfWeek` stretches the 26-week block layout to any length so every function that took `E.WEEKS` now takes the plan.

**Workout and schedule edits are `plan_revised` changes.** `sessionEdits` (replace, add, remove, update, rewrite on a named session), `defineLifts` (tracked lifts those edits place) and `schedule` (`{from, map}` of session name to weekday) are applied by `Engine.applyWorkoutChanges`, which rebuilds everything from a whitelist: bad edits are skipped, never fatal to loading the log. Session names never change, so moves, logged workouts and "done this week" keep working. A schedule change appends to `plan.weekdayLog`; `weekdayMapAt(plan, date)` picks the entry in force on a date, so `sessionFor` keeps showing the old day for past dates, and `profile.days` follows the latest map. The coach builds these in `coach.js`, previews them on a copy of the plan (`previewWorkoutChanges`), shows the result on the card, and re-checks at Apply. Each proposal is exactly one event, so Undo (a void) restores the previous plan.

**Lifts are open-ended.** The catalog (about 40) only seeds choices. A lift in the plan is a plain object with a five-value block table and a step, so a made-up lift (`c_<name>_<n>`) uses the same progression as any other. Everything that adds a lift to the plan (the form, a coach proposal, a restored file) goes through `Engine.cleanLift`, a whitelist that clamps every field and refuses a lift without a valid progression. `placeLifts` puts it on a chosen session, an exercise the plan already lists by name is upgraded in place rather than duplicated, and `removeLift` turns a tracked lift back into a plain exercise while its logged sets stay.

**Weekly check-in is derived too.** Every plan week is a photo week, and the weekday it lands on is one setting (`checkinDay`, Friday by default). `Engine.checkinDate` finds that day inside each plan week and `Engine.checkinStatus` says whether this week is upcoming, due, overdue or done (all five angles saved) and lists earlier weeks left unfinished. Photos are shown by date only: the internal week index (1 to 26) never appears on a photo screen, in an export, or in a file name (`orbit-compare-front-2026-06-26-to-2026-09-18.png`), and empty check-ins use the date the day setting gives them. Nothing new is stored: the status is computed from the photo events, so it also survives a restore. The web cannot force anything, so "mandatory" means Today keeps a card up until the week is done and flags the ones you missed.

**One backup file, replaced each time.** A backup always uses the same name (`regoal-backup.regoalbackup`). A browser cannot delete files it did not just create, so replacing the old copy depends on where you save: in Chrome or Edge on a computer you can pick a folder once (the folder handle is kept in the local meta store), and each backup then overwrites that file and removes older `orbit-*.orbitbackup` files there, after the new one is fully written and touching nothing else in the folder. The iPhone and iPad Files sheet offers Replace for a same-named file, and Safari on a Mac downloads a numbered copy.

## Files

```
index.html            page, security policy
js/engine.js          pure plan, progression and validation logic (also runs in Node)
js/goals.js           goal paths, status, cycle review (pure)
js/store.js           IndexedDB event log, media, backup and restore
js/crypto.js          passphrase encryption and passcode hashing
js/llm.js             provider adapters (Anthropic, OpenAI-compatible, Gemini)
js/coach.js           coach tools, proposals and safety limits
js/screens-activity.js log and edit workouts, streaks, move the suggested session
js/foods.js           food database search (data/foods.json) and the starter list
js/library.js         workout photos and videos: previews, links to originals, frames for form checks
js/reel.js            stitches clips and photos into one MP4 on a canvas
js/foodai.js          AI nutrition estimates (suggest only)
js/diet.js            diet plan and "eat next": food table, meal ideas, preference filters and the portion fit (pure, also runs in Node)
js/screens-diet.js    diet plan screen, preferences, the Fuel "what next" card, optional text-only AI tips
js/screens-goals.js   Goals tab: switcher, goal detail, add and edit, plan length, next cycle
js/mediaexport.js     comparison image and time-lapse video, drawn on a canvas on your device
js/native.js          only active inside the Android app (docs/ANDROID.md): hands saved files to Android's share sheet
data/foods.json       the food database, USDA only (built by scripts/build-foods.mjs; sources in data/SOURCES.md)
scripts/ifct-to-import.mjs  turns a copy of IFCT into a file for "Add my own food list"
js/screens-*.js       screens
tests/                unit and end-to-end tests
docs/ARCHITECTURE.md  how it fits together and why
```

## Failure modes considered

| Failure | Behaviour |
| --- | --- |
| IndexedDB unavailable (private mode) | Falls back to memory and warns loudly. |
| Browser evicts site data | Backup nudges, persistent-storage request, restore flow. |
| Corrupt or hostile import | Validated and rejected before anything is applied. |
| Provider outage | Readable error, retries with backoff, manual entry always available. |
| Provider rejects the key (401, or Google's 400 "API key expired") | `LLM.isAuthFailure` marks the error; `LLM.chat` calls the app hook, which drops the key, marks the provider as rejected and opens the "key needs updating" sheet. Rate limits and outages are not mistaken for this. |
| Remembered key cannot be decrypted (storage cleared, key lost) | Treated as no key; the person is asked again. |
| A new version is deployed while the app is open | The service worker installs the new shell in the background; Regoal shows an "update ready" bar with a Reload button, and checks again whenever the app comes back to the foreground. |
| Diet preferences cannot satisfy every filter | Softer filters (quick, dislikes) are dropped first; if no meal idea remains the slot says so instead of showing something that breaks a hard rule (diet style, foods to leave out). |
| Model returns junk numbers | Clamped, cross-checked and shown for confirmation. |
| Browser cannot record video, or the tab is hidden mid-recording | The video option says so and points to the image export; a hidden tab pauses drawing, so the sheet asks you to keep Regoal open. |
| A library original moved, renamed or never linked (iPhone) | The link fails quietly and the person is asked to pick the file again; a file whose length differs from the saved one is shown with a note. |
| A photo or video the browser cannot decode (for example HEIC in some desktop browsers) | The item is still added with a placeholder; the reel skips unreadable items and says how many. |
| Two tabs open | Events are appended atomically; reload to see the other tab's changes. A multi-tab lock is a possible improvement. |

## Testing

`tests/engine.test.js` checks the plan maths against published tables, validators, projection and import safety. `tests/e2e.mjs` drives real Chromium against a local server with a fake AI provider: onboarding, logging, the food tracker's confirmation flow, coach proposals, backup round trips, the passcode, hostile input, CSP and Trusted Types, and both `file://` and `localhost`. `tests/llm.test.js` checks the Gemini message format, including thought signatures, and that rejected keys (but not rate limits) are recognised. `tests/diet.test.js` checks that preferences are cleaned, that diet styles and avoid lists are never violated, that every day lands near the targets for 3, 4 and 5 meals, that the plan is deterministic, and that "eat next" shrinks portions after a big meal. `tests/foods.test.js` checks the food database (schema, tags, search ranking and provenance) and the own-list import. The library, form check and reel are driven end to end with a photo and a video made inside the test page: previews stored and originals not, a link kept and dropped, frames confirmed before anything is sent, and a real MP4 out of the reel.
