#import "NativeDayflowOwnedHostLifecycle.h"
#import <objc/runtime.h>

#include <cmath>

namespace {
constexpr CGFloat kMaximumCoordinate = 32768.0;
constexpr CGFloat kMaximumDimension = 16384.0;
// Matches the immutable production Swift root minimum; measured larger content wins.
constexpr CGFloat kProductionMinimumContentHeight = 558.0;
constexpr CGFloat kMinimumZoom = 0.5;
constexpr CGFloat kMaximumZoom = 3.0;

static BOOL NativeDayflowFinite(CGFloat value) {
  return std::isfinite(static_cast<double>(value));
}

static BOOL NativeDayflowSafeLayout(CGFloat x, CGFloat y, CGFloat width, CGFloat height, CGFloat zoom) {
  return NativeDayflowFinite(x) && NativeDayflowFinite(y) &&
      NativeDayflowFinite(width) && NativeDayflowFinite(height) && NativeDayflowFinite(zoom) &&
      fabs(x) <= kMaximumCoordinate && fabs(y) <= kMaximumCoordinate && width > 0 && height > 0 &&
      width <= kMaximumDimension && height <= kMaximumDimension && zoom >= kMinimumZoom && zoom <= kMaximumZoom;
}

static BOOL NativeDayflowSafeParentBounds(NSRect bounds) {
  return NativeDayflowFinite(NSMinX(bounds)) && NativeDayflowFinite(NSMinY(bounds)) &&
      NativeDayflowFinite(bounds.size.width) && NativeDayflowFinite(bounds.size.height) &&
      bounds.size.width > 0 && bounds.size.height > 0;
}
}  // namespace

@class NativeDayflowOwnedHostLifecycle;

/// Tags only synthetic events created by this private lifecycle object. The
/// process-local AppKit monitor returns every unrelated real event unchanged;
/// it exists solely to re-check attachment/focus at *delivery* time.
@interface NativeDayflowOwnedInputPair : NSObject
/// Shared by one synthetic down/up pair. The down is validated at delivery;
/// the matching up is delivered only if its down was, so a standard control's
/// tracking loop always finishes and an orphan up is never delivered.
@property(nonatomic) BOOL downDelivered;
@end

@implementation NativeDayflowOwnedInputPair
@end

@interface NativeDayflowOwnedInputToken : NSObject
@property(nonatomic, strong) NativeDayflowOwnedInputPair *pair;
@property(nonatomic, weak) NativeDayflowOwnedHostLifecycle *lifecycle;
@property(nonatomic) NSUInteger attachmentEpoch;
@property(nonatomic) NSEventType expectedType;
@end

@implementation NativeDayflowOwnedInputToken
@end

namespace {
static char kNativeDayflowOwnedInputTokenKey;
static id gNativeDayflowOwnedLocalInputMonitor = nil;
static void NativeDayflowInstallOwnedLocalInputMonitor(void);
}  // namespace

@interface NativeDayflowOwnedHostLifecycle ()
@property(nonatomic, weak) NSView *parentView;
@property(nonatomic, weak) NSWindow *parentWindow;
@property(nonatomic, strong) NSScrollView *clipView;
@property(nonatomic, strong) id scrollBoundsObserver;
@property(nonatomic, strong) NSView *hostedView;
@property(nonatomic, weak) NSResponder *priorElectronResponder;
@property(nonatomic, strong) id closeObserver;
@property(nonatomic) CGFloat cssZoom;
@property(nonatomic) NSUInteger attachmentEpoch;
@property(nonatomic, readwrite, getter=isInvalidated) BOOL invalidated;
- (BOOL)shouldDeliverOwnedQueuedEvent:(NSEvent *)event token:(NativeDayflowOwnedInputToken *)token;
@end

