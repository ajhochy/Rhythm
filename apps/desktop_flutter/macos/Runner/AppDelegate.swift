import Cocoa
import FlutterMacOS

@main
class AppDelegate: FlutterAppDelegate {
  override func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    return true
  }

  override func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
    return true
  }

  override func applicationDidFinishLaunching(_ notification: Notification) {
    super.applicationDidFinishLaunching(notification)
    // Ensure the app appears as a regular foreground app and its main window
    // is brought to the front. Without this, `flutter run -d macos` can leave
    // the window behind other apps and only the menu bar visible.
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
    if let window = NSApp.windows.first {
      window.makeKeyAndOrderFront(nil)
    }
  }
}
