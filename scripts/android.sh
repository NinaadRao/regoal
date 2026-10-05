#!/bin/sh
# Builds the Android app (an APK) from this folder. See docs/ANDROID.md.
#   sh scripts/android.sh            a debug APK you can install straight away
#   sh scripts/android.sh release    a signed release APK (asks for a keystore password the first time)
#   sh scripts/android.sh open       prepare everything, then open the project in Android Studio
# Needs: Node 22+, JDK 21, and the Android SDK (Android Studio installs it). Nothing is uploaded anywhere.
set -e
cd "$(dirname "$0")/.."
MODE="${1:-debug}"

fail() { echo "Android build: $1" >&2; exit 1; }
command -v node >/dev/null || fail "Node 22 or newer is needed."
command -v java >/dev/null || fail "JDK 21 is needed (for example: brew install --cask temurin@21)."

[ -d node_modules/@capacitor/cli ] || npm install

sh scripts/make-site.sh >/dev/null
[ -d android ] || npx cap add android
npx cap sync android

# Regoal's own icon and a plain dark splash, instead of Capacitor's defaults.
RES=android/app/src/main/res
for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do cp icons/android/mipmap-$d/*.png "$RES/mipmap-$d/"; done
sed -i.bak 's/#FFFFFF/#111813/' "$RES/values/ic_launcher_background.xml" && rm -f "$RES/values/ic_launcher_background.xml.bak"
find "$RES" -name splash.png -delete
cat > "$RES/drawable/splash.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#090D0B" />
</shape>
XML

# Where the Android SDK is: ANDROID_HOME, ANDROID_SDK_ROOT, or the Android Studio default.
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] || for c in "$HOME/Library/Android/sdk" "$HOME/Android/Sdk"; do [ -d "$c" ] && SDK="$c"; done
[ -n "$SDK" ] || fail "could not find the Android SDK. Install Android Studio, open it once, then try again (docs/ANDROID.md)."
echo "sdk.dir=$SDK" > android/local.properties

if [ "$MODE" = open ]; then npx cap open android; exit 0; fi

cd android
if [ "$MODE" = release ]; then
  ./gradlew assembleRelease
  UNSIGNED=app/build/outputs/apk/release/app-release-unsigned.apk
  APKSIGNER=$(ls -d "$SDK"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1)
  [ -n "$APKSIGNER" ] || fail "apksigner not found. In Android Studio: SDK Manager, SDK Tools, install Build-Tools."
  KS="${REGOAL_KEYSTORE:-$HOME/.regoal/regoal-release.jks}"
  if [ ! -f "$KS" ]; then
    mkdir -p "$(dirname "$KS")"
    echo "Creating your signing key at $KS. Keep this file and its password safe: updates must be signed with the same key."
    keytool -genkeypair -v -keystore "$KS" -alias regoal -keyalg RSA -keysize 4096 -validity 10000
  fi
  OUT="$(pwd)/../regoal-release.apk"
  "$APKSIGNER" sign --ks "$KS" --ks-key-alias regoal --out "$OUT" "$UNSIGNED"
  echo "Ready: $OUT"
else
  ./gradlew assembleDebug
  cp app/build/outputs/apk/debug/app-debug.apk ../regoal-debug.apk
  echo "Ready: $(cd .. && pwd)/regoal-debug.apk"
fi