namespace {
static void NativeDayflowInstallOwnedLocalInputMonitor(void) {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    const NSEventMask mask = NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp |
        NSEventMaskKeyDown | NSEventMaskKeyUp;
    gNativeDayflowOwnedLocalInputMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:mask
                                                                                     handler:^NSEvent * _Nullable(NSEvent *event) {
      NativeDayflowOwnedInputToken *token = objc_getAssociatedObject(
          event, &kNativeDayflowOwnedInputTokenKey);
      if (token == nil) {
        // This is an unrelated physical or Chromium/AppKit event. Do not
        // observe, transform, suppress, or route it.
        return event;
      }
      const BOOL isUp = event.type == NSEventTypeLeftMouseUp || event.type == NSEventTypeKeyUp;
      NativeDayflowOwnedHostLifecycle *lifecycle = token.lifecycle;
      // An up is held to the same delivery-time ownership test as its down
      // (same lifecycle object, epoch, own window, visible clip, hit target or
      // owned responder) and additionally requires its own down to have been
      // delivered. It is never routed to a closed, replaced or hidden host or
      // to an unrelated responder. Tracking invariant (UNVERIFIED in AppKit
      // until the reviewed run): a standard control's tracking loop runs
      // synchronously inside its down's dispatch, so no lifecycle change can
      // intervene before it pulls the up; a change between down and up drops
      // the up, which is the safe direction.
      if (lifecycle == nil || (isUp && !token.pair.downDelivered) ||
          ![lifecycle shouldDeliverOwnedQueuedEvent:event token:token]) {
        return nil;
      }
      if (!isUp) token.pair.downDelivered = YES;
      return event;
    }];
  });
}
}  // namespace

@implementation NativeDayflowOwnedHostLifecycle

- (instancetype)initWithTrustedParentView:(NSView *)parentView {
  NSParameterAssert([NSThread isMainThread]);
  NSParameterAssert(parentView != nil);
  NSParameterAssert(parentView.window != nil);
  self = [super init];
  if (self) {
    _parentView = parentView;
    _parentWindow = parentView.window;
    _cssZoom = 1.0;
    __weak NativeDayflowOwnedHostLifecycle *weakSelf = self;
    _closeObserver = [[NSNotificationCenter defaultCenter]
        addObserverForName:NSWindowWillCloseNotification
                    object:_parentWindow
                     queue:[NSOperationQueue mainQueue]
                usingBlock:^(__unused NSNotification *note) {
                  [weakSelf invalidateForHostTeardown];
                }];
  }
  return self;
}

- (void)dealloc {
  // A bridge release without an explicit detach must not leave a child clip
  // above Chromium. Queued owned events carry the prior epoch and are then
  // dropped by the process-local monitor before routing.
  if ([NSThread isMainThread]) {
    [self detach];
  } else if (_clipView != nil || _hostedView != nil) {
    // A release off the main thread must still remove the owned views.
    NSView *clip = _clipView;
    NSView *hosted = _hostedView;
    dispatch_async(dispatch_get_main_queue(), ^{
      [hosted removeFromSuperview];
      [clip removeFromSuperview];
    });
  }
  if (_scrollBoundsObserver != nil) {
    [[NSNotificationCenter defaultCenter] removeObserver:_scrollBoundsObserver];
  }
  if (_closeObserver != nil) {
    [[NSNotificationCenter defaultCenter] removeObserver:_closeObserver];
  }
}

- (BOOL)isAttached {
  return !self.invalidated && self.clipView != nil && self.hostedView != nil &&
      self.parentView != nil && self.parentWindow != nil && self.parentView.window == self.parentWindow &&
      self.clipView.superview == self.parentView && self.clipView.documentView == self.hostedView &&
      self.hostedView.superview == self.clipView.contentView && self.clipView.contentView.superview == self.clipView &&
      self.clipView.window == self.parentWindow && self.hostedView.window == self.parentWindow;
}

- (NSView *)trustedAttachmentParent {
  return self.attached ? self.clipView : nil;
}

- (BOOL)isNativeViewHidden {
  return self.clipView == nil || self.clipView.hidden;
}

- (BOOL)isOwnedView:(NSView *)candidate {
  return candidate != nil && self.hostedView != nil &&
      (candidate == self.hostedView || [candidate isDescendantOf:self.hostedView]);
}

- (BOOL)isOwnedResponder:(NSResponder *)responder {
  if (responder == nil || self.parentWindow == nil) return NO;
  if ([responder isKindOfClass:[NSView class]]) {
    if ([self isOwnedView:(NSView *)responder]) return YES;
  }

  // AppKit field editors normally sit outside the SwiftUI hosting subtree.
  // Accept one only when its delegate is a view inside this exact hosted tree.
  id fieldEditor = [self.parentWindow fieldEditor:NO forObject:nil];
  if (responder == fieldEditor && [fieldEditor isKindOfClass:[NSTextView class]]) {
    id delegate = [(NSTextView *)fieldEditor delegate];
    if ([delegate isKindOfClass:[NSView class]] && [self isOwnedView:(NSView *)delegate]) return YES;
  }
  return NO;
}

