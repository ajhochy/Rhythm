#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

/// Main-process-only lifecycle primitive for the review-gated expanded native
/// fixture harness. It has no renderer IPC, never discovers a window, and
/// accepts only the exact NSView recovered by trusted Electron main code from
/// its own BrowserWindow native-handle Buffer.
typedef void (^NativeDayflowOwnedHostInvalidationHandler)(void);

@interface NativeDayflowOwnedHostLifecycle : NSObject

@property(nonatomic, readonly, getter=isAttached) BOOL attached;
@property(nonatomic, readonly, getter=isInvalidated) BOOL invalidated;
@property(nonatomic, readonly, getter=isNativeViewHidden) BOOL nativeViewHidden;
/// Internal bridge attachment witness. Never exported through Node-API or IPC.
/// The immutable Swift host requires its grandparent to be this owned scroll view.
@property(nonatomic, readonly, nullable) NSView *trustedAttachmentParent;
/// The private bridge uses this only to invalidate its fixture readiness when
/// a trusted host detaches, closes, or reports a crash. It is never exposed to
/// a renderer and carries no native pointer or source content.
@property(nonatomic, copy, nullable) NativeDayflowOwnedHostInvalidationHandler onInvalidated;

- (instancetype)initWithTrustedParentView:(NSView *)parentView;
- (BOOL)attachHostedView:(NSView *)hostedView
                       x:(CGFloat)x
                       y:(CGFloat)y
                   width:(CGFloat)width
                  height:(CGFloat)height
                    zoom:(CGFloat)zoom;
- (BOOL)resizeWithX:(CGFloat)x
                   y:(CGFloat)y
               width:(CGFloat)width
              height:(CGFloat)height
                zoom:(CGFloat)zoom;

/// Trusted main code supplies all lifecycle bits; renderer state can never
/// raise a native view above an inactive tool, modal, minimized, closed, or
/// crashed own-window host.
- (void)setVisibilityForActiveTool:(BOOL)activeTool
                       modalVisible:(BOOL)modalVisible
                      windowVisible:(BOOL)windowVisible
                         minimized:(BOOL)minimized
                      hostCrashed:(BOOL)hostCrashed;
- (BOOL)returnFocusToHostedView;
/// YES only while a native text field editor owned by the hosted subtree is
/// the first responder of the visible, unminimized own window.
- (BOOL)hostedTextInputFocused;

/// Private harness input only. Coordinates are CSS points local to the
/// attached clip; this class applies the reviewed zoom and AppKit flip
/// conversion. The mouse and key methods enqueue a bounded down/up pair onto
/// this process's AppKit event queue. A tokenized app-local monitor rechecks
/// owned attachment/focus at delivery and returns unrelated real events
/// unchanged. An up is delivered only if its own down was delivered AND the
/// same ownership test still passes; a stale up is dropped, never routed to
/// another host, window or responder. A true return means queued only, never
/// delivered, handled or persisted. No CGEvent, Accessibility, or OS-wide
/// posting is used, and nothing claims physical-human input.
- (BOOL)dispatchMouseClickAtCSSX:(CGFloat)x y:(CGFloat)y clickCount:(NSInteger)clickCount;
/// AppKit exposes no public scroll-event constructor. Future harness code may
/// forward an actual local wheel event received by this exact own window. The
/// current runner intentionally does not exercise wheel behavior.
- (BOOL)dispatchOwnedScrollEvent:(NSEvent *)event;
- (BOOL)dispatchKeyCharacters:(NSString *)characters keyCode:(unsigned short)keyCode;

/// Explicit detach restores a valid prior Electron responder, removes only
/// the owned clip/hosting views, and invalidates private fixture readiness.
- (void)detach;
/// Close/crash teardown: permanently rejects new input for this lifecycle
/// object, detaches its view, restores focus when possible, and invalidates
/// the private fixture receipt.
- (void)invalidateForHostTeardown;

@end

NS_ASSUME_NONNULL_END
