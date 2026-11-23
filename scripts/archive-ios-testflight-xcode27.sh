#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Users/user/Downloads/Xcode-beta.app/Contents/Developer}"

TEAM_ID="${TEAM_ID:-}"
BUNDLE_ID="${BUNDLE_ID:-com.randyduquette.llmm}"
MARKETING_VERSION="${MARKETING_VERSION:-0.4.0}"
BUILD_NUMBER="${BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"
CONFIGURATION="${CONFIGURATION:-Release}"
APP_DISPLAY_NAME="${APP_DISPLAY_NAME:-LLMm}"
NODE_BINARY="${NODE_BINARY:-$(command -v node)}"
OFFLINE_JS_E2E="${OFFLINE_JS_E2E:-0}"
OFFLINE_JS_RESET_CACHE="${OFFLINE_JS_RESET_CACHE:-1}"
MINIFY_JS="${MINIFY_JS:-1}"
EXPORT_DESTINATION="${EXPORT_DESTINATION:-export}"
UPLOAD_TO_TESTFLIGHT="${UPLOAD_TO_TESTFLIGHT:-0}"
VALIDATE_IPA="${VALIDATE_IPA:-1}"
EXPORT_IPA="${EXPORT_IPA:-1}"

BUILD_DIR_PATH="${BUILD_DIR_PATH:-$ROOT/ios/build/testflight}"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-$BUILD_DIR_PATH/DerivedData}"
ARCHIVE_PATH="${ARCHIVE_PATH:-$BUILD_DIR_PATH/LLMm.xcarchive}"
EXPORT_PATH="${EXPORT_PATH:-$BUILD_DIR_PATH/export}"
OFFLINE_BUNDLE_DIR="$BUILD_DIR_PATH/offline-js"
EXPORT_OPTIONS_PLIST="$BUILD_DIR_PATH/ExportOptions.plist"

if [[ "$OFFLINE_JS_E2E" == "1" || "$OFFLINE_JS_E2E" == "true" ]]; then
  OFFLINE_JS_E2E_BUILD="true"
else
  OFFLINE_JS_E2E_BUILD="false"
fi

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
      sed -nE 's/.*"Apple (Development|Distribution): .* \(([A-Z0-9]{10})\)".*/\2/p' |
      head -n 1
  )"
fi

if [[ -z "$TEAM_ID" ]]; then
  echo "No Apple Developer team found. Set TEAM_ID=<10-char team id> and rerun." >&2
  exit 1
fi

ARCHIVE_SIGNING_IDENTITY="$(
  security find-identity -v -p codesigning 2>/dev/null |
    awk -v team="$TEAM_ID" '
      $0 ~ "Apple Development:" && $0 ~ "\\(" team "\\)" {
        print $2
        exit
      }
    '
)"

if [[ -z "$ARCHIVE_SIGNING_IDENTITY" ]]; then
  ARCHIVE_SIGNING_IDENTITY="Apple Development"
fi

mkdir -p "$BUILD_DIR_PATH" "$EXPORT_PATH"

echo "Preparing TestFlight archive"
echo "  Team: $TEAM_ID"
echo "  Bundle ID: $BUNDLE_ID"
echo "  Version: $MARKETING_VERSION ($BUILD_NUMBER)"
echo "  E2E automation bundle: $OFFLINE_JS_E2E_BUILD"
echo "  Minify JS: $MINIFY_JS"
echo "  Export IPA: $EXPORT_IPA"

echo "Building offline Hermes JS bundle"
rm -rf "$OFFLINE_BUNDLE_DIR"
mkdir -p "$OFFLINE_BUNDLE_DIR/assets"

bundle_args=(
  --entry-file "$ROOT/index.js"
  --platform ios
  --dev false
  --bundle-output "$OFFLINE_BUNDLE_DIR/main.jsbundle"
  --assets-dest "$OFFLINE_BUNDLE_DIR/assets"
)

if [[ "$MINIFY_JS" == "1" || "$MINIFY_JS" == "true" ]]; then
  bundle_args+=(--minify true)
else
  bundle_args+=(--minify false)
fi

if [[ "$OFFLINE_JS_RESET_CACHE" == "1" || "$OFFLINE_JS_RESET_CACHE" == "true" ]]; then
  bundle_args+=(--reset-cache)
fi

CONFIGURATION="$CONFIGURATION" E2E_BUILD="$OFFLINE_JS_E2E_BUILD" "$NODE_BINARY" "$ROOT/node_modules/react-native/cli.js" bundle \
  "${bundle_args[@]}"

"$ROOT/ios/Pods/hermes-engine/destroot/bin/hermesc" \
  -emit-binary \
  -max-diagnostic-width=80 \
  -O \
  -out "$OFFLINE_BUNDLE_DIR/main.hbc.jsbundle" \
  "$OFFLINE_BUNDLE_DIR/main.jsbundle"

echo "Archiving app"
rm -rf "$ARCHIVE_PATH"

SKIP_BUNDLING=1 xcodebuild archive \
  -workspace "$ROOT/ios/PocketPal.xcworkspace" \
  -scheme PocketPal \
  -configuration "$CONFIGURATION" \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  -allowProvisioningUpdates \
  CODE_SIGN_STYLE=Automatic \
  CODE_SIGN_IDENTITY="Apple Development" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
  MARKETING_VERSION="$MARKETING_VERSION" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  INFOPLIST_KEY_CFBundleDisplayName="$APP_DISPLAY_NAME" \
  PROVISIONING_PROFILE_SPECIFIER= \
  -quiet

