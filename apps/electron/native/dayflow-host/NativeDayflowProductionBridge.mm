#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <node_api.h>

#import "NativeDayflowOwnedHostLifecycle.h"

#include <cmath>
#include <cstdint>
#include <cstring>
#include <functional>
#include <string>
#include <utility>

// PRODUCTION Node-API addon for the embedded original Dayflow native UI. It is
// loaded only by Rhythm's trusted Electron MAIN process. It registers no IPC,
// discovers no window, exposes no pointer/path/method to a renderer, and carries
// no snapshot, receipt, synthetic-input or fixture capability. The fixture
// addon (native_dayflow_expanded_fixture.node) is a different artifact and must
// never be shipped as, or substituted for, this one.
extern "C" {
int32_t native_dayflow_production_install(const char *data_root, const char *resource_bundle,
                                          const char *preferences_suite, const char *keychain_namespace,
                                          const char *bundle_identifier, const char *display_name,
                                          const char *short_version, const char *build,
                                          uint32_t service_flags);
void *native_dayflow_production_create_view(void);
int32_t native_dayflow_production_mark_attached(void *handle, void *trusted_parent);
int32_t native_dayflow_production_is_attached(void *handle);
void native_dayflow_production_destroy_view(void *handle);
int32_t native_dayflow_production_start_services(void);
void native_dayflow_production_stop_services(void);
int32_t native_dayflow_production_next_host_event(void);
void native_dayflow_production_set_launch_at_login_state(int32_t enabled);
int32_t native_dayflow_production_route_deep_link(const char *url);
int32_t native_dayflow_production_configure_helper(const char *helper_path);
int32_t native_dayflow_production_notification_bridge_start(void);
void native_dayflow_production_notification_bridge_stop(void);
int32_t native_dayflow_production_notification_bridge_status(void);
int32_t native_dayflow_production_notification_candidate_state(void);
}

namespace {

constexpr double kMaxCoordinate = 32768.0;
constexpr double kMaxDimension = 16384.0;
constexpr double kMinZoom = 0.5;
constexpr double kMaxZoom = 3.0;
constexpr size_t kMaxPathLength = 1024;
constexpr size_t kMaxNamespaceLength = 128;
constexpr size_t kMaxVersionLength = 32;
constexpr size_t kMaxUrlLength = 512;

struct Rect {
  double x;
  double y;
  double width;
  double height;
  double zoom;
};

static NSView *gParentView = nil;
static NativeDayflowOwnedHostLifecycle *gLifecycle = nil;
static void *gSwiftHandle = nullptr;
static bool gContextInstalled = false;

static napi_value Throw(napi_env env, const char *message) {
  napi_throw_type_error(env, nullptr, message);
  return nullptr;
}

static bool OnMainBool(const std::function<bool(void)> &work) {
  if ([NSThread isMainThread]) return work();
  __block bool result = false;
  dispatch_sync(dispatch_get_main_queue(), ^{ result = work(); });
  return result;
}

static void OnMainVoid(const std::function<void(void)> &work) {
  if ([NSThread isMainThread]) {
    work();
    return;
  }
  dispatch_sync(dispatch_get_main_queue(), ^{ work(); });
}

static napi_value MakeBool(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

static napi_value MakeNumber(napi_env env, int32_t value) {
  napi_value result;
  napi_create_int32(env, value, &result);
  return result;
}

static bool ReadBoundedString(napi_env env, napi_value value, size_t maximum, bool absolutePath, std::string *out) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) return false;
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok || length == 0 || length > maximum) {
    return false;
  }
  std::string result(length + 1, '\0');
  size_t copied = 0;
  if (napi_get_value_string_utf8(env, value, result.data(), result.size(), &copied) != napi_ok ||
      copied != length) {
    return false;
  }
  result.resize(copied);
  if (absolutePath && result[0] != '/') return false;
  if (result.find('\0') != std::string::npos) return false;
  *out = std::move(result);
  return true;
}

static bool GetNamedString(napi_env env, napi_value object, const char *name, size_t maximum,
                           bool absolutePath, std::string *out) {
  napi_value value;
  return napi_get_named_property(env, object, name, &value) == napi_ok &&
         ReadBoundedString(env, value, maximum, absolutePath, out);
}

static bool GetNamedNumber(napi_env env, napi_value object, const char *name, double *out) {
  napi_value value;
  return napi_get_named_property(env, object, name, &value) == napi_ok &&
         napi_get_value_double(env, value, out) == napi_ok && std::isfinite(*out);
}

