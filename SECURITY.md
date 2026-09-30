# Security and privacy

Regoal holds sensitive things: body measurements, photos, health-adjacent logs and possibly an AI API key. This page says what is protected, how, and where the limits are.

## Design rules

1. **No server, no account.** There is no backend to breach. Data lives in the browser's IndexedDB on your device.
2. **No third parties.** No analytics, no CDN scripts, no remote fonts. The only requests the app makes are AI calls you trigger, straight to the provider you chose (or localhost).
3. **Least authority for the AI.** The coach and food estimator (including the "Surprise me" AI dessert idea and the "Switch" AI exercise substitution) can only read a summary and *propose*. Every change is validated against hard limits and needs your tap. Every change can be undone.
4. **Data is data.** Text from you or from a model is always inserted as plain text. The app contains no `innerHTML`.

## What is enforced

| Threat | Defence |
| --- | --- |
| Injected script (XSS) | No `innerHTML` anywhere; `script-src 'self'`; `style-src 'self'` (no inline styles); Trusted Types required for DOM sinks. Tests push hostile strings through typed and model-returned food names, set notes and coach replies. |
| Data sent somewhere unexpected | `connect-src` is an allow-list: the three provider origins and localhost. `default-src 'none'`. The service worker never touches cross-origin requests. |
| Clickjacking / base tag tricks | `base-uri 'none'`, `form-action 'none'`. (Framing protection needs an HTTP header, so set `Content-Security-Policy: frame-ancestors 'none'` on your host if it lets you.) |
| Stolen backup file | AES-256-GCM with a key from PBKDF2-SHA256 (250,000 iterations), random salt and IV per file. Wrong passphrase or tampering fails to decrypt. |
| Malicious or corrupted import | Size limit, event type allow-list, rejection of `__proto__`/`constructor`/`prototype` keys, profile fields range-checked and re-built from a whitelist. Imports are never applied without confirmation. |
| API key leakage | Remembered on this device by default: sealed with a non-extractable AES-GCM key kept in IndexedDB, in a store that backups and exports never read. Other options: passphrase-encrypted vault, memory only, or a key file. Never in backups or exports; sent only as a request header to the provider origin. A provider that rejects the key makes Regoal drop it and ask for a new one. |
| Hostile diet preferences or plan swaps in a backup | Rebuilt from a whitelist on load: style, cuisine and avoid list from fixed lists, 3 to 5 meals, at most 8 short dislikes (letters only), a shuffle number 0 to 9,999 and at most 80 swaps with keys like `2:lunch`. A bad event is skipped. The diet plan is built by rules on the device and no AI can change it. |
| Runaway or manipulated AI | Prompt tells the model that stored text is data. Tools are read-only or "propose". Calories change at most 300 per step, protein stays within 1.4 to 3.0 g/kg, lift changes at most 10 percent. Estimates go through a confirmation card and a sanity check (calories vs macros) before anything is saved. |
| Hostile workouts or lifts in a backup or coach proposal | Workouts are rebuilt from a whitelist on load (activity must be a known name, minutes 1 to 600, calories 0 to 5,000, strings length-limited and shown as text). An attached photo keeps only two plain-identifier media ids, never a raw file or URL. A lift added to the plan must have a valid five-step progression and every field is clamped; ids must be plain identifiers. The coach can only propose logging a workout or moving a session, and a person taps Apply. |
| Hostile goals or readings in a backup | A goal is rebuilt from a whitelist on load: known sport and aim, length 1 to 104 weeks, distances 0 to 1,000 km, paces within a sensible range, a valid start date, ids that are plain identifiers, text length-limited and shown as text, at most 24 goals. Readings are dated numbers within range. The coach cannot create, edit or delete a goal. |
| Hostile profile edits in a backup | A profile change keeps only name, sex, age, height, body fat and diet, each checked (text length-limited, numbers in range, diet and sex from a fixed list); one bad field refuses the whole change. |
| Photos and videos duplicated in storage | The library stores a small preview and the file's name and size for every item, plus a second, larger recompressed copy (about 1600px, never the original file) for a photo, so it can be viewed again without asking for the file. Videos keep only the small preview. Links to files (Chrome, Edge) are read-only handles kept on this device and are not in backups. An optional workout photo uses the same recompression and storage, keyed to that workout; removing it, replacing it or deleting the workout deletes the stored copies. |
| Video frames leaving without consent | A coach form check shows the exact frames and the provider's host first, and nothing is sent until you tap Send. The frames are never saved. |
| Hostile library entries in a backup | Every entry is rebuilt from a whitelist on load: ids, preview ids and exercise ids must be plain identifiers, text is length-limited and numbers are clamped. |
| Food database tampering | It is a static file served from the app's own address, validated row by row before use, and it never runs as code. |
| A hostile own-list file | It is size-limited (15 MB, 30,000 rows), parsed as data, every row range-checked and control characters removed, and shown only as text. Nothing is stored until you confirm, and it is never uploaded or put in a backup. |
| Personal data in the repository | `.gitignore` plus a pre-commit and pre-push scan for photos, backups, profile files, keys and your own private terms. |
| Location data in photos | Photos are decoded and re-encoded as JPEG, which drops all metadata. Downloaded comparison images and time-lapse videos are redrawn on a canvas, so they carry none either. |

## What is not protected (be honest with yourself)

- **Data at rest is not encrypted.** IndexedDB is readable by anyone who can use your unlocked browser profile or device. Use a device passcode and full-disk encryption. The optional Regoal passcode only gates the screen; it is not encryption.
- **The key remembered on this device is a convenience, not a vault.** The sealing key cannot be exported by scripts, but anyone who can open Regoal on your unlocked device (or a script running inside this origin) can ask the browser to decrypt it and use it. There is no passphrase. Turn on the app lock, or choose the Passphrase or Session mode, if that matters. Browsers may clear a site's storage (Safari after about seven days without use, unless installed to the Home Screen); the key is then gone and Regoal asks again.
- **A compromised device or browser extension can read anything** the page can. Regoal cannot defend against that.
- **AI providers see what you send them.** The coach summary (numbers, today's food log by name, meal and macros plus a 7-day average, a workout summary of activity types, minutes, estimated calories and streaks, and a short summary of each goal: its name, aim, week, status and progress; never your notes, goal notes or photos), food text, any form-check or attached-photo frames you confirm, and, for "Ask AI to invent one" on Surprise me, your remaining calories and macros for the day, your diet preferences and any craving you typed, go to the provider you choose, under that provider's terms. Asking AI to switch an exercise sends only that exercise's name, its muscle group, the sets/reps/weight you were doing, and any note you type about equipment you have or lack; nothing else about your workout or plan. Use a local model if that matters.
- **Hosting is part of your trust.** Whoever serves the files could serve different code. Host it yourself, pin what you deploy, and review updates as you would any app you trust with health data.
- **The food database is a filter, not medical advice.** Vegetarian and non-vegetarian tags come from rules over names and categories. Check labels if it matters for allergy, religion or health.
- **Downloaded photos, images, videos and reels are unblurred and not encrypted.** Regoal builds them on your device and warns you before each one; where they go after you tap Save or share (Photos, iCloud, a chat app) is up to you.
- **Backups you choose not to encrypt are readable text.** Regoal warns you when you turn encryption off.
- **A forgotten backup passphrase cannot be recovered.** That is the point.

## Reporting a problem

This is a personal project. If you find a security issue, open a private report with the maintainer of your copy, or email them directly rather than posting details publicly.
