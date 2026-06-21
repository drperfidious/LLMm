# LLMm TestFlight Alpha

This is the friend-testing path for the iOS fork. It avoids the old upstream
Fastlane/match setup and uses the local Xcode 27 beta toolchain directly.

## App Store Connect setup

Create an App Store Connect app record before upload:

- Name: `LLMm`
- Bundle ID: `com.randyduquette.llmm`
- SKU: `llmm-ios-alpha`
- Platform: iOS

If a different bundle identifier already exists, pass it to the archive script:

```sh
BUNDLE_ID=com.randyduquette.your-existing-id scripts/archive-ios-testflight-xcode27.sh
```

## Build an IPA

```sh
DEVELOPER_DIR=/Users/user/Downloads/Xcode-beta.app/Contents/Developer \
scripts/archive-ios-testflight-xcode27.sh
```

Useful overrides:

```sh
TEAM_ID=L55NPDLDY2 \
BUNDLE_ID=com.randyduquette.llmm \
MARKETING_VERSION=0.1.0 \
BUILD_NUMBER=2026062001 \
scripts/archive-ios-testflight-xcode27.sh
```

For a faster local smoke archive, skip JS minification and IPA export:

```sh
EXPORT_IPA=0 MINIFY_JS=0 scripts/archive-ios-testflight-xcode27.sh
```

The package also exposes `yarn ios:testflight:archive` and
`yarn ios:testflight:upload`, but this machine currently needs Node `>=22.21.0`
for Yarn to run package scripts without `YARN_IGNORE_ENGINES=1`.

The script writes:

- Archive: `ios/build/testflight/LLMm.xcarchive`
- IPA: `ios/build/testflight/export/*.ipa`

It also patches the archive before export so TestFlight gets the same behavior
we validated locally:

- embedded offline Hermes `main.jsbundle`
- generated LLMm Icon Composer app icon
- `CFBundleIconName = AppIcon`
- automatic App Store Connect export signing

This Mac currently has an Apple Development certificate for team `L55NPDLDY2`.
If command-line IPA export fails because no Apple Distribution identity/profile
is available, use Xcode Organizer for the first upload and let Xcode create or
download the required distribution signing assets.

## Upload

The least surprising path is Xcode Organizer:

1. Open Xcode.
2. Window -> Organizer.
3. Select the `LLMm` archive.
4. Distribute App -> App Store Connect -> Upload.

The script can also upload with an App Store Connect API key:

```sh
mkdir -p ~/.appstoreconnect/private_keys
# Put AuthKey_<KEY_ID>.p8 in that folder.

APP_STORE_CONNECT_API_KEY_ID=<KEY_ID> \
APP_STORE_CONNECT_API_ISSUER_ID=<ISSUER_ID> \
UPLOAD_TO_TESTFLIGHT=1 \
scripts/archive-ios-testflight-xcode27.sh
```

## External tester group

Create an External Testing group named `Friends Alpha`, add the processed build,
and enable a private public link or invite specific emails.

Suggested "What to Test":

```text
LLMm is an on-device LLM chat and agent testing app. Please test:
- installing and launching cleanly
- downloading a small model and loading it
- Chat vs Agent mode behavior
- Talents setup, especially web search API key entry
- benchmark launch, progress, crashes, and storage cleanup
- app switching and returning without losing state

Known notes:
- Model downloads can be large.
- Web search requires a user-provided API key in Talents.
- No account is required for normal local model use.
```

Suggested Beta App Review note:

```text
LLMm is an on-device LLM chat and benchmark app based on PocketPal AI and
heavily modified for iOS testing. The app downloads user-selected GGUF model
files and runs inference locally. Web search is optional and requires a
user-provided API key in the Talents screen. No login is required for normal
local model testing.
```