// Optional boolean in the `services` object. Absent means false; a non-boolean
// value is rejected so a typo can never silently enable a service.
static bool GetOptionalFlag(napi_env env, napi_value object, const char *name, bool *out) {
  bool has = false;
  if (napi_has_named_property(env, object, name, &has) != napi_ok) return false;
  if (!has) {
    *out = false;
    return true;
  }
  napi_value value;
  napi_valuetype type;
  return napi_get_named_property(env, object, name, &value) == napi_ok &&
         napi_typeof(env, value, &type) == napi_ok && type == napi_boolean &&
         napi_get_value_bool(env, value, out) == napi_ok;
}

static bool ReadRect(napi_env env, napi_value value, Rect *out) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_object ||
      !GetNamedNumber(env, value, "x", &out->x) || !GetNamedNumber(env, value, "y", &out->y) ||
      !GetNamedNumber(env, value, "width", &out->width) ||
      !GetNamedNumber(env, value, "height", &out->height) ||
      !GetNamedNumber(env, value, "zoom", &out->zoom) || std::abs(out->x) > kMaxCoordinate ||
      std::abs(out->y) > kMaxCoordinate || out->width <= 0 || out->height <= 0 ||
      out->width > kMaxDimension || out->height > kMaxDimension || out->zoom < kMinZoom ||
      out->zoom > kMaxZoom) {
    Throw(env, "bounds are outside the trusted native-host range");
    return false;
  }
  return true;
}

static bool ReadOwnWindowHandle(napi_env env, napi_value value, uintptr_t *out) {
  bool isBuffer = false;
  if (napi_is_buffer(env, value, &isBuffer) != napi_ok || !isBuffer) {
    Throw(env, "window handle must be Electron's own native-handle Buffer");
    return false;
  }
  void *data = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, value, &data, &length) != napi_ok || data == nullptr ||
      length != sizeof(uintptr_t)) {
    Throw(env, "window handle Buffer has an invalid pointer width");
    return false;
  }
  uintptr_t raw = 0;
  std::memcpy(&raw, data, sizeof(raw));
  if (raw == 0) {
    Throw(env, "window handle must not be null");
    return false;
  }
  *out = raw;
  return true;
}

// Teardown order: detach (restores the prior Electron responder, removes only the
// owned clip/view), clear the handler, then release the Swift view. Services are
// NOT stopped here: they belong to the app lifecycle, not to a window.
static void DestroyHostOnMain() {
  if (gLifecycle != nil) {
    [gLifecycle detach];
    gLifecycle.onInvalidated = nil;
    gLifecycle = nil;
  }
  if (gSwiftHandle != nullptr) {
    native_dayflow_production_destroy_view(gSwiftHandle);
  }
  gSwiftHandle = nullptr;
  gParentView = nil;
}

static napi_value MakeState(napi_env env) {
  struct HostState {
    bool attached = false;
    bool hidden = true;
    bool invalidated = false;
  } state;
  OnMainVoid([&state]() {
    state.attached = gLifecycle != nil && gLifecycle.attached && gSwiftHandle != nullptr &&
                     native_dayflow_production_is_attached(gSwiftHandle) == 1;
    state.hidden = gLifecycle == nil || gLifecycle.nativeViewHidden;
    state.invalidated = gLifecycle != nil && gLifecycle.invalidated;
  });
  napi_value result;
  napi_create_object(env, &result);
  napi_set_named_property(env, result, "contextInstalled", MakeBool(env, gContextInstalled));
  napi_set_named_property(env, result, "attached", MakeBool(env, state.attached));
  napi_set_named_property(env, result, "hidden", MakeBool(env, state.hidden));
  napi_set_named_property(env, result, "invalidated", MakeBool(env, state.invalidated));
  return result;
}

