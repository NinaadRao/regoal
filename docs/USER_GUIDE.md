# User guide

How the bigger features work, in more detail than the README. For installing, see [INSTALL.md](INSTALL.md); for backups, see [BACKUP.md](BACKUP.md).

## Today: looking back at another date

The date under "Today" is a button. Tap it to jump to another day: step back and forward one day at a time, or pick a date directly, anywhere from the day your plan started up to today (never beyond). While you're looking at an earlier date, a banner says so with a one-tap way back, and everything on the page — the suggested workout, sets, the weigh-in card and the food total — is for that day, not today, so you can fill in a day you forgot to log at the time. Sets and weigh-ins you add are saved against the date you're viewing. The one exception is **Log food**, which always opens Fuel for today; the page says so under the food card when you're looking at another day. The monthly check-in prompt and the backup reminder only ever appear on the real today, since they're about where things stand right now, not about the day you happen to be looking at.

## Activity, streaks and moving your workout

**Log any workout.** Today and Progress have an Activity card, and Activity has the full screen (Today, then Details). **Log a workout**, choose what you did (strength training, swimming, football, tennis, badminton, pickleball, hot yoga, running, cycling, walking, HIIT and more, or *Other activity* with your own name), the date, how long, and how hard it was (easy, moderate or hard). Nothing here needs a watch or a phone sensor; everything is typed in. **Attach a photo (optional)** keeps a compressed copy on this device, the same way a Library photo does; it is never uploaded, and removing or replacing it deletes the old copy. Tap a workout in History to edit or delete it.

**Calories burnt are estimates.** Regoal uses (MET - 1) x your weight x hours, with MET values from the Compendium of Physical Activities for that activity and effort, and your weight from your weigh-ins. Pickleball has no official value, so its numbers are a middle-of-the-road guess. If your watch gives a number you trust more, type it in the Calories burnt box and it is used instead and marked "yours". Your calorie target already allows for training days, so there is no need to eat the active calories back. Fuel shows them for the day, and the coach can see them.

**Strength training.** Pick which workout you did (Push, Pull and so on, or Something else), then **Fill with the plan** or type sets, reps and load for each exercise; leave an exercise empty to skip it. Add any other exercise from the list or by name. The sets are saved as ordinary lift sets, so Hit, Partial and the charts on each lift update, and the weekly plan marks that workout done. If you already logged sets on Today, use **Add how long it took** there (or tap the day in History) to add the time and count the calories without entering the sets twice. Deleting a strength workout removes the sets that were logged with it.

**No equipment for one of today's exercises? Switch it.** Every exercise on Today's workout card, and every one in the Log a workout sheet, has a small switch icon next to it (whenever Regoal knows its muscle group). Tap it and a built-in, offline list suggests other exercises for the same muscle, favouring different equipment than the one you're avoiding, with the sets, reps and starting weight carried over from what you were doing so you have somewhere sensible to start. Pick one and the row updates in place, with a note that it was switched from the original exercise; the set is then logged under the new exercise's name, not the old one, and your progression on the original lift is left untouched for next time. With your own AI key added, **Ask AI to suggest one instead** can also reason about a starting weight from the exercise, muscle group and your current plan, plus anything you type about what you have or lack (a resistance band, dumbbells only, and so on); you always see the suggested exercise, sets, reps and weight on an editable card, with a bodyweight toggle, before **Use this** applies it. On Today, a switch is for that day only and can be undone with the same icon's neighbour (**Switch back**) right up until you log the first set against it; once you've logged something, that choice is locked in for today so no history gets orphaned. Deciding before you start is the point of the feature, but the sets you already logged never disappear either way.

**Streaks.** A day counts as active when you log any workout or any working set (warm-ups do not count). The *day streak* counts consecutive active days, and today never breaks it: it only ends after a full day without activity. The *week streak* counts weeks in a row (plan weeks) that reach your goal of active days; the default is your number of training days, and you can change it from 2 to 7 at the bottom of Activity. The week in progress never breaks a streak either. There is also a 14-day strip, a weekly log with time, calories and sessions done, and trend charts.