- (BOOL)isResponderValidForParentWindow:(NSResponder *)responder {
  if (responder == nil || self.parentWindow == nil) return NO;
  if (responder == self.parentWindow) return YES;
  if ([responder isKindOfClass:[NSView class]]) {
    return ((NSView *)responder).window == self.parentWindow;
  }
  return NO;
}

- (void)savePriorElectronResponderIfNeeded {
  NSResponder *current = self.parentWindow.firstResponder;
  if (current != nil && ![self isOwnedResponder:current] && [self isResponderValidForParentWindow:current]) {
    self.priorElectronResponder = current;
  }
}

- (void)restorePriorElectronResponderIfNeeded {
  NSWindow *window = self.parentWindow;
  NSResponder *current = window.firstResponder;
  NSResponder *prior = self.priorElectronResponder;
  if (window != nil && [self isOwnedResponder:current]) {
    // Prefer the saved Electron responder. If it is gone, refused to resign,
    // or never existed, fall back to the window itself so no responder is
    // left inside a view that is about to be hidden or removed.
    BOOL restored = [self isResponderValidForParentWindow:prior] && [window makeFirstResponder:prior];
    if (!restored && [self isOwnedResponder:window.firstResponder]) {
      [window makeFirstResponder:nil];
    }
  }
  self.priorElectronResponder = nil;
}

- (NSRect)clampedRectWithX:(CGFloat)x y:(CGFloat)y width:(CGFloat)width height:(CGFloat)height zoom:(CGFloat)zoom {
  NSView *parent = self.parentView;
  if (parent == nil || !NativeDayflowSafeLayout(x, y, width, height, zoom)) return NSZeroRect;
  const NSRect bounds = parent.bounds;
  if (!NativeDayflowSafeParentBounds(bounds)) return NSZeroRect;
  const CGFloat scaledWidth = MIN(width * zoom, bounds.size.width);
  const CGFloat scaledHeight = MIN(height * zoom, bounds.size.height);
  if (!NativeDayflowFinite(scaledWidth) || !NativeDayflowFinite(scaledHeight) || scaledWidth <= 0 || scaledHeight <= 0) {
    return NSZeroRect;
  }
  const CGFloat originX = MAX(NSMinX(bounds), MIN(NSMinX(bounds) + x * zoom, NSMaxX(bounds) - scaledWidth));
  const CGFloat top = MAX(0, MIN(y * zoom, bounds.size.height - scaledHeight));
  // Electron CSS layout is top-left origin. AppKit's parent may be flipped.
  const CGFloat originY = parent.isFlipped ? NSMinY(bounds) + top : NSMaxY(bounds) - top - scaledHeight;
  const NSRect integral = NSIntegralRect(NSMakeRect(originX, originY, scaledWidth, scaledHeight));
  return NSContainsRect(bounds, integral) ? integral : NSZeroRect;
}