// install({ dataRoot, resourceBundle, preferencesSuite, keychainNamespace,
//           bundleIdentifier, displayName, shortVersion, build,
//           services?: { flowOverlay, promotional, notificationDelegate } })
static napi_value Install(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_valuetype type;
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 1 ||
      napi_typeof(env, args[0], &type) != napi_ok || type != napi_object) {
    return Throw(env, "install requires one trusted configuration object");
  }
  std::string dataRoot, resourceBundle, suite, keychain, bundleId, displayName, shortVersion, build;
  if (!GetNamedString(env, args[0], "dataRoot", kMaxPathLength, true, &dataRoot) ||
      !GetNamedString(env, args[0], "resourceBundle", kMaxPathLength, true, &resourceBundle) ||
      !GetNamedString(env, args[0], "preferencesSuite", kMaxNamespaceLength, false, &suite) ||
      !GetNamedString(env, args[0], "keychainNamespace", kMaxNamespaceLength, false, &keychain) ||
      !GetNamedString(env, args[0], "bundleIdentifier", kMaxNamespaceLength, false, &bundleId) ||
      !GetNamedString(env, args[0], "displayName", kMaxNamespaceLength, false, &displayName) ||
      !GetNamedString(env, args[0], "shortVersion", kMaxVersionLength, false, &shortVersion) ||
      !GetNamedString(env, args[0], "build", kMaxVersionLength, false, &build)) {
    return Throw(env, "install configuration is missing or has an out-of-range field");
  }
  uint32_t flags = 0;
  napi_value services;
  bool hasServices = false;
  if (napi_has_named_property(env, args[0], "services", &hasServices) == napi_ok && hasServices) {
    if (napi_get_named_property(env, args[0], "services", &services) != napi_ok ||
        napi_typeof(env, services, &type) != napi_ok || type != napi_object) {
      return Throw(env, "services must be an object of booleans");
    }
    bool overlay = false, promotional = false, delegate = false;
    if (!GetOptionalFlag(env, services, "flowOverlay", &overlay) ||
        !GetOptionalFlag(env, services, "promotional", &promotional) ||
        !GetOptionalFlag(env, services, "notificationDelegate", &delegate)) {
      return Throw(env, "services flags must be booleans");
    }
    if (overlay) flags |= 1u << 2;
    if (promotional) flags |= 1u << 3;
    if (delegate) flags |= 1u << 4;
  }
  int32_t status = 9;
  OnMainVoid([&]() {
    if (gContextInstalled) {
      status = 1;
      return;
    }
    status = native_dayflow_production_install(
        dataRoot.c_str(), resourceBundle.c_str(), suite.c_str(), keychain.c_str(), bundleId.c_str(),
        displayName.c_str(), shortVersion.c_str(), build.c_str(), flags);
    gContextInstalled = status == 0;
  });
  // Fixed status codes only; the message never echoes a path or error detail.
  if (status != 0) {
    static const char *kMessages[] = {
        "ok",
        "the production context is already installed in this process",
        "the data root was rejected (must be an empty or owned Rhythm directory outside installed Dayflow locations, with no symbolic-link ancestor or required child)",
        "the preferences or keychain namespace was rejected",
        "the application identity was rejected",
        "the production resource bundle was rejected",
        "the original fonts could not be registered",
        "the Rhythm-owned preferences suite could not be opened",
        "install must run on the AppKit main thread",
        "install arguments were invalid",
        "the original Dayflow database could not be opened or recovered; nothing was published (restart to retry)",
        "an earlier install attempt failed after touching process state; restart to retry",
    };
    // Stable machine-readable codes; the thrown error carries `.code`.
    static const char *kCodes[] = {
        "ok", "E_ALREADY_INSTALLED", "E_DATA_ROOT", "E_NAMESPACE", "E_IDENTITY", "E_RESOURCE_BUNDLE",
        "E_FONTS", "E_PREFERENCES", "E_NOT_MAIN_THREAD", "E_BAD_ARGUMENTS", "E_STORAGE_UNAVAILABLE",
        "E_INSTALL_POISONED",
    };
    const bool known = status >= 0 && status <= 11;
    napi_throw_type_error(env, known ? kCodes[status] : "E_INSTALL_FAILED",
                          known ? kMessages[status] : "install failed");
    return nullptr;
  }
  return MakeBool(env, true);
}

