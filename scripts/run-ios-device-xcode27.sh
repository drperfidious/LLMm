#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Users/user/Downloads/Xcode-beta.app/Contents/Developer}"

TEAM_ID="${TEAM_ID:-}"
BUNDLE_ID="${BUNDLE_ID:-com.randyduquette.pocketpal.dev}"
CONFIGURATION="${CONFIGURATION:-Debug}"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-$ROOT/ios/build/DerivedData}"
BUILD_DIR_PATH="${BUILD_DIR_PATH:-$ROOT/ios/build}"
METRO_LOG="${METRO_LOG:-$ROOT/ios/build/metro.log}"
NODE_BINARY="${NODE_BINARY:-$(command -v node)}"
OFFLINE_JS_BUNDLE="${OFFLINE_JS_BUNDLE:-1}"
OFFLINE_JS_E2E="${OFFLINE_JS_E2E:-1}"
OFFLINE_JS_RESET_CACHE="${OFFLINE_JS_RESET_CACHE:-1}"

if [[ "$OFFLINE_JS_E2E" == "1" || "$OFFLINE_JS_E2E" == "true" ]]; then
  OFFLINE_JS_E2E_BUILD="true"
else
  OFFLINE_JS_E2E_BUILD="false"
fi

if [[ -z "${DEVICE_ID:-}" ]]; then
  DEVICE_ID="$(
    xcodebuild -showdestinations \
      -project "$ROOT/ios/PocketPal.xcodeproj" \
      -scheme PocketPal \
      -configuration "$CONFIGURATION" \
      -destination-timeout 30 2>/dev/null |
      awk '
        /platform:iOS/ && /arch:arm64/ && $0 !~ /Simulator/ && $0 !~ /placeholder/ {
          if (match($0, /id:[^, }]+/)) {
            print substr($0, RSTART + 3, RLENGTH - 3)
            exit
          }
        }
      '
  )"
fi

if [[ -z "${DEVICE_ID:-}" ]]; then
  DEVICE_ID="$(
    xcrun xctrace list devices 2>/dev/null |
      awk '
        /== Devices ==/ { seen = 1; next }
        seen && $0 !~ /Simulator|Mac/ { print; exit }
      ' |
      sed -E 's/.*\(([0-9A-Fa-f-]{8,})\).*/\1/'
  )"
fi

if [[ -z "${DEVICE_ID:-}" || ! "$DEVICE_ID" =~ ^[0-9A-Fa-f-]{8,}$ ]]; then
  echo "No physical iOS device found. Set DEVICE_ID=<uuid> and rerun." >&2
  exit 1
fi

echo "Using iOS device $DEVICE_ID"

if [[ -z "$TEAM_ID" ]]; then
  TEAM_ID="$(
    find "$HOME/Library/Developer/Xcode/UserData/Capabilities" -maxdepth 1 -type f -name 'capabilities-*-??????????-bundle.json' 2>/dev/null |
      sed -nE 's/.*-([A-Z0-9]{10})-bundle\.json/\1/p' |
      sort -u |
      head -n 1
  )"
fi

if [[ -z "$TEAM_ID" ]]; then
  TEAM_ID="$(
    security find-identity -v -p codesigning 2>/dev/null |
      sed -nE 's/.*"Apple Development: .* \(([A-Z0-9]{10})\)".*/\1/p' |
      head -n 1
  )"
fi

if [[ -z "$TEAM_ID" ]]; then
  echo "No Apple Developer team found. Set TEAM_ID=<10-char team id> and rerun." >&2
  exit 1
fi

echo "Using Apple Developer team $TEAM_ID"

SIGNING_IDENTITY="$(
  security find-identity -v -p codesigning 2>/dev/null |
    awk -v team="$TEAM_ID" '
      $0 ~ "Apple Development:" && $0 ~ "\\(" team "\\)" {
        print $2
        exit
      }
    '
)"