- (BOOL)attachHostedView:(NSView *)hostedView
                       x:(CGFloat)x
                       y:(CGFloat)y
                   width:(CGFloat)width
                  height:(CGFloat)height
                    zoom:(CGFloat)zoom {
  if (![NSThread isMainThread] || self.invalidated || hostedView == nil || self.parentView == nil ||
      self.parentWindow == nil || self.parentView.window != self.parentWindow) return NO;
  const NSRect frame = [self clampedRectWithX:x y:y width:width height:height zoom:zoom];
  if (NSEqualRects(frame, NSZeroRect)) return NO;

  [self detach];
  NSScrollView *clip = [[NSScrollView alloc] initWithFrame:frame];
  clip.borderType = NSNoBorder;
  clip.drawsBackground = NO;
  clip.hasVerticalScroller = YES;
  clip.hasHorizontalScroller = NO;
  clip.autohidesScrollers = YES;
  clip.scrollerStyle = NSScrollerStyleOverlay;
  clip.horizontalScrollElasticity = NSScrollElasticityNone;
  clip.verticalScrollElasticity = NSScrollElasticityNone;
  clip.wantsLayer = YES;
  clip.layer.masksToBounds = YES;
  clip.autoresizingMask = NSViewNotSizable;
  // A positive, trusted lifecycle state must reveal the native view. This
  // avoids a one-frame native overlay above an inactive tool or modal.
  clip.hidden = YES;
  hostedView.autoresizingMask = NSViewWidthSizable;
  clip.documentView = hostedView;
  [self.parentView addSubview:clip positioned:NSWindowAbove relativeTo:nil];
  self.clipView = clip;
  self.hostedView = hostedView;
  self.cssZoom = zoom;
  if (![self sizeDocumentToViewportPreservingOrigin:0]) {
    [self detach];
    return NO;
  }
  // Scroll/trackpad movement changes the document target under a queued click.
  // Observe only this owned clip, without observing unrelated native events.
  clip.contentView.postsBoundsChangedNotifications = YES;
  __weak NativeDayflowOwnedHostLifecycle *weakSelf = self;
  self.scrollBoundsObserver = [[NSNotificationCenter defaultCenter]
      addObserverForName:NSViewBoundsDidChangeNotification
                  object:clip.contentView
                   queue:[NSOperationQueue mainQueue]
              usingBlock:^(__unused NSNotification *note) {
                weakSelf.attachmentEpoch += 1;
              }];
  return self.attached;
}

/// Measure against the new width and viewport height, never a previous tall
/// document frame. NSHostingView can then supply its current intrinsic/fitting
/// content height while the owned scroll view stays bounded to Electron.
- (BOOL)sizeDocumentToViewportPreservingOrigin:(CGFloat)topOffset {
  NSScrollView *scroll = self.clipView;
  NSView *document = self.hostedView;
  [scroll tile];
  const NSSize viewport = scroll.contentView.bounds.size;
  if (!NativeDayflowSafeParentBounds(NSMakeRect(0, 0, viewport.width, viewport.height)) ||
      viewport.height > kMaximumDimension) return NO;
  document.frame = NSMakeRect(0, 0, viewport.width, viewport.height);
  [document setNeedsLayout:YES];
  [document layoutSubtreeIfNeeded];
  const CGFloat intrinsicHeight = document.intrinsicContentSize.height;
  const CGFloat fittingHeight = document.fittingSize.height;
  if (!NativeDayflowFinite(intrinsicHeight) || !NativeDayflowFinite(fittingHeight) ||
      (intrinsicHeight < 0 && intrinsicHeight != NSViewNoIntrinsicMetric) || fittingHeight < 0 ||
      intrinsicHeight > kMaximumDimension || fittingHeight > kMaximumDimension) {
    return NO;
  }
  const CGFloat height = MAX(viewport.height, MAX(kProductionMinimumContentHeight,
      MAX(intrinsicHeight, fittingHeight)));
  document.frame = NSMakeRect(0, 0, viewport.width, height);
  [document setNeedsLayout:YES];
  const CGFloat maximumY = MAX(0, height - viewport.height);
  const CGFloat clampedTopOffset = MAX(0, MIN(topOffset, maximumY));
  const CGFloat originY = document.isFlipped ? clampedTopOffset : maximumY - clampedTopOffset;
  [scroll.contentView scrollToPoint:NSMakePoint(0, originY)];
  [scroll reflectScrolledClipView:scroll.contentView];
  return YES;
}

- (BOOL)resizeWithX:(CGFloat)x
                   y:(CGFloat)y
               width:(CGFloat)width
              height:(CGFloat)height
                zoom:(CGFloat)zoom {
  if (![NSThread isMainThread] || !self.attached) return NO;
  const NSRect frame = [self clampedRectWithX:x y:y width:width height:height zoom:zoom];
  if (NSEqualRects(frame, NSZeroRect)) return NO;
  // Geometry moved: a queued pair aimed at the old layout must not land.
  self.attachmentEpoch += 1;
  // Capture the visual top before frame/tile changes the viewport height.
  // Flipped documents count down from their top; unflipped documents count up.
  const NSRect priorClipBounds = self.clipView.contentView.bounds;
  const CGFloat priorDocumentHeight = NSHeight(self.hostedView.frame);
  const CGFloat topOffset = self.hostedView.isFlipped ? NSMinY(priorClipBounds) :
      MAX(0, priorDocumentHeight - NSMaxY(priorClipBounds));
  self.clipView.frame = frame;
  if (![self sizeDocumentToViewportPreservingOrigin:topOffset]) {
    // Reject invalid native measurements without leaving an old document
    // interactive inside the new viewport. A fresh attach may retry.
    [self detach];
    return NO;
  }
  self.cssZoom = zoom;
  return NSContainsRect(self.parentView.bounds, self.clipView.frame);
}

