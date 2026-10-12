const {
  withInfoPlist,
  withDangerousMod,
  withXcodeProject,
} = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Adopt the iOS scene lifecycle.
 *
 * iOS 27 terminates any app that has not adopted it, and the failure gives nothing
 * away:
 *
 *   EXC_BREAKPOINT in
 *   _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption
 *   -> -[UIApplication workspace:didCreateScene:withTransitionContext:completion:]
 *
 * Expo does not provide this. Verified against the newest SDK available: no scene
 * manifest is emitted by @expo/prebuild-config, and React Native 0.79's template
 * still builds a `window = UIWindow(...)` inside `didFinishLaunchingWithOptions`,
 * which is the pre-scene pattern. So upgrading the SDK would not have helped.
 *
 * What the plugin does:
 *
 *   1. declares `UIApplicationSceneManifest` in Info.plist, with the scene delegate
 *      class named — without this the OS never asks for a scene at all
 *   2. replaces AppDelegate.swift with a variant that keeps every Expo and React
 *      Native hook intact but hands WINDOW OWNERSHIP to the scene, which is the
 *      only real change: `bindReactNativeFactory` still runs at launch, and the
 *      factory is kept as a stored property so the scene can start React Native
 *      once the window exists
 *   3. adds a SceneDelegate that creates the window and starts React Native
 *
 * It is written as a prebuild plugin rather than an edit to `ios/` because ios/ is
 * generated and gitignored; a hand edit there would be lost on the next prebuild,
 * which is exactly how the fabricated-photo bug survived so long.
 */

const SCENE_DELEGATE = `import Expo
import React
import ReactAppDependencyProvider
import UIKit

/**
 * The window owner under the scene lifecycle.
 *
 * iOS 27 requires scenes, so the window can no longer be created in
 * \`application(_:didFinishLaunchingWithOptions:)\` — UIKit asks for a scene
 * configuration, then calls back here once that scene connects.
 */
public class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  public var window: UIWindow?

  public func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }

    let reactWindow = UIWindow(windowScene: windowScene)
    window = reactWindow

    // The factory is built in the app delegate at launch; the scene only supplies
    // the window it renders into.
    AppDelegate.shared?.startReactNative(in: reactWindow, launchOptions: nil)
  }
}
`;

const APP_DELEGATE = `import Expo
import React
import ReactAppDependencyProvider

/**
 * The app delegate under the scene lifecycle.
 *
 * Differs from Expo's generated version in ONE way: it does not create a window.
 * \`bindReactNativeFactory\` still runs at launch — every Expo module hook depends
 * on it — but the factory is stored so the SceneDelegate can start React Native
 * once UIKit has given it a window scene.
 *
 * The generated version created the window here, which is the pre-scene pattern and
 * is why iOS 27 killed the app on launch.
 */
@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  /** The scene needs the factory, and it is built here at launch. */
  public static private(set) var shared: AppDelegate?

  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    AppDelegate.shared = self

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

    // Deliberately no window here: the scene owns it.
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  /** Called by the SceneDelegate once a window scene exists. */
  public func startReactNative(in window: UIWindow, launchOptions: [UIApplication.LaunchOptionsKey: Any]?) {
    self.window = window
    reactNativeFactory?.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions
    )
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
`;

module.exports = function withSceneLifecycle(config) {
  // 1. Declare the scene manifest, naming the delegate UIKit should instantiate.
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });

  // 2. Own the two Swift files that implement it.
  config = withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const projectRoot = cfg.modRequest.platformProjectRoot;
      const appDir = path.join(projectRoot, cfg.modRequest.projectName || 'MoneyMart');

      if (!fs.existsSync(appDir)) {
        throw new Error(`withSceneLifecycle: expected the app target directory at ${appDir}`);
      }

      fs.writeFileSync(path.join(appDir, 'SceneDelegate.swift'), SCENE_DELEGATE);
      fs.writeFileSync(path.join(appDir, 'AppDelegate.swift'), APP_DELEGATE);
      return cfg;
    },
  ]);

  /**
   * 3. Add the new file to the Xcode target.
   *
   * Writing a .swift file into the directory is not enough — Xcode compiles only
   * what is listed in the target's Sources build phase, so without this the
   * SceneDelegate simply would not exist at runtime and the app would still fail to
   * adopt a scene. This is the step that is easy to miss when patching native code
   * by hand.
   */
  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const appName = cfg.modRequest.projectName || 'MoneyMart';
    const groupKey = project.findPBXGroupKey({ name: appName });

    if (!groupKey) {
      throw new Error(`withSceneLifecycle: could not find the ${appName} group in the Xcode project`);
    }

    const alreadyListed = Object.keys(project.pbxFileReferenceSection()).some((key) =>
      String(project.pbxFileReferenceSection()[key].path || '').includes('SceneDelegate.swift'),
    );

    if (!alreadyListed) {
      const file = project.addSourceFile(
        `${appName}/SceneDelegate.swift`,
        { target: project.getFirstTarget().uuid },
        groupKey,
      );
      if (!file) {
        throw new Error('withSceneLifecycle: could not add SceneDelegate.swift to the target');
      }
    }

    return cfg;
  });

  return config;
};
