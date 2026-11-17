#!/bin/zsh
# Builds the native MoneyMart iOS app on this Mac and, with UPLOAD=1, uploads it to TestFlight.
# Usage: scripts/release-ios.sh              -> signed Release archive only
#        UPLOAD=1 scripts/release-ios.sh     -> archive + upload to App Store Connect (TestFlight)
# Uploading never submits for App Review.
#
# Signing: team R7A65YU39K (Apple Distribution: RUBYNAV INC), automatic. The archive uses the App Store Connect
# API key in ~/.appstoreconnect (private_keys/AuthKey_<ASC_KEY_ID>.p8 + issuer_id), and so does the export/upload,
# so a release does not depend on Xcode's Apple Account session staying signed in.
# The build number is the next free number in App Store Connect.
# Same pattern as the other RubyNav apps' release scripts.
set -u
ROOT=${0:A:h:h}
cd $ROOT
[ -d /Volumes/MAC5/Development ] || { echo "MAC5 is not mounted; stopping"; exit 1; }
[ -z "$(git status --porcelain -- .)" ] || { echo "Uncommitted changes in apps/ios; release only committed source"; exit 1; }

BUNDLE_ID=com.rubynav.moneymart
TEAM=R7A65YU39K
ASC_KEY_ID=${ASC_KEY_ID:-992P7733ZH}
ASC_KEY=$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8
ASC_ISSUER=${ASC_ISSUER_ID:-$(cat $HOME/.appstoreconnect/issuer_id 2>/dev/null)}
[ -f $ASC_KEY ] && [ -n "$ASC_ISSUER" ] || { echo "Missing App Store Connect key or issuer_id in ~/.appstoreconnect"; exit 1; }
AUTH=(-allowProvisioningUpdates -authenticationKeyPath $ASC_KEY -authenticationKeyID $ASC_KEY_ID -authenticationKeyIssuerID $ASC_ISSUER)

DATA=/Volumes/MAC5/Development/DerivedData/MoneyMart-iOS
mkdir -p $DATA/Archives

# Build number: next free number in App Store Connect once the app record exists; BUILD_NUMBER overrides.
if [ -n "${BUILD_NUMBER:-}" ]; then
  BUILD=$BUILD_NUMBER
else
  ASC_APP=$(python3 -I scripts/asc.py app $BUNDLE_ID 2>/dev/null)
  if [ -n "$ASC_APP" ]; then
    BUILD=$(python3 -I scripts/asc.py next-build $ASC_APP) || { echo "Could not read build numbers from App Store Connect"; exit 1; }
  elif [ "${UPLOAD:-0}" = 1 ]; then
    echo "No App Store Connect app record for $BUNDLE_ID yet. Create it (My Apps > + > New App), then rerun."; exit 1
  else
    BUILD=1
  fi
fi
VERSION=$(awk -F'"' '/MARKETING_VERSION/{print $2; exit}' project.yml)
COMMIT=$(git rev-parse --short HEAD)
ARCHIVE=$DATA/Archives/MoneyMart-$VERSION-$BUILD-$COMMIT.xcarchive
LOG=$DATA/release-$BUILD.log
echo "START MoneyMart $VERSION ($BUILD) $COMMIT $(date +%T)" | tee $LOG

# 1. Generate the Xcode project (project.yml is the source; the .xcodeproj is not committed).
xcodegen generate >> $LOG 2>&1 || { echo "XCODEGEN FAILED (see $LOG)" | tee -a $LOG; exit 1; }

# 2. Signed Release archive.
xcodebuild -project MoneyMart.xcodeproj -scheme MoneyMart -configuration Release -destination "generic/platform=iOS" \
  -derivedDataPath $DATA/release -archivePath $ARCHIVE $AUTH \
  DEVELOPMENT_TEAM=$TEAM CODE_SIGN_STYLE=Automatic CURRENT_PROJECT_VERSION=$BUILD archive >> $LOG 2>&1 \
  && echo "ARCHIVE OK $(date +%T) $ARCHIVE" | tee -a $LOG || { echo "ARCHIVE FAILED (see $LOG)" | tee -a $LOG; exit 1; }

# 3. Optional upload to App Store Connect (TestFlight only; no review submission).
if [ "${UPLOAD:-0}" = 1 ]; then
  EXPORT_OPTIONS=$DATA/ExportOptions-AppStore.plist
  cat > $EXPORT_OPTIONS <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST
  xcodebuild -exportArchive -archivePath $ARCHIVE -exportOptionsPlist $EXPORT_OPTIONS \
    -exportPath $DATA/Export-$BUILD "${AUTH[@]}" >> $LOG 2>&1 \
    && echo "UPLOAD OK $(date +%T) MoneyMart $VERSION ($BUILD)" | tee -a $LOG || { echo "UPLOAD FAILED (see $LOG)" | tee -a $LOG; exit 1; }
fi
echo "DONE $(date +%T)" | tee -a $LOG