- (void)setVisibilityForActiveTool:(BOOL)activeTool
                       modalVisible:(BOOL)modalVisible
                      windowVisible:(BOOL)windowVisible
                         minimized:(BOOL)minimized
                      hostCrashed:(BOOL)hostCrashed {
  if (![NSThread isMainThread] || self.clipView == nil || self.invalidated) return;
  if (hostCrashed) {
    [self invalidateForHostTeardown];
    return;
  }
  const BOOL shouldHide = !activeTool || modalVisible || !windowVisible || minimized;
  if (self.clipView.hidden != shouldHide) {
    // Show/hide cancels every queued synthetic pair, including one that would
    // otherwise survive a hide->show round trip between enqueue and delivery.
    self.attachmentEpoch += 1;
  }
  if (shouldHide) {
    [self restorePriorElectronResponderIfNeeded];
  }
  self.clipView.hidden = shouldHide;
}

- (BOOL)returnFocusToHostedView {
  if (![NSThread isMainThread] || !self.attached || self.clipView.hidden) return NO;
  NSWindow *window = self.parentWindow;
  if (!window.isVisible || window.isMiniaturized) return NO;
  [self savePriorElectronResponderIfNeeded];
  [window makeFirstResponder:self.hostedView];
  return [self isOwnedResponder:window.firstResponder];
}

- (BOOL)hostedTextInputFocused {
  if (![NSThread isMainThread] || !self.attached || self.clipView.hidden) return NO;
  NSWindow *window = self.parentWindow;
  if (!window.isVisible || window.isMiniaturized) return NO;
  NSResponder *responder = window.firstResponder;
  return [responder isKindOfClass:[NSTextView class]] && ((NSTextView *)responder).isFieldEditor &&
      [self isOwnedResponder:responder];
}

- (NSPoint)hostPointForCSSX:(CGFloat)x y:(CGFloat)y {
  if (!NativeDayflowFinite(x) || !NativeDayflowFinite(y) || self.hostedView == nil ||
      !NativeDayflowFinite(self.cssZoom)) return NSMakePoint(NAN, NAN);
  const CGFloat scaledX = x * self.cssZoom;
  const CGFloat scaledY = y * self.cssZoom;
  NSClipView *content = self.clipView.contentView;
  const NSRect bounds = content.bounds;
  if (!self.attached || !NativeDayflowSafeParentBounds(bounds) || scaledX < 0 || scaledX >= bounds.size.width ||
      scaledY < 0 || scaledY >= bounds.size.height) return NSMakePoint(NAN, NAN);
  const CGFloat appKitY = content.isFlipped ? NSMinY(bounds) + scaledY : NSMaxY(bounds) - scaledY;
  return [self.hostedView convertPoint:NSMakePoint(NSMinX(bounds) + scaledX, appKitY) fromView:content];
}

- (NSView *)targetViewAtHostPoint:(NSPoint)point {
  if (!self.attached || self.clipView.hidden || !NativeDayflowFinite(point.x) || !NativeDayflowFinite(point.y)) return nil;
  if (!NSPointInRect(point, self.hostedView.bounds) || !NSPointInRect(point, self.hostedView.visibleRect)) return nil;
  // AppKit hitTest accepts a point in the receiver's superview coordinates.
  const NSPoint clipPoint = [self.hostedView convertPoint:point toView:self.hostedView.superview];
  NSView *target = [self.hostedView hitTest:clipPoint];
  return [self isOwnedView:target] ? target : nil;
}

- (NativeDayflowOwnedInputToken *)tokenForEventType:(NSEventType)type pair:(NativeDayflowOwnedInputPair *)pair {
  NativeDayflowOwnedInputToken *token = [[NativeDayflowOwnedInputToken alloc] init];
  token.pair = pair;
  token.lifecycle = self;
  token.attachmentEpoch = self.attachmentEpoch;
  token.expectedType = type;
  return token;
}