app_path="$(
  find "$ARCHIVE_PATH/Products/Applications" -maxdepth 1 -type d -name '*.app' |
    head -n 1
)"

if [[ -z "$app_path" ]]; then
  echo "Archive succeeded but no .app was found under $ARCHIVE_PATH/Products/Applications" >&2
  exit 1
fi

echo "Patching archived app bundle: $app_path"
cp "$OFFLINE_BUNDLE_DIR/main.hbc.jsbundle" "$app_path/main.jsbundle"
ditto "$OFFLINE_BUNDLE_DIR/assets" "$app_path"

app_icon_source="$ROOT/ios/PocketPal/Images.xcassets/AppIcon.appiconset/App_store_1024_1x.png"
app_icon_document="$ROOT/ios/PocketPal/AppIcon.icon"
if [[ -d "$app_icon_document" ]]; then
  echo "Compiling Icon Composer app icon into archive"
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
    --platform iphoneos >/dev/null

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
fi

resign_entitlements="$BUILD_DIR_PATH/LLMm.archive.entitlements"
/usr/bin/codesign -d --entitlements :- "$app_path" >"$resign_entitlements" 2>/dev/null
/usr/bin/codesign \
  --force \
  --sign "$ARCHIVE_SIGNING_IDENTITY" \
  --timestamp=none \
  --entitlements "$resign_entitlements" \
  "$app_path"

codesign --verify --strict --verbose=2 "$app_path"

if [[ "$EXPORT_IPA" == "0" || "$EXPORT_IPA" == "false" ]]; then
  echo "Archive ready: $ARCHIVE_PATH"
  echo "Skipping IPA export because EXPORT_IPA=$EXPORT_IPA"
  exit 0
fi

cat >"$EXPORT_OPTIONS_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>destination</key>
  <string>$EXPORT_DESTINATION</string>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>method</key>
  <string>app-store-connect</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>teamID</key>
  <string>$TEAM_ID</string>
  <key>testFlightInternalTestingOnly</key>
  <false/>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
PLIST

echo "Exporting IPA"
rm -rf "$EXPORT_PATH"
mkdir -p "$EXPORT_PATH"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS_PLIST" \
  -allowProvisioningUpdates \
  -quiet

ipa_path="$(
  find "$EXPORT_PATH" -maxdepth 1 -type f -name '*.ipa' |
    head -n 1
)"

if [[ -z "$ipa_path" ]]; then
  echo "Export completed but no IPA was found in $EXPORT_PATH" >&2
  exit 1
fi

echo "IPA ready: $ipa_path"

altool_auth_args=()
if [[ -n "${APP_STORE_CONNECT_API_KEY_PATH:-}" ]]; then
  export API_PRIVATE_KEYS_DIR="$(cd "$(dirname "$APP_STORE_CONNECT_API_KEY_PATH")" && pwd)"
fi

if [[ -n "${APP_STORE_CONNECT_API_KEY_ID:-}" && -n "${APP_STORE_CONNECT_API_ISSUER_ID:-}" ]]; then
  altool_auth_args=(--api-key "$APP_STORE_CONNECT_API_KEY_ID" --api-issuer "$APP_STORE_CONNECT_API_ISSUER_ID")
elif [[ -n "${APPLE_ID_USERNAME:-}" && -n "${APPLE_ID_APP_PASSWORD:-}" ]]; then
  altool_auth_args=(-u "$APPLE_ID_USERNAME" -p "$APPLE_ID_APP_PASSWORD")
fi

if [[ "$VALIDATE_IPA" == "1" || "$VALIDATE_IPA" == "true" || "$UPLOAD_TO_TESTFLIGHT" == "1" || "$UPLOAD_TO_TESTFLIGHT" == "true" ]]; then
  if [[ "${#altool_auth_args[@]}" -eq 0 ]]; then
    echo "Skipping App Store validation/upload because no App Store Connect credentials were provided."
    echo "Set APP_STORE_CONNECT_API_KEY_ID and APP_STORE_CONNECT_API_ISSUER_ID, with AuthKey_<key>.p8 in ~/.appstoreconnect/private_keys, then rerun."
  else
    echo "Validating IPA with App Store Connect"
    xcrun altool --validate-app -f "$ipa_path" "${altool_auth_args[@]}"

    if [[ "$UPLOAD_TO_TESTFLIGHT" == "1" || "$UPLOAD_TO_TESTFLIGHT" == "true" ]]; then
      echo "Uploading IPA to App Store Connect"
      xcrun altool --upload-package "$ipa_path" "${altool_auth_args[@]}" --show-progress
    fi
  fi
fi

cat <<SUMMARY

TestFlight artifact complete.
Archive: $ARCHIVE_PATH
IPA:     $ipa_path

Next:
  1. Create or confirm the App Store Connect app uses bundle id: $BUNDLE_ID
  2. Upload the IPA from Xcode Organizer or rerun with UPLOAD_TO_TESTFLIGHT=1 and App Store Connect API credentials.
  3. Add the processed build to an External Testing group for friends.
SUMMARY