**The plan is a suggestion.** The plan gives each workout a weekday, but weeks change. On Today, **Change** lets you move the workout to another day (if that day has a session, they swap), do a different session instead, or skip it for the week. On a rest day, **Train anyway** pulls a session forward. Lift targets, calories and weekly checks do not depend on the weekday. A session counts as done on whatever day you trained it, and a session you moved or skipped is not treated as a miss, by the app or by the coach.

**See what a day involves.** Activity's "This week" list shows every day's session for the current plan week. Tap a day (Monday's Push day, say) to see its exercises and the target sets, reps and load for that week, without having to wait until it is actually that day. Today also has a **See what's coming up** link, on the workout card and the rest-day card alike, that lists the next 7 days regardless of where the plan week ends, so "what's tomorrow" always has an answer, not just a name.

**Coach.** The coach gets a summary (streaks, active days against your goal, this week's sessions and whether they were done, the last four weeks, a 28-day mix of activities with minutes and estimated calories, your last ten workouts and any moved sessions) so it can spot patterns, such as too little recovery or lifting slipping in a heavy sports week. It never sees workout notes. It can propose logging a workout or moving a session, and you tap Apply like any other change.

**Coach: changing your workouts.** Tell the coach what you want and it proposes the change, shown as a card with Apply and (afterwards) Undo. It can swap one exercise for another, add or remove one, change sets, reps or rest, or **rewrite a whole session** into a different set of exercises for the same muscles, so Push does not have to be the same every week. It can also put sessions on **different weekdays for good**, for example Pull on Monday and Push on Tuesday: this applies from today on, every week, and days already gone keep what they showed. (Moving just one day is still done with Change on Today.) A new exercise is a plain one you log as you go; if you tell the coach what you lift, it is tracked with weekly targets like your other lifts. A tracked exercise that a rewrite leaves out stops being tracked, but every set you logged stays. If a planned weight is plainly wrong, the coach can correct it from this week on, beyond the usual 10 percent limit. Session names never change.

## Water

**A goal from your own numbers.** Today has a Water card with a daily goal built from your body weight (about 35 ml per kg) plus extra for the minutes you trained that day (capped so a huge workout doesn't push the goal unreasonably high). There is nothing to configure; the goal recalculates itself each day from your latest weigh-in and that day's logged activity.

**Logging.** Tap one of the quick-add pills for a common amount, or **Log a custom amount** for anything else. Today's entries are listed underneath with a small remove button on each one, and removing an entry (like any other correction in Regoal) voids it rather than deleting your history outright.

**The pacing note is not a push notification.** Regoal has no server, so it cannot send you a real notification once the app or tab is closed — nothing here tries to. Instead, while you have Today open between 7am and 10pm, the card compares what you've logged against an even pace for the time of day and, if you're meaningfully behind, shows a line saying so. Close the app and the nudge is simply gone until you open it again; reaching your goal for the day replaces it with a plain "Goal reached" line. It's a guideline from your weight and training, not medical advice.

**Units.** Water follows the same "Auto" pattern as other measurements: by default it shows ml or fl oz based on whether your body weight is in kg or lb, and you can pin it to one or the other from **Water** in Settings, Units.

## Goals: several at once, in cycles

The **Goals** tab is where everything you are working towards lives. The switcher at the top reads **All goals** (one card each, with status and this week's target), **Strength and muscle** (your training plan, with the lifts underneath), and every goal you add. Tap the **+** to add one.

<p align="center"><img src="img/goals.png" width="190" alt="All goals"> <img src="img/goal-detail.png" width="190" alt="One goal in detail"> <img src="img/goal-add.png" width="190" alt="Adding a goal"> <img src="img/goal-custom.png" width="190" alt="A number you track yourself"></p>

**What you can aim for.** *Run, ride or swim* goals can be a distance (a 5K, 10K, half marathon, marathon, or a 1 km swim, or any distance you type), a pace over a distance, or a weekly volume. *Something else* is any number you type in yourself: pull-ups, a resting heart rate, steps a day. It works upwards or downwards; you enter a reading whenever you have one and the app draws a straight line from where you are to the target over the time you chose.

**How long.** Every goal has its own length: 1, 2, 3, 6, 9 or 12 months, or any number of weeks up to 104 under **Custom**. The strength plan works the same way. Under Goals, then Strength and muscle, **Change length** (or Plan settings) makes it shorter or longer without touching anything you have logged: the lift targets keep climbing, the deload weeks and photo weeks move, and body measurement targets scale with the length.

**The week-by-week path.** For an endurance goal Regoal builds a path from where you are now (your longest recent session, your typical week, or the pace you type) to the target. Distance goals build about 10 percent a week, with a lighter week after every third build week and a taper of one to three weeks before the day. Each week you see what it asks for, what you did, and whether you are **Ahead**, **On track** or **Behind**. If the time you chose is shorter than a gentle build needs, a note says so and how many weeks would be easier. It is a rule of thumb from what you logged, not a coach, and it is not medical advice. If you are new to running, unwell or coming back from an injury, go slower than any plan.

**Counting your workouts.** A run, ride or swim counts towards its goals once you give it a distance: the Log a workout sheet has an optional **Distance** box, in your units (miles or km, and metres or yards for swimming), with a small **km/mi** toggle right below it for that one entry. The sheet shows your pace as you type. Workouts without a distance still count as activity and towards streaks.

**Distance unit.** By default it follows Measurements in Settings, Units (inches means miles, centimetres means km), the same as it always has. To pick km or miles on its own, without changing your height and measurement unit, set **Distance** in that same Units card; **Auto** goes back to following Measurements. Swimming always shows metres or yards for shorter distances under that choice, switching to km or miles itself past about 3 km. That Settings choice only sets the *default* you start from each time; the toggle on the Log a workout sheet lets you type any one workout in the other unit (say, miles from a race that measured in miles) without changing it for every other workout. Switching the toggle converts whatever you already typed rather than clearing it, and it is always stored in km underneath either way, so nothing about how it is measured or shown elsewhere changes.

**Goals change.** **Edit goal** changes the name, target, length and start date (past readings stay). **Close goal** moves it to *Past goals*; **Reopen** brings it back. **Delete** removes the goal and the readings you typed for it, and keeps your workouts.

**Going again.** When a cycle ends you get a short review: what you reached, how many weeks were on target, and a suggested next step (the next race on the ladder from 5K to marathon, more weeks if you fell short). **Start the next cycle** opens the goal sheet with those numbers filled in, and you can change any of them. The new goal remembers the one it follows.

**Coach.** The coach sees a short summary of each goal (name, aim, week, status, progress and this week's target), so it can help you plan around them. It can suggest edits in words but cannot change a goal; you make those in the Goals tab. Goal names and numbers go out with the rest of the summary when you chat. The note on a goal never does.

## Lifts: track as many as you like

Goals, then **Strength and muscle**, then **Add a lift**. About 40 are built in (barbell, dumbbell, machine, cable and bodyweight); pick one, enter a weight and reps you can do for a solid set, and Regoal builds the same week-by-week progression for it. **Something else** lets you add your own: name, muscle, equipment, whether it is a heavy compound, medium or high-rep lift, and where you are now. Choose which workout it goes on, the best fit for the muscle, or none if you only want to track it. There is no limit. On a lift's page, **Stop tracking this lift** removes it from your targets; your logged sets stay in your history and the exercise stays in its workout as a plain one. Onboarding has the same **Add another lift** button.

**Did more than today's plan?** On Today's workout card, **+ Add an exercise** logs one more lift for just that day: pick from the catalog (a lift already tracked, or not) or type any name. It is logged with `Log set` like the rest of the day and shows in its own row, but it does not add anything to your ongoing plan or its progression. It works on rest days too (**+ Log an exercise anyway**), for the day you trained when nothing was scheduled.

## Your diet plan

Right after your macros in setup there is a **Diet plan** card. Pick how you eat (or leave it on **Same as my profile**), your cuisine (Indian, Western or Mixed), how many meals a day (3, 4 or 5), foods to leave out (dairy, eggs, nuts, gluten, soy) and any foods you dislike. A sample day shows straight away. You can change all of it later under Profile or Plan settings, **Diet preferences**.

**Open diet plan** (from Profile, Plan settings or Fuel) shows a day at a time with gram portions for every food: countable foods are whole pieces (3 idlis, 2 eggs, 1 scoop). The totals sit close to your calories and macros. **Swap** replaces one meal with another that fits, **Shuffle the week** starts a different rotation, and **Log this meal** adds each food to today's Fuel log as its own entry, which you can edit or delete like any other. Nothing is logged unless you tap.

How it works: Regoal has about 55 everyday foods and close to 70 meal ideas. Your choices filter the ideas, then each meal's portions are nudged, one step at a time, until the meal lands near its share of your day. If protein is short, a protein food that suits your diet (whey, Greek yogurt, egg whites, plant protein, and so on) is added. The same preferences always give the same week. This is a suggestion from tables, not medical advice; if you have an allergy or a health condition, check with a professional.

**What should I eat next?** sits on Fuel, under Add food, for today. It works out what is left of your calories and macros after everything you logged, picks the next meal you have not logged (or the one you choose), and offers up to three meals with portions fitted to what is left. If you ate a big breakfast, lunch gets smaller portions. If protein is behind, it suggests a quick top-up. **Log this** adds it to today.

**Surprise me** sits further down Fuel, for today. Tap it for a healthy, high-protein dessert idea (chocolate Greek yogurt, a protein pudding, energy bites, dark chocolate and almonds, and so on) sized to what is left of today's calories, and it still follows your diet style, cuisine and what you leave out or dislike. If there is barely any room left in the day, it says so instead of forcing one in. **Surprise me again** picks a different idea from the same built-in shortlist; **Log this** adds it to today as a Snack. With your own AI key added, **Ask AI to invent one instead** asks your model to come up with its own dessert idea (you can add what you are craving), sized and filtered the same way. Like any AI estimate, you check and can edit the numbers on a confirmation card before **Looks right, log it** saves anything.

The optional AI buttons ("Ask for tips on this day", "Ask the coach about this", "Ask AI to invent one instead") send only what is needed as text to your provider, and only when you tap: the meals and your eating preferences for tips, or your remaining calories and macros, your diet preferences and any craving you typed for a "Surprise me" idea. "Ask for tips" and "Ask the coach" only return text and never log anything; "Ask AI to invent one" returns a dessert idea you must confirm, exactly like any other AI food estimate.

<p align="center"><img src="img/diet-plan.png" width="190" alt="The diet plan for a day"> <img src="img/eat-next.png" width="190" alt="What should I eat next? on Fuel"> <img src="img/diet-onboard.png" width="190" alt="The diet plan card in setup"></p>

## Your profile

Open Profile from the person icon on Today. It starts with the Regoal logo and the tagline, *Track the change. Not the vibes.*, the same as the welcome screen. **Edit** (or **Add name**) at the top and **Edit profile** under Basics open the same sheet: name, sex, age, height, body fat and diet style. Only what you change is saved, as one change you can undo, and it is kept in backups. The name is never sent to a coach. Weight is not edited here: it comes from your weigh-ins. Changing age, height or sex does not change your calorie and protein targets; those are in Plan settings (**Plan settings**, then **Edit targets** or **Change goal**).

<p align="center"><img src="img/profile.png" width="190" alt="Profile with the logo and tagline at the top"> <img src="img/profile-edit.png" width="190" alt="The Edit profile sheet"></p>

## Progress: weight, measurements and food

The Progress tab is where the numbers live. Body weight shows a 7-day average with every weigh-in as a grey dot and the average as a green line. **Measurements** lists the start, latest and six-month goal for each site you track, and once a site has two or more readings it also gets its own chart: a dot (and a line through them) for each reading, with your six-month goal as a dashed line. **Food, last 14 days** charts calories against your target, and below it, protein, carbs and fat each get the same treatment against their own targets, in grams; today is left out of all of these until it is finished, so a half-logged day cannot make the trend look worse than it is.

## Your photo trend

Take the same five angles at your weekly check-in. The day is yours to set in **Profile** (Friday to begin with); Today asks for it that day, stays on it until all five are saved, and flags any week you missed. Check-ins are named by their date (Fri, 18 Sep), never "week 5": the Photos screen has one list of dates, and the trend, compare and downloads all show dates. Then:

1. Progress, then **Open** on Progress photos, then **See trend** in the Your photo trend card. Pick an angle and drag along the check-in dots, or press play. The weight and measurements from around each photo's date sit under it, and green means the change is toward your goal.
2. **Compare two dates** lets you pick any two check-ins and view them side by side. The table underneath shows the change.
3. **Download time-lapse** makes a short video (Story, Square or Original shape) and **Download image** makes a comparison picture (JPEG or PNG). Both are built on your device. When one is ready, tap **Save or share** and choose Save to Photos or Files.

Not all photos line up the same way, so both the trend screen and Compare let you fix that. Tap **Align photo** (Trend) or **Align photos** (Compare) and the stage switches into align mode: drag a photo to pan it, and scroll, pinch or use the **−** / **+** buttons to zoom. In Compare, both photos are visible and draggable at once, no picking needed, and each gets its own **Before** and **After** **−** / **+** pair so you can zoom either one directly. **Reset** (or **Reset both**) clears it back to the plain centred crop. Whatever you land on is saved per photo and remembered next time, and it carries through to downloaded images and time-lapse videos too, not just the live preview.

If you would rather not nudge it by hand, **Auto-align with AI** (in Compare, once Align photos is on) can suggest a pan and zoom for the After photo. This is the one place Regoal ever sends a progress photo to AI, and only when you tap it: it tells you which provider the two check-in photos are about to go to and waits for you to confirm before sending anything. The result comes back as a live, editable suggestion on the After photo, not something applied automatically — drag or zoom it further, or **Discard suggestion** to go back to what you had, and nothing is saved until you tap **Use this**.

Two things to know about downloads. The saved file shows your photos **unblurred** and is **not encrypted**, so it is as private as wherever you put it. Regoal says so in each sheet. And a video is recorded in real time, so keep Regoal open on screen until it finishes. Videos are always MP4 (H.264), so they play on any phone or laptop and post to Instagram. A browser that cannot record MP4 hides the video option and you can still save the comparison image.

## The food database

Fuel's **Find** tab searches about 7,200 foods, each with calories, protein, carbs, fat and fibre per 100 g, and asks for the amount in grams. A filter under the search box shows **All**, **Veg**, **Veg + egg** or **Non-veg**; it starts from the diet you gave in Profile and remembers your choice. Type a word or the start of one ("paneer", "chick", "dal"). Many foods also answer to everyday Indian names ("atta", "dahi", "bhindi", "ghee").

Where it comes from, and what to watch for:

- The bundled rows are from the US **USDA SR Legacy** database (public domain), as arranged by TempoLife (CC-BY-4.0). They are one static file, `data/foods.json`, that the app fetches from its own address. Nothing is looked up online. See [data/SOURCES.md](../data/SOURCES.md) for the exact package, licences and how the file is built (`scripts/build-foods.mjs`).
- The vegetarian and non-vegetarian tags are worked out from the food's name and category by rules, and checked by tests, but they are a **filter, not a guarantee**. Cheese is tagged vegetarian even though some is made with animal rennet, and anything unclear (restaurant items, canned soups, branded products) is tagged "check the label" and appears only under All.
- USDA does not measure home-cooked Indian dishes, so a plate of rajma chawal is not in it. The short starter list of common dishes is labelled approximate, and the **Describe** and **Ingredients** tabs are for everything else. Both have an **Attach a photo** button: take or choose a picture of the plate or the label and the AI reads it alongside anything you typed.
- USDA carbohydrates include fibre. Regoal shows the number as the source gives it.

**Editing a logged food.** Tap any entry in the day's log to open it. Calories and macros are typed directly only once, while you are checking an AI estimate (Describe or Ingredients) before you tap **Looks right, log it**, or on Manual. After that, editing an entry changes its **portion** instead — grams for a Find/database food, or an "x" multiplier of what was logged for everything else (recent foods, a diet-plan serving, an AI estimate, a manual entry) — and calories and macros are recalculated from it automatically. Name and meal stay editable either way. If the entry came from an AI estimate, that same edit screen also shows **How it was worked out**: the raw ingredients and quantities the AI used to reach those numbers the first time, so you can still see what it assumed later, not just when you first confirmed it. That breakdown is a record of the original estimate and does not rescale if you adjust the portion above it. Picking the food again from Find's recent list (one tap, no new description needed) carries this breakdown along to the new entry too, so reusing a past AI estimate never loses the ingredients behind it.

## Your own food list

Want foods that are not in the bundled list, for example Indian Food Composition Tables values? Regoal does not ship those, because their publisher does not allow it. You can load a list you have the right to use, from a file on your device:

1. Fuel, **Add food**, **Find**, then **Add my own food list** at the bottom.
2. Choose a `.csv` or `.json` file. Regoal shows how many foods it can use and how many rows it skipped, and stores nothing until you tap **Use this list**.
3. Search as usual. Your foods show **My list** as their source and follow the same diet filter.

The list is kept **on this device only**. It is not in backups and never uploaded, so choose the file again on a new phone. **Replace** loads another file; **Remove** deletes it. Foods you already logged stay in your log either way.

**File format.** All values are per 100 g. A CSV needs a header row; `fibre`, `diet` and `aliases` are optional:

```
name,kcal,protein,carbs,fat,fibre,diet,aliases
Example millet flour,361,11.5,67.5,5,11.5,veg,bajra
```

`diet` is `veg`, `egg`, `nonveg` or `check` (anything else, or empty, becomes "check the label"). `aliases` are extra words that should find the food. A JSON file can be a list of the same objects, or `{"name": "My list", "foods": [ ... ]}`. Values must be numbers (kcal up to 900, the rest up to 100), and rows that are not are skipped. Files up to 15 MB and 30,000 foods are read. A working example is [food-import-example.csv](food-import-example.csv).

**IFCT 2017 (recommended for Indian foods).** The step-by-step version is in the README under [Food data](../README.md#food-data). The tables are copyright the National Institute of Nutrition (ICMR) in Hyderabad, and their terms allow personal use with acknowledgement. If you have a copy of the compositions table (`index.csv` from the `@ifct2017/compositions` package, fetched with `npm pack @ifct2017/compositions`), `node scripts/ifct-to-import.mjs index.csv --out ~/Documents/orbit-private/ifct.orbitfoods.json` converts it to this format, with diets and everyday names filled in. The script refuses to write inside the Regoal folder, and `*.orbitfoods.json` is ignored by git and blocked by the privacy check. Keep the file to yourself unless the Institute gives permission. IFCT lists available carbohydrate and usually raw foods, so weigh raw against a raw entry.

## Library, form check and reel

Progress, then **Open** on Workout photos and videos. **Add photos or videos** takes any number of them, tagged Workout, Form check, Personal best or Other, with an optional exercise and note.

**The original file is never copied.** For every item Regoal stores a preview picture (about 15 KB), the date, your tag and note, and the file's name and size. For a photo it also keeps a second, larger recompressed copy (roughly 100-300 KB, about 1600px) so you can view it again instantly, with no prompt - this is a recompression Regoal made, not the file itself. Videos keep only the small preview. The original stays in Photos or Files, so your phone does not hold everything twice. What that means where:

- **iPhone (Safari or the Home Screen app):** a web app cannot keep a link into your photo library. A photo opens at once from its stored compressed copy. A video still needs picking again to watch, or to use in a form check or reel - Regoal uses it in memory and lets go. This is the price of not copying the video file.
- **Chrome or Edge on a computer, and recent Chrome on Android:** Regoal can keep a real link to each file, so a video opens without asking again too. If you move or rename the file, the link stops working and you pick it again. If a link cannot be made, Regoal uses the normal file picker instead.

**Watching or viewing a photo or video.** Open an item and tap **Watch the original** for a video (the file picker opens on an iPhone; choose the same video again) or **View photo** for a photo (opens at once). If the browser cannot show a video file (some phone formats, such as HEVC, only open on Apple devices), Regoal says so instead of showing a blank box, and the original is still fine in Photos or Files.

A backup always includes the small previews. It includes the compressed photo copies and your progress photos too, but only when you turn on "Include progress and library photos" when backing up, since that makes the file much larger. It never includes the original files. Removing an item from Regoal does not touch the photo or video wherever you took it.

**Ask the coach about form.** Open an item and tap it. This always uses the original file, picked fresh (even for a photo with a stored compressed copy), so the frames the coach sees are full quality. For a video Regoal takes six still frames spread across it (one for a photo), shows them to you, and names the provider they will go to. Nothing is sent until you tap Send. They go with your own key, are not saved, and can show your face and surroundings. The coach says what it can see and suggests up to four cues; it cannot judge speed or feel, and it can be wrong. You can save the written review with the item.

**Make a reel.** Choose items from the library, optionally add your weekly check-in photos (already in Regoal), pick Story, Square or Wide, and how long each photo and video part lasts (long videos are trimmed to their middle). Regoal finds the originals (through saved links, or you pick them all at once and it matches them by name and size), then records the reel on your device as an MP4 with a title card, date and tag on each item, and no sound. It is recorded in real time, so keep Regoal open until it finishes. The result exists only until you save or share it. Like the time-lapse, it shows your photos unblurred and is not encrypted.

## The AI features and your key

Nothing in Regoal needs AI. If you want the coach or food estimates, Coach settings lets you choose Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter). The browser talks straight to that provider with your key, so it costs Regoal nothing and there is no shared AI.

Where the key can live:

| Mode | What happens |
| --- | --- |
| This device (default) | Enter it once. It is encrypted with a key the browser keeps and will not export, and loads by itself each time you open Regoal. Nothing to type again. |
| Passphrase | Stored encrypted with a passphrase (AES-256) on this device. You type the passphrase to unlock it. |
| Session | Held in memory. Closing the app forgets it. |
| From a key file | Read into memory from a file you pick. Never copied or stored. |

**When a key expires.** If the provider turns a key down (expired, revoked or mistyped), Regoal says so, drops that key, and opens a sheet asking for a new one. Paste it, leave **Remember it on this device** on, and tap Save key; the new one replaces the old. Coach settings then shows "Key rejected: update it" until you do. **Forget the saved key** in Coach settings deletes it from the device. Each provider keeps its own saved key.

**Be clear about what "This device" is.** It stops you retyping the key and keeps it out of backups, exports and the repository, but it is a convenience, not a vault. Anyone who can open Regoal on your unlocked device can use the key, so turn on the app lock in Settings if others use your phone. Use Passphrase if you want to type something each time. Safari can clear a website's storage after about a week without use unless the app is installed to the Home Screen, so install it (see [INSTALL.md](INSTALL.md)) and the key will stay. If it is ever cleared, Regoal simply asks again.

The key is never included in backups, never written to logs and never put in the repository. Model names change over time; the default is a starting point, so use one from your provider's docs.

What the AI sees: the coach gets a summary of your numbers (weight, measurements, lift status, today's food log and a 7-day average), not your name and not your progress photos or library. The photo trend, downloads and reel never call any AI. A food estimate gets the text you typed, or a photo of the food or its label if you attach one, or both. In the coach chat, the camera button next to the message box lets you attach a photo too (a form, a label, a meal); it is only sent when you tap Send, alongside your message. A form check sends the few frames you confirmed, and nothing else. Asking AI to switch an exercise sends the exercise's name, its muscle group, the sets/reps/weight you were doing, and any note you type about what equipment you have or lack; nothing else about your workout or plan. No photo is ever sent unless you attach or confirm it yourself for that one message.

Using another endpoint: the Content Security Policy in `index.html` lists the only places the app may connect to. Add your endpoint's origin to `connect-src` once (for example `https://openrouter.ai`) and reload. `http://localhost` is already allowed for local models.