- (void)tagOwnedQueuedEvent:(NSEvent *)event token:(NativeDayflowOwnedInputToken *)token {
  objc_setAssociatedObject(
      event, &kNativeDayflowOwnedInputTokenKey, token, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

/// Invoked by the app-local monitor immediately before AppKit delivers a
/// synthetic event. It validates the current, not enqueue-time, attachment,
/// visibility, window, target/responder, and attachment generation.
- (BOOL)shouldDeliverOwnedQueuedEvent:(NSEvent *)event token:(NativeDayflowOwnedInputToken *)token {
  if (![NSThread isMainThread] || event == nil || token == nil || token.lifecycle != self ||
      token.attachmentEpoch != self.attachmentEpoch || event.type != token.expectedType ||
      !self.attached || self.clipView.hidden) {
    return NO;
  }
  NSWindow *window = self.parentWindow;
  if (window == nil || event.windowNumber != window.windowNumber || !window.isVisible ||
      window.isMiniaturized) {
    return NO;
  }
  switch (event.type) {
    case NSEventTypeLeftMouseDown:
    case NSEventTypeLeftMouseUp: {
      const NSPoint local = [self.hostedView convertPoint:event.locationInWindow fromView:nil];
      return [self targetViewAtHostPoint:local] != nil;
    }
    case NSEventTypeKeyDown:
    case NSEventTypeKeyUp:
      return [self isOwnedResponder:window.firstResponder];
    default:
      return NO;
  }
}

- (BOOL)dispatchMouseClickAtCSSX:(CGFloat)x y:(CGFloat)y clickCount:(NSInteger)clickCount {
  if (![NSThread isMainThread] || clickCount < 1 || clickCount > 3 || !self.attached || self.clipView.hidden) {
    return NO;
  }
  NSWindow *window = self.parentWindow;
  const NSPoint hostPoint = [self hostPointForCSSX:x y:y];
  NSView *target = [self targetViewAtHostPoint:hostPoint];
  if (window == nil || target == nil) return NO;
  // A native text control may become first responder during the queued click.
  // Preserve a valid Chromium responder before that local event can run so
  // hide/detach returns focus rather than leaving it in the detached subtree.
  [self savePriorElectronResponderIfNeeded];
  const NSPoint windowPoint = [self.hostedView convertPoint:hostPoint toView:nil];
  if (!NativeDayflowFinite(windowPoint.x) || !NativeDayflowFinite(windowPoint.y)) return NO;
  NSApplication *application = NSApp;
  if (application == nil) return NO;

  // Use the real process uptime and public AppKit event queue. Both events
  // are queued before dispatch, so a standard control tracking loop can
  // consume the matching mouse-up without blocking this trusted main caller.
  // This is local to Electron's existing NSApplication, not CGEvent/global
  // input injection, and remains source-only until the reviewed harness runs.
  const NSTimeInterval now = NSProcessInfo.processInfo.systemUptime;
  NSEvent *down = [NSEvent mouseEventWithType:NSEventTypeLeftMouseDown
                                      location:windowPoint
                                 modifierFlags:0
                                     timestamp:now
                                  windowNumber:window.windowNumber
                                       context:nil
                                   eventNumber:0
                                    clickCount:clickCount
                                      pressure:1.0];
  NSEvent *up = [NSEvent mouseEventWithType:NSEventTypeLeftMouseUp
                                    location:windowPoint
                               modifierFlags:0
                                   timestamp:now + 0.005
                                windowNumber:window.windowNumber
                                     context:nil
                                 eventNumber:0
                                  clickCount:clickCount
                                    pressure:0.0];
  if (down == nil || up == nil) return NO;
  NativeDayflowInstallOwnedLocalInputMonitor();
  NativeDayflowOwnedInputPair *pair = [[NativeDayflowOwnedInputPair alloc] init];
  [self tagOwnedQueuedEvent:down token:[self tokenForEventType:NSEventTypeLeftMouseDown pair:pair]];
  [self tagOwnedQueuedEvent:up token:[self tokenForEventType:NSEventTypeLeftMouseUp pair:pair]];
  // `atStart:YES` posts the matching up first, then down, so AppKit observes
  // the bounded sequence in down/up order without a synchronous tracking
  // loop. The monitor revalidates both events immediately before delivery.
  [application postEvent:up atStart:YES];
  [application postEvent:down atStart:YES];
  return YES;
}

- (BOOL)dispatchOwnedScrollEvent:(NSEvent *)event {
  if (![NSThread isMainThread] || event == nil || event.type != NSEventTypeScrollWheel || !self.attached ||
      self.clipView.hidden) return NO;
  NSWindow *window = self.parentWindow;
  if (window == nil || event.windowNumber != window.windowNumber) return NO;
  const NSPoint local = [self.hostedView convertPoint:event.locationInWindow fromView:nil];
  NSView *target = [self targetViewAtHostPoint:local];
  if (target == nil) return NO;
  // AppKit has no public wheel-event constructor. This accepts only a real
  // local event from the exact own window. The prepared runner does not call
  // it, so wheel behavior is explicitly untested at this source checkpoint.
  [target scrollWheel:event];
  return YES;
}

- (BOOL)dispatchKeyCharacters:(NSString *)characters keyCode:(unsigned short)keyCode {
  if (![NSThread isMainThread] || characters.length == 0 || characters.length > 64 || !self.attached ||
      self.clipView.hidden) return NO;
  NSWindow *window = self.parentWindow;
  NSResponder *responder = window.firstResponder;
  if (window == nil || ![self isOwnedResponder:responder]) return NO;
  NSApplication *application = NSApp;
  if (application == nil) return NO;
  const NSTimeInterval now = NSProcessInfo.processInfo.systemUptime;
  NSEvent *down = [NSEvent keyEventWithType:NSEventTypeKeyDown
                                    location:NSZeroPoint
                               modifierFlags:0
                                   timestamp:now
                                windowNumber:window.windowNumber
                                     context:nil
                                  characters:characters
                 charactersIgnoringModifiers:characters
                                   isARepeat:NO
                                     keyCode:keyCode];
  NSEvent *up = [NSEvent keyEventWithType:NSEventTypeKeyUp
                                  location:NSZeroPoint
                             modifierFlags:0
                                 timestamp:now + 0.005
                              windowNumber:window.windowNumber
                                   context:nil
                                characters:characters
               charactersIgnoringModifiers:characters
                                 isARepeat:NO
                                   keyCode:keyCode];
  if (down == nil || up == nil) return NO;
  NativeDayflowInstallOwnedLocalInputMonitor();
  NativeDayflowOwnedInputPair *pair = [[NativeDayflowOwnedInputPair alloc] init];
  [self tagOwnedQueuedEvent:down token:[self tokenForEventType:NSEventTypeKeyDown pair:pair]];
  [self tagOwnedQueuedEvent:up token:[self tokenForEventType:NSEventTypeKeyUp pair:pair]];
  [application postEvent:up atStart:YES];
  [application postEvent:down atStart:YES];
  return YES;
}

- (void)notifyInvalidated {
  NativeDayflowOwnedHostInvalidationHandler handler = self.onInvalidated;
  if (handler != nil) handler();
}

- (void)detach {
  if (![NSThread isMainThread]) return;
  const BOOL hadAttachment = self.clipView != nil || self.hostedView != nil;
  self.attachmentEpoch += 1;
  [self restorePriorElectronResponderIfNeeded];
  if (self.scrollBoundsObserver != nil) {
    [[NSNotificationCenter defaultCenter] removeObserver:self.scrollBoundsObserver];
    self.scrollBoundsObserver = nil;
  }
  [self.hostedView removeFromSuperview];
  self.clipView.documentView = nil;
  [self.clipView removeFromSuperview];
  self.hostedView = nil;
  self.clipView = nil;
  if (hadAttachment) [self notifyInvalidated];
}

- (void)invalidateForHostTeardown {
  if (![NSThread isMainThread] || self.invalidated) return;
  self.invalidated = YES;
  const BOOL hadAttachment = self.clipView != nil || self.hostedView != nil;
  [self detach];
  // Readiness must be cleared on close/crash even if nothing was attached.
  if (!hadAttachment) [self notifyInvalidated];
}

@end