if [[ -z "$SIGNING_IDENTITY" ]]; then
  SIGNING_IDENTITY="Apple Development"
fi

mkdir -p "$BUILD_DIR_PATH"

build_overrides=(
  "SYMROOT=$BUILD_DIR_PATH"
  "BUILD_DIR=$BUILD_DIR_PATH"
)

if [[ "${RELAX_ENTITLEMENTS:-0}" == "1" ]]; then
  relaxed_entitlements="$BUILD_DIR_PATH/PocketPal.local-debug.entitlements"
  cat >"$relaxed_entitlements" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>keychain-access-groups</key>
  <array>
    <string>\$(AppIdentifierPrefix)$BUNDLE_ID</string>
  </array>
</dict>
</plist>
PLIST
  build_overrides+=("CODE_SIGN_ENTITLEMENTS=$relaxed_entitlements")
fi

if ! lsof -nP -iTCP:8081 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Starting Metro on 0.0.0.0:8081"
  nohup "$NODE_BINARY" "$ROOT/node_modules/react-native/cli.js" start --host 0.0.0.0 >"$METRO_LOG" 2>&1 &
  sleep 3
fi

offline_bundle_dir="$BUILD_DIR_PATH/offline-js"
if [[ "$OFFLINE_JS_BUNDLE" == "1" ]]; then
  echo "Building offline Hermes JS bundle with E2E_BUILD=$OFFLINE_JS_E2E_BUILD"
  rm -rf "$offline_bundle_dir"
  mkdir -p "$offline_bundle_dir/assets"

  bundle_args=(
    --entry-file "$ROOT/index.js"
    --platform ios
    --dev false
    --bundle-output "$offline_bundle_dir/main.jsbundle"
    --assets-dest "$offline_bundle_dir/assets"
    --minify false
  )
  if [[ "$OFFLINE_JS_RESET_CACHE" == "1" || "$OFFLINE_JS_RESET_CACHE" == "true" ]]; then
    bundle_args+=(--reset-cache)
  fi

  E2E_BUILD="$OFFLINE_JS_E2E_BUILD" "$NODE_BINARY" "$ROOT/node_modules/react-native/cli.js" bundle \
    "${bundle_args[@]}"

  "$ROOT/ios/Pods/hermes-engine/destroot/bin/hermesc" \
    -emit-binary \
    -max-diagnostic-width=80 \
    -O \
    -out "$offline_bundle_dir/main.hbc.jsbundle" \
    "$offline_bundle_dir/main.jsbundle"
fi

echo "Building Pods for iOS device"
xcodebuild build \
  -project "$ROOT/ios/Pods/Pods.xcodeproj" \
  -scheme Pods-PocketPal \
  -configuration "$CONFIGURATION" \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  CODE_SIGNING_ALLOWED=NO \
  "${build_overrides[@]}" \
  -quiet

app_path="$BUILD_DIR_PATH/$CONFIGURATION-iphoneos/PocketPal.app"
rm -rf "$app_path"

echo "Building PocketPal for device $DEVICE_ID"
SKIP_BUNDLING=1 xcodebuild build \
  -project "$ROOT/ios/PocketPal.xcodeproj" \
  -scheme PocketPal \
  -configuration "$CONFIGURATION" \
  -destination "id=$DEVICE_ID" \
  -destination-timeout 120 \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
  PROVISIONING_PROFILE_SPECIFIER= \
  CODE_SIGN_IDENTITY="Apple Development" \
  "${build_overrides[@]}" \
  -quiet

resign_required=0
resign_entitlements="$BUILD_DIR_PATH/PocketPal.resign.entitlements"

if [[ "$OFFLINE_JS_BUNDLE" == "1" ]]; then
  echo "Embedding offline JS bundle into $app_path"
  cp "$offline_bundle_dir/main.hbc.jsbundle" "$app_path/main.jsbundle"
  ditto "$offline_bundle_dir/assets" "$app_path"
  resign_required=1
fi