static napi_value Attach(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 2) {
    return Throw(env, "attach requires the own-window native-handle Buffer and bounded layout");
  }
  uintptr_t rawHandle = 0;
  Rect bounds{};
  if (!ReadOwnWindowHandle(env, args[0], &rawHandle) || !ReadRect(env, args[1], &bounds)) return nullptr;

  const bool attached = OnMainBool([&]() {
    if (!gContextInstalled) return false;
    NSView *parent = (__bridge NSView *)(reinterpret_cast<void *>(rawHandle));
    if (![parent isKindOfClass:[NSView class]] || parent.window == nil) return false;

    DestroyHostOnMain();
    void *swiftHandle = native_dayflow_production_create_view();
    if (swiftHandle == nullptr) return false;
    NSView *hosted = (__bridge NSView *)swiftHandle;
    NativeDayflowOwnedHostLifecycle *lifecycle =
        [[NativeDayflowOwnedHostLifecycle alloc] initWithTrustedParentView:parent];
    if (lifecycle == nil || ![lifecycle attachHostedView:hosted
                                                       x:bounds.x
                                                       y:bounds.y
                                                   width:bounds.width
                                                  height:bounds.height
                                                    zoom:bounds.zoom]) {
      native_dayflow_production_destroy_view(swiftHandle);
      return false;
    }
    gParentView = parent;
    gSwiftHandle = swiftHandle;
    gLifecycle = lifecycle;
    if (native_dayflow_production_mark_attached(gSwiftHandle, (__bridge void *)lifecycle.trustedAttachmentParent) != 1) {
      DestroyHostOnMain();
      return false;
    }
    // The clip stays hidden until trusted main supplies a positive lifecycle.
    return gLifecycle.attached && gLifecycle.nativeViewHidden;
  });
  if (!attached) return Throw(env, "could not attach the embedded Dayflow root to the supplied own window");
  return MakeState(env);
}

static napi_value SetBounds(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 1) {
    return Throw(env, "setBounds requires bounded layout");
  }
  Rect bounds{};
  if (!ReadRect(env, args[0], &bounds)) return nullptr;
  const bool updated = OnMainBool([&]() {
    return gLifecycle != nil && [gLifecycle resizeWithX:bounds.x y:bounds.y width:bounds.width
                                                  height:bounds.height zoom:bounds.zoom];
  });
  return updated ? MakeBool(env, true) : Throw(env, "no attached embedded Dayflow root");
}

static napi_value SetLifecycle(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value args[5];
  bool state[5] = {false, false, false, false, false};
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 5) {
    return Throw(env, "setLifecycle requires five trusted boolean lifecycle bits");
  }
  for (size_t index = 0; index < argc; ++index) {
    if (napi_get_value_bool(env, args[index], &state[index]) != napi_ok) {
      return Throw(env, "lifecycle bits must be booleans");
    }
  }
  const bool processed = OnMainBool([&]() {
    if (gLifecycle == nil || !gLifecycle.attached) return false;
    [gLifecycle setVisibilityForActiveTool:state[0]
                               modalVisible:state[1]
                              windowVisible:state[2]
                                 minimized:state[3]
                              hostCrashed:state[4]];
    return true;
  });
  return processed ? MakeState(env) : Throw(env, "embedded Dayflow lifecycle is no longer active");
}

static napi_value ReturnFocus(napi_env env, napi_callback_info) {
  const bool focused = OnMainBool([]() { return gLifecycle != nil && [gLifecycle returnFocusToHostedView]; });
  return MakeBool(env, focused);
}

static napi_value Detach(napi_env env, napi_callback_info) {
  OnMainVoid([]() { DestroyHostOnMain(); });
  return MakeState(env);
}

static napi_value GetState(napi_env env, napi_callback_info) { return MakeState(env); }

// startServices() -> boolean. Starts the original services once, after install.
static napi_value StartServices(napi_env env, napi_callback_info) {
  const bool started = OnMainBool([]() {
    return gContextInstalled && native_dayflow_production_start_services() == 1;
  });
  return started ? MakeBool(env, true) : Throw(env, "the production context is not installed");
}

static napi_value StopServices(napi_env env, napi_callback_info) {
  OnMainVoid([]() {
    if (gContextInstalled) native_dayflow_production_stop_services();
  });
  return MakeBool(env, true);
}

// nextHostEvent() -> 0 | 1..7 (fixed codes; see NativeDayflowHostAdapter.Event).
static napi_value NextHostEvent(napi_env env, napi_callback_info) {
  int32_t code = 0;
  OnMainVoid([&]() { code = gContextInstalled ? native_dayflow_production_next_host_event() : 0; });
  return MakeNumber(env, code);
}

static napi_value SetLaunchAtLoginState(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  bool enabled = false;
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 1 ||
      napi_get_value_bool(env, args[0], &enabled) != napi_ok) {
    return Throw(env, "setLaunchAtLoginState requires one boolean");
  }
  OnMainVoid([&]() {
    if (gContextInstalled) native_dayflow_production_set_launch_at_login_state(enabled ? 1 : 0);
  });
  return MakeBool(env, true);
}

