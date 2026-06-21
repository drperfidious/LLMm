import UIKit
import RNFBAppCheck
import FirebaseCore
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  @objc var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Initialize Firebase
    // This is used exclusively for sending model benchmarks (with user consent) to Firebase.
    // Firebase is used for App Check functionality, allowing unauthenticated users to submit their benchmark data securely.
    RNFBAppCheckModule.sharedInstance() 
    FirebaseApp.configure()

#if DEBUG
    RCTDevLoadingViewSetEnabled(false)
#endif

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    return true
  }

  func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
  }

  // MARK: - Deep Linking Support

  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey : Any] = [:]
  ) -> Bool {
    Self.handleURL(url)
  }

  static func handleURL(_ url: URL) -> Bool {
    // Handle deep links from Shortcuts
    if url.scheme == "pocketpal" {
      NotificationCenter.default.post(
        name: NSNotification.Name("RCTOpenURLNotification"),
        object: nil,
        userInfo: ["url": url]
      )
      return true
    }

    // Handle other URL schemes (e.g., Google Sign-In)
    return false
  }

  func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    return false
  }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory
    else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    factory.startReactNative(
      withModuleName: "LLMm",
      in: window,
      launchOptions: nil
    )

    if let urlContext = connectionOptions.urlContexts.first {
      _ = AppDelegate.handleURL(urlContext.url)
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    if let urlContext = URLContexts.first {
      _ = AppDelegate.handleURL(urlContext.url)
    }
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    if let embeddedBundle = Bundle.main.url(forResource: "main", withExtension: "jsbundle") {
      return embeddedBundle
    }

    if let metroHost = Self.metroHostFromBundle() {
      return RCTBundleURLProvider.jsBundleURL(
        forBundleRoot: "index",
        packagerHost: metroHost,
        enableDev: true,
        enableMinification: false,
        inlineSourceMap: false
      )
    }

    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }

#if DEBUG
  private static func metroHostFromBundle() -> String? {
    guard let ipPath = Bundle.main.path(forResource: "ip", ofType: "txt"),
          let rawHost = try? String(contentsOfFile: ipPath, encoding: .utf8)
    else {
      return nil
    }

    let host = rawHost.trimmingCharacters(in: .whitespacesAndNewlines)
    return host.isEmpty ? nil : host
  }
#endif
}
