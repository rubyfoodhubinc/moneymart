# Create a UI test target so the app's flows can actually be driven.
#
# Every verification of the mobile app so far has been either structural (the bundle
# contains X) or visual (a screenshot shows Y). Neither exercises a tap. `simctl` has no
# tap command and this simulator is headless, so XCUITest is the only route to proving
# that onboarding, sign-in and the sell flow actually work when a person uses them.
#
# The Swift test file lives in the REPO at apps/mobile/uitests/MoneyMartFlowTests.swift
# and is installed into the generated ios/ directory here. ios/ is gitignored because it
# is produced by `expo prebuild`, so a test written only inside it would be destroyed by
# the next prebuild — the same trap the scene-lifecycle plugin was written to avoid.
#
# Usage, from apps/mobile:  ruby scripts/add-uitest-target.rb
require 'xcodeproj'
require 'fileutils'

PROJECT = File.join('ios', 'MoneyMart.xcodeproj')
SOURCE_TEST = File.join('uitests', 'MoneyMartFlowTests.swift')
TARGET_NAME = 'MoneyMartUITests'
APP_NAME = 'MoneyMart'
BUNDLE_ID = 'com.moneymart.app.uitests'

raise "run this from apps/mobile (no #{PROJECT})" unless File.exist?(PROJECT)
raise "missing #{SOURCE_TEST}" unless File.exist?(SOURCE_TEST)

project = Xcodeproj::Project.open(PROJECT)

if project.targets.any? { |t| t.name == TARGET_NAME }
  puts "  #{TARGET_NAME} already exists"
  exit 0
end

app = project.targets.find { |t| t.name == APP_NAME }
raise "#{APP_NAME} target not found" unless app

app_settings = app.build_configurations.first.build_settings
deployment_target = app_settings['IPHONEOS_DEPLOYMENT_TARGET'] || '15.1'
swift_version = app_settings['SWIFT_VERSION'] || '5.0'

# ── The test files ────────────────────────────────────────────────────────────
# Copied from the repo rather than embedded here, so the test is readable and
# reviewable as a normal source file.
dir = File.join('ios', APP_NAME, TARGET_NAME)
FileUtils.mkdir_p(dir)
FileUtils.cp(SOURCE_TEST, File.join(dir, 'MoneyMartFlowTests.swift'))


# ── The target ────────────────────────────────────────────────────────────────
test_target = project.new_target(:ui_test_bundle, TARGET_NAME, :ios, deployment_target)

test_target.build_configurations.each do |config|
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = BUNDLE_ID
  config.build_settings['SWIFT_VERSION'] = swift_version
  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = deployment_target
  config.build_settings['TEST_TARGET_NAME'] = APP_NAME
  config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  # The runner is signed for the simulator like the app is.
  config.build_settings['CODE_SIGNING_ALLOWED'] = 'YES'
  config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
  config.build_settings['CODE_SIGN_IDENTITY'] = ''
  config.build_settings['TARGETED_DEVICE_FAMILY'] = '1'
end

# The test bundle must be hosted by the app.
test_target.add_dependency(app)

group = project.main_group.find_subpath(APP_NAME, true).find_subpath(TARGET_NAME, true)
group.set_source_tree('SOURCE_ROOT')
group.set_path(File.join(APP_NAME, TARGET_NAME))
project.files.each { |f| f } # no-op, keeps the API happy on older versions

file_ref = group.new_reference(File.join(APP_NAME, TARGET_NAME, 'MoneyMartFlowTests.swift'))
file_ref.set_source_tree('SOURCE_ROOT')
test_target.add_file_references([file_ref])

# ── The scheme, so `xcodebuild test -scheme` can find it ──────────────────────
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_test_target(test_target)
scheme.set_launch_target(app)
scheme.save_as(PROJECT, TARGET_NAME, true)

project.save
puts "  created #{TARGET_NAME} with a shared #{TARGET_NAME} scheme"