// configureHelper(string) -> true. The ONE trusted location of the bundled
// `<Rhythm>.app/Contents/Helpers/rhythm-dayflow`; set once, after install, from trusted
// main only. Throws a fixed-code TypeError (E_HELPER_*) and never echoes the path.
static napi_value ConfigureHelper(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  std::string path;
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 1 ||
      !ReadBoundedString(env, args[0], kMaxPathLength, true, &path)) {
    napi_throw_type_error(env, "E_HELPER_PATH", "configureHelper requires one bounded absolute path");
    return nullptr;
  }
  int32_t status = 8;
  OnMainVoid([&]() { status = gContextInstalled ? native_dayflow_production_configure_helper(path.c_str()) : 1; });
  if (status == 0) return MakeBool(env, true);
  const char *code = status == 1 ? "E_HELPER_NOT_INSTALLED"
                     : status == 3 ? "E_HELPER_ALREADY_CONFIGURED"
                     : status == 2 ? "E_HELPER_PATH" : "E_HELPER_FAILED";
  napi_throw_type_error(env, code, "the Rhythm Dayflow helper location was rejected");
  return nullptr;
}

static napi_value RouteDeepLink(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  std::string url;
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 1 ||
      !ReadBoundedString(env, args[0], kMaxUrlLength, false, &url)) {
    return Throw(env, "routeDeepLink requires one bounded dayflow:// URL string");
  }
  int32_t routed = 0;
  OnMainVoid([&]() { routed = gContextInstalled ? native_dayflow_production_route_deep_link(url.c_str()) : 0; });
  return MakeBool(env, routed == 1);
}

// startNotificationBridge() -> boolean. Registers the nil-only production UNUserNotificationCenter
// delegate. Independent of install/startServices (call early, e.g. Electron `will-finish-launching`):
// it needs no context, storage, services or permission and never touches Electron's own
// NSUserNotificationCenter delegate. false = a foreign delegate already exists (left untouched).
static napi_value StartNotificationBridge(napi_env env, napi_callback_info) {
  int32_t status = 8;
  OnMainVoid([&]() { status = native_dayflow_production_notification_bridge_start(); });
  return MakeBool(env, status == 0);
}

static napi_value StopNotificationBridge(napi_env env, napi_callback_info) {
  OnMainVoid([]() { native_dayflow_production_notification_bridge_stop(); });
  return MakeBool(env, true);
}

// notificationBridgeStatus() -> bitmask: 1 registered | 2 foreign owner | 4 cold-start candidate pending.
static napi_value NotificationBridgeStatus(napi_env env, napi_callback_info) {
  int32_t bits = 0;
  OnMainVoid([&]() { bits = native_dayflow_production_notification_bridge_status(); });
  return MakeNumber(env, bits);
}

// notificationCandidateState() -> 0 none | 1 exact-shape candidate needs the context | 2 qualified, frozen
// destination. Reads router state only; no marker/body/identifier/URL is returned.
static napi_value NotificationCandidateState(napi_env env, napi_callback_info) {
  int32_t state = 0;
  OnMainVoid([&]() { state = native_dayflow_production_notification_candidate_state(); });
  return MakeNumber(env, state);
}

static napi_value Initialize(napi_env env, napi_value exports) {
  const napi_property_descriptor descriptors[] = {
      {"install", nullptr, Install, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"attach", nullptr, Attach, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setBounds", nullptr, SetBounds, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setLifecycle", nullptr, SetLifecycle, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"returnFocus", nullptr, ReturnFocus, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"detach", nullptr, Detach, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getState", nullptr, GetState, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"startServices", nullptr, StartServices, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"stopServices", nullptr, StopServices, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"nextHostEvent", nullptr, NextHostEvent, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setLaunchAtLoginState", nullptr, SetLaunchAtLoginState, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"routeDeepLink", nullptr, RouteDeepLink, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"configureHelper", nullptr, ConfigureHelper, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"startNotificationBridge", nullptr, StartNotificationBridge, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"stopNotificationBridge", nullptr, StopNotificationBridge, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"notificationBridgeStatus", nullptr, NotificationBridgeStatus, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"notificationCandidateState", nullptr, NotificationCandidateState, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(descriptors) / sizeof(descriptors[0]), descriptors);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
