import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow {
  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    RegisterGeneratedPlugins(registry: flutterViewController)
    HumanApprovalSigner.register(with: flutterViewController)
    #if DEBUG
    ArtifactSnapshotter.register(with: flutterViewController)
    #endif

    super.awakeFromNib()

    // Belt-and-suspenders foregrounding: ensure the window becomes key and is
    // ordered to the front. AppDelegate also activates the app on launch.
    NSApp.activate(ignoringOtherApps: true)
    self.makeKeyAndOrderFront(nil)
  }
}