app_icon_source="$ROOT/ios/PocketPal/Images.xcassets/AppIcon.appiconset/App_store_1024_1x.png"
app_icon_document="$ROOT/ios/PocketPal/AppIcon.icon"
if [[ -d "$app_icon_document" ]]; then
  echo "Compiling Icon Composer app icon"
  icon_build_dir="$BUILD_DIR_PATH/icon-composer-appicon"
  rm -rf "$icon_build_dir"
  mkdir -p "$icon_build_dir/out"

  xcrun actool "$app_icon_document" \
    --app-icon AppIcon \
    --compile "$icon_build_dir/out" \
    --output-partial-info-plist "$icon_build_dir/info.plist" \
    --target-device iphone \
    --target-device ipad \
    --minimum-deployment-target 15.1 \
    --platform iphoneos

  cp "$icon_build_dir/out/Assets.car" "$app_path/Assets.car"
  cp "$icon_build_dir/out"/AppIcon*.png "$app_path"/

  if [[ -f "$app_icon_source" ]]; then
    sips -z 180 180 "$app_icon_source" --out "$app_path/AppIcon60x60@3x.png" >/dev/null
  fi

  /usr/libexec/PlistBuddy -c "Delete :CFBundleIcons" "$app_path/Info.plist" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Delete :CFBundleIcons~ipad" "$app_path/Info.plist" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Add :CFBundleIcons dict" "$app_path/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIcons:CFBundlePrimaryIcon dict" "$app_path/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIcons:CFBundlePrimaryIcon:CFBundleIconFiles array" "$app_path/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIcons:CFBundlePrimaryIcon:CFBundleIconFiles:0 string AppIcon60x60" "$app_path/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIcons:CFBundlePrimaryIcon:CFBundleIconName string AppIcon" "$app_path/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIcons~ipad dict" "$app_path/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIcons~ipad:CFBundlePrimaryIcon dict" "$app_path/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIcons~ipad:CFBundlePrimaryIcon:CFBundleIconFiles array" "$app_path/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIcons~ipad:CFBundlePrimaryIcon:CFBundleIconFiles:0 string AppIcon60x60" "$app_path/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIcons~ipad:CFBundlePrimaryIcon:CFBundleIconFiles:1 string AppIcon76x76" "$app_path/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIcons~ipad:CFBundlePrimaryIcon:CFBundleIconName string AppIcon" "$app_path/Info.plist"
  resign_required=1
elif [[ -f "$app_icon_source" ]]; then
  echo "Writing SpringBoard icon compatibility files"
  sips -z 120 120 "$app_icon_source" --out "$app_path/AppIcon60x60@2x.png" >/dev/null
  sips -z 180 180 "$app_icon_source" --out "$app_path/AppIcon60x60@3x.png" >/dev/null
  sips -z 152 152 "$app_icon_source" --out "$app_path/AppIcon76x76@2x~ipad.png" >/dev/null

  /usr/libexec/PlistBuddy -c "Delete :CFBundleIcons:CFBundlePrimaryIcon:CFBundleIconName" "$app_path/Info.plist" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Delete :CFBundleIcons~ipad:CFBundlePrimaryIcon:CFBundleIconName" "$app_path/Info.plist" >/dev/null 2>&1 || true
  resign_required=1
fi

if [[ "$resign_required" == "1" ]]; then
  /usr/bin/codesign -d --entitlements :- "$app_path" >"$resign_entitlements" 2>/dev/null
  /usr/bin/codesign \
    --force \
    --sign "$SIGNING_IDENTITY" \
    --timestamp=none \
    --entitlements "$resign_entitlements" \
    "$app_path"
fi

echo "Installing $app_path"
xcrun devicectl --timeout 120 device install app --device "$DEVICE_ID" "$app_path"

echo "Launching $BUNDLE_ID"
xcrun devicectl --timeout 60 device process launch --device "$DEVICE_ID" --terminate-existing "$BUNDLE_ID"
