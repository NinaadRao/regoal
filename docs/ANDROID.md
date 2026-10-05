# Regoal as an Android app (APK)

You can already install Regoal on Android from Chrome ([INSTALL.md](INSTALL.md)). This page is for turning it into a real `.apk` file you can install without Chrome or any web address, and keep as a file. It wraps the same app in [Capacitor](https://capacitorjs.com), so everything still runs on the phone, offline, with no server. Nothing is uploaded anywhere.

- [What you need](#what-you-need)
- [Build a debug APK](#build-a-debug-apk)
- [Install it on your phone](#install-it-on-your-phone)
- [Build a signed release APK](#build-a-signed-release-apk)
- [Updating](#updating)
- [What is different from the Chrome version](#what-is-different-from-the-chrome-version)
- [Before you share it or publish it](#before-you-share-it-or-publish-it)

## What you need

On the computer you build on (the APK itself is then just a file):

1. **Node 22 or newer** (check with `node -v`).
2. **JDK 21**. On a Mac: `brew install --cask temurin@21`.
3. **Android Studio**, opened once so it downloads the Android SDK. You do not need to use it for anything else. Under **Settings, Languages & Frameworks, Android SDK, SDK Tools**, make sure **Android SDK Build-Tools** is ticked (a release build needs it).

## Build a debug APK

From the project folder:

```sh
npm run android
```

The first run installs the Capacitor tools, creates the `android/` project, copies the app into it, gives it Regoal's icon and a plain dark launch screen, and builds. It takes a few minutes, mostly the first Gradle download. When it finishes it prints the file name: `regoal-debug.apk`, in the project folder.

Later runs only copy the latest app in and rebuild, so they are quick. The `android/` folder, the APK, and your signing key are in `.gitignore` and never go into the repository.

If it says it cannot find the Android SDK, set `ANDROID_HOME` to the SDK folder (Android Studio shows it under Settings, Android SDK). If you would rather build from Android Studio, run `npm run android:open`, which prepares everything and opens the project.

## Install it on your phone

A debug APK is not from the Play Store, so Android asks once for permission to install it.

1. Get `regoal-debug.apk` onto the phone: connect it by USB and run `adb install -r regoal-debug.apk`, or copy the file over (cable, Drive, AirDrop-style apps) and tap it in Files.
2. If Android says it cannot install from this source, tap **Settings** in that message and allow installs from the app you opened the file with (Files, Chrome, and so on). Then tap the file again.
3. Open **Regoal** from the app drawer and set it up.

## Build a signed release APK

A release build is the one to keep and hand to other people. It has to be signed with a key that only you hold.

```sh
npm run android:release
```

The first time, it creates a key at `~/.regoal/regoal-release.jks` and asks you to choose a password and answer a few questions (your name and so on are only stored inside the key file). Then it builds and writes `regoal-release.apk` in the project folder.

**Keep that key file and its password somewhere safe, with a backup.** Android only lets an app update itself in place when the new APK is signed with the same key. If you lose it you can still build, but people would have to uninstall first, and uninstalling deletes the app's data. To use a key stored elsewhere, set `REGOAL_KEYSTORE=/path/to/file.jks`.

The app's id is `app.regoal` (in `capacitor.config.json`). Change it before your first release build if you want your own, for example `com.yourname.regoal`. It cannot be changed later without it being treated as a different app. To raise the version number for an update, edit `versionCode` and `versionName` in `android/app/build.gradle` before building.

For the Play Store you would need an `.aab` instead (`cd android && ./gradlew bundleRelease`) and a Play developer account. That is not covered here.

## Updating

After changing the app, run `npm run android` (or `npm run android:release`) again, and install the new APK over the old one. Your data stays, as long as it is the same app id and, for release builds, the same signing key. Debug and release builds are signed differently, so Android will not install one over the other: pick one and stay with it on a given phone.

## What is different from the Chrome version

- **Your data is separate.** The app keeps its own storage, apart from Regoal in Chrome. To move over, make a backup in the old one ([BACKUP.md](BACKUP.md)) and restore it in the app.
- **Saving files uses Android's share sheet.** A web view cannot download files or use the browser's share feature, so **Save or share**, comparison images, time-lapse videos, reels and backups all open Android's own share sheet. Pick **Save to Files** (or Drive, Photos, WhatsApp, and so on). The app copies the file into its private cache first and replaces that copy the next time, so it does not pile up. There is no "pick a backup folder" option in the app: use the share sheet each time.
- **Same privacy.** The app asks Android for the internet permission only so the AI features can reach the provider you chose, with your own key, when you tap them. The page's security policy still allows nothing else.

## Before you share it or publish it

I could not run Android in the environment this was written in, so the build steps and the share sheet were checked against a stand-in for Capacitor, not on a real phone. Please try these once on a real phone and report what you see:

- It opens, onboarding works, and data is still there after closing the app from recent apps.
- Log a photo and a video from the library (the normal file picker should appear).
- Make a comparison image and a backup, and save each through the share sheet.
- Make a time-lapse and a reel. These record MP4 in real time, and a few phones' web views may not offer MP4. If the video option is missing, the image export still works.
- Turn off Wi-Fi and data: everything except the AI features should still work.
