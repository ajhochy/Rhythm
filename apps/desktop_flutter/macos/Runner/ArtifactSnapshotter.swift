#if DEBUG
import FlutterMacOS
import WebKit

/// DEBUG-only AV-06 evidence bridge. It returns the visible native WebKit
/// surface directly, without screen recording permission or filesystem access.
/// The surrounding window chrome is composed by the test from the Flutter
/// layer: a platform view is a hole in `RenderRepaintBoundary.toImage` and the
/// compositor also omits it from an own-window CGWindow capture, so only this
/// snapshot can supply the rendered artifact.
final class ArtifactSnapshotter {
  private static let channelName = "com.vcrc.rhythm/artifact-snapshot"

  static func register(with controller: FlutterViewController) {
    let channel = FlutterMethodChannel(
      name: channelName,
      binaryMessenger: controller.engine.binaryMessenger
    )
    channel.setMethodCallHandler { call, result in
      guard call.method == "capture" else {
        result(FlutterMethodNotImplemented)
        return
      }
      capture(in: controller.view, result: result)
    }
  }

  private static func capture(in view: NSView, result: @escaping FlutterResult) {
    guard let webView = visibleWebView(in: view) else {
      result(FlutterError(code: "NOT_FOUND", message: "No visible WKWebView", details: nil))
      return
    }
    webView.takeSnapshot(with: nil) { image, error in
      guard error == nil,
        let tiff = image?.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff),
        let png = bitmap.representation(using: .png, properties: [:])
      else {
        result(FlutterError(code: "CAPTURE_FAILED", message: "WKWebView snapshot failed", details: nil))
        return
      }
      result(FlutterStandardTypedData(bytes: png))
    }
  }

  private static func visibleWebView(in view: NSView) -> WKWebView? {
    if let webView = view as? WKWebView, !webView.isHidden, webView.window != nil {
      return webView
    }
    return view.subviews.lazy.compactMap(visibleWebView).first
  }
}
#endif
