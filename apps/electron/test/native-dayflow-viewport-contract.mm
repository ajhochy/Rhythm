#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

#include "NativeDayflowOwnedHostLifecycle.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

@interface NativeDayflowContractContentView : NSView
@property(nonatomic, assign) CGFloat measuredContentHeight;
@property(nonatomic, assign) BOOL contentFlipped;
@end

@implementation NativeDayflowContractContentView
- (NSSize)intrinsicContentSize {
  return NSMakeSize(NSViewNoIntrinsicMetric, self.measuredContentHeight);
}
- (NSSize)fittingSize {
  return NSMakeSize(1210.0, self.measuredContentHeight);
}
- (BOOL)isFlipped {
  return self.contentFlipped;
}
@end

namespace {
struct Fixture {
  NSWindow *window = nil;
  NSView *parent = nil;
  NativeDayflowOwnedHostLifecycle *lifecycle = nil;
  NativeDayflowContractContentView *hosted = nil;
  NSView *viewport = nil;
  NSScrollView *scroll = nil;
  NSView *document = nil;
  NSView *sibling = nil;
};

void Check(bool condition, const std::string &message, std::vector<std::string> &failures) {
  if (!condition) failures.push_back(message);
}

bool Near(CGFloat left, CGFloat right, CGFloat tolerance = 1.0) {
  return std::fabs(static_cast<double>(left - right)) <= tolerance;
}

Fixture MakeFixture(CGFloat windowHeight, CGFloat viewportHeight, bool withSibling,
                    CGFloat contentHeight = 558.0, bool flipped = NO) {
  Fixture fixture;
  fixture.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1280, windowHeight)
                                               styleMask:NSWindowStyleMaskBorderless
                                                 backing:NSBackingStoreBuffered
                                                   defer:NO];
  fixture.window.releasedWhenClosed = NO;
  fixture.parent = fixture.window.contentView;
  [fixture.parent setFrameSize:NSMakeSize(1280, windowHeight)];
  if (withSibling) {
    fixture.sibling = [[NSView alloc] initWithFrame:NSMakeRect(8, 8, 48, 36)];
    [fixture.parent addSubview:fixture.sibling];
  }
  fixture.lifecycle = [[NativeDayflowOwnedHostLifecycle alloc] initWithTrustedParentView:fixture.parent];
  fixture.hosted = [[NativeDayflowContractContentView alloc] initWithFrame:NSMakeRect(0, 0, 1210, viewportHeight)];
  fixture.hosted.measuredContentHeight = contentHeight;
  fixture.hosted.contentFlipped = flipped;
  const CGFloat y = 229.0;
  const BOOL attached = [fixture.lifecycle attachHostedView:fixture.hosted
                                                          x:35.0
                                                          y:y
                                                      width:1210.0
                                                     height:viewportHeight
                                                       zoom:1.0];
  if (!attached) return fixture;
  [fixture.lifecycle setVisibilityForActiveTool:YES modalVisible:NO windowVisible:YES minimized:NO hostCrashed:NO];

  for (NSView *child in fixture.parent.subviews) {
    if (child == fixture.sibling) continue;
    fixture.viewport = child;
    break;
  }
  if ([fixture.viewport isKindOfClass:[NSScrollView class]]) {
    fixture.scroll = (NSScrollView *)fixture.viewport;
    fixture.document = fixture.scroll.documentView;
  }
  if (fixture.document == nil) fixture.document = fixture.hosted;
  return fixture;
}

CGFloat RequiredContentHeight(Fixture &fixture) {
  return std::max(fixture.hosted.intrinsicContentSize.height, fixture.hosted.fittingSize.height);
}

NSRect VisibleDocumentRect(Fixture &fixture) {
  return fixture.document != nil ? fixture.document.visibleRect : NSZeroRect;
}

void ScrollOwnedDocumentToBottom(Fixture &fixture) {
  if (fixture.scroll == nil || fixture.document == nil) return;
  NSClipView *clip = fixture.scroll.contentView;
  const CGFloat maximumY = std::max(0.0, NSHeight(fixture.document.frame) - NSHeight(clip.bounds));
  const CGFloat bottomY = fixture.document.isFlipped ? maximumY : 0.0;
  [clip scrollToPoint:NSMakePoint(0, bottomY)];
  [fixture.scroll reflectScrolledClipView:clip];
  [fixture.scroll layoutSubtreeIfNeeded];
  [fixture.document layoutSubtreeIfNeeded];
}

bool IsAtDocumentBottom(Fixture &fixture) {
  if (fixture.document == nil) return false;
  const NSRect visible = VisibleDocumentRect(fixture);
  const NSRect bounds = fixture.document.bounds;
  return fixture.document.isFlipped ? NSMaxY(visible) >= NSMaxY(bounds) - 1.0
                                    : NSMinY(visible) <= NSMinY(bounds) + 1.0;
}

void RunShortViewport(std::vector<std::string> &failures, CGFloat contentHeight, bool flipped) {
  Fixture fixture = MakeFixture(800.0, 445.0, false, contentHeight, flipped);
  Check(fixture.lifecycle.isAttached, "lifecycle did not attach to the hidden local AppKit window", failures);
  Check(fixture.viewport != nil, "the owned native viewport is absent from its exact parent", failures);
  if (fixture.viewport == nil) return;

  const NSRect before = fixture.viewport.frame;
  Check(Near(NSWidth(before), 1210.0) && Near(NSHeight(before), 445.0),
        "the native viewport must stay at 1210x445 points", failures);
  Check(NSContainsRect(fixture.parent.bounds, before),
        "the native viewport escaped its trusted parent bounds", failures);
  Check(fixture.scroll != nil,
        "the short native viewport has no owned AppKit scroll view for its taller document", failures);
  Check(fixture.document != nil && NSHeight(fixture.document.frame) >= RequiredContentHeight(fixture) - 1.0,
        "the AppKit document frame is shorter than the measured native content", failures);

  const bool hasNativeScrollDocument = fixture.scroll != nil && fixture.document != nil;
  const NSRect beforeScroll = VisibleDocumentRect(fixture);
  if (hasNativeScrollDocument) ScrollOwnedDocumentToBottom(fixture);
  const NSRect visible = VisibleDocumentRect(fixture);
  const CGFloat documentHeight = fixture.document != nil ? NSHeight(fixture.document.frame) : 0.0;
  Check(fixture.scroll != nil && documentHeight > NSHeight(before),
        "a scrollable native document must extend beyond the viewport", failures);
  Check(IsAtDocumentBottom(fixture),
        "scrolling the owned AppKit document cannot reveal its bottom content", failures);
  if (hasNativeScrollDocument && documentHeight > NSHeight(before)) {
    Check(!NSEqualRects(beforeScroll, visible),
          "scrolling an overflowing document to bottom did not change its visible region", failures);
  }
  Check(NSEqualRects(fixture.viewport.frame, before),
        "scrolling changed the viewport frame instead of the document offset", failures);
}

void RunResize(std::vector<std::string> &failures) {
  Fixture fixture = MakeFixture(1300.0, 944.0, false);
  Check(fixture.lifecycle.isAttached && fixture.viewport != nil,
        "tall native viewport did not attach", failures);
  if (fixture.viewport == nil) return;
  Check(Near(NSHeight(fixture.viewport.frame), 944.0),
        "tall native viewport is not 944 points high", failures);
  Check(fixture.scroll != nil,
        "the lifecycle has no native document viewport to remeasure after resize", failures);
  if (fixture.scroll != nil && fixture.document != nil) {
    const CGFloat tallOverflow = NSHeight(fixture.document.frame) - NSHeight(fixture.scroll.contentView.bounds);
    Check(tallOverflow <= 1.0,
          "fitting native content has unnecessary scroll range in the 944-point viewport", failures);
  }

  [fixture.window setContentSize:NSMakeSize(1280.0, 800.0)];
  [fixture.parent setFrameSize:NSMakeSize(1280.0, 800.0)];
  const BOOL resized = [fixture.lifecycle resizeWithX:35.0 y:229.0 width:1210.0 height:445.0 zoom:1.0];
  Check(resized, "the attached native viewport rejected the current 445-point layout", failures);
  Check(Near(NSHeight(fixture.viewport.frame), 445.0) && NSContainsRect(fixture.parent.bounds, fixture.viewport.frame),
        "the resized native viewport does not remain clipped to the 445-point parent area", failures);
  Check(fixture.document != nil && NSHeight(fixture.document.frame) >= RequiredContentHeight(fixture) - 1.0,
        "tall-to-short resize retained a truncated frame instead of the current 558-point content minimum", failures);
  ScrollOwnedDocumentToBottom(fixture);
  Check(IsAtDocumentBottom(fixture),
        "after tall-to-short resize the native document bottom is unreachable", failures);

  [fixture.window setContentSize:NSMakeSize(1280.0, 1300.0)];
  [fixture.parent setFrameSize:NSMakeSize(1280.0, 1300.0)];
  const BOOL grewTall = [fixture.lifecycle resizeWithX:35.0 y:229.0 width:1210.0 height:944.0 zoom:1.0];
  Check(grewTall, "the attached native viewport rejected the current 944-point layout", failures);
  Check(Near(NSHeight(fixture.viewport.frame), 944.0) && NSContainsRect(fixture.parent.bounds, fixture.viewport.frame),
        "the resized native viewport does not return to the current tall parent area", failures);
  if (fixture.scroll != nil && fixture.document != nil) {
    const CGFloat returnedTallOverflow = NSHeight(fixture.document.frame) - NSHeight(fixture.scroll.contentView.bounds);
    Check(returnedTallOverflow <= 1.0,
          "short-to-tall resize retained a stale oversized scroll range", failures);
  }
}

void RunOwnershipAndLifecycle(std::vector<std::string> &failures) {
  Fixture fixture = MakeFixture(800.0, 445.0, true);
  Check(fixture.lifecycle.isAttached && fixture.viewport != nil && fixture.sibling != nil,
        "owned lifecycle fixture did not attach with its sibling view", failures);
  if (fixture.viewport == nil || fixture.sibling == nil) return;
  const NSRect viewportFrame = fixture.viewport.frame;
  const NSRect siblingFrame = fixture.sibling.frame;
  const NSRect contentFrame = fixture.window.contentView.frame;

  const bool hasNativeScrollDocument = fixture.scroll != nil && fixture.document != nil;
  if (hasNativeScrollDocument) ScrollOwnedDocumentToBottom(fixture);
  Check(NSEqualRects(fixture.viewport.frame, viewportFrame),
        "native scrolling moved or resized the owning viewport", failures);
  Check(NSEqualRects(fixture.sibling.frame, siblingFrame),
        "native scrolling changed a sibling view", failures);
  Check(NSEqualRects(fixture.window.contentView.frame, contentFrame),
        "native scrolling changed the owning window content frame", failures);

  const NSRect scrollPosition = VisibleDocumentRect(fixture);
  const NSRect clipBounds = fixture.scroll != nil ? fixture.scroll.contentView.bounds : NSZeroRect;
  [fixture.lifecycle setVisibilityForActiveTool:YES modalVisible:YES windowVisible:YES minimized:NO hostCrashed:NO];
  Check(fixture.lifecycle.isNativeViewHidden,
        "the owned native viewport stayed visible under a blocking modal", failures);
  Check(![fixture.lifecycle returnFocusToHostedView],
        "a hidden, non-frontmost local window accepted native focus", failures);
  [fixture.lifecycle setVisibilityForActiveTool:YES modalVisible:NO windowVisible:YES minimized:NO hostCrashed:NO];
  Check(!fixture.lifecycle.isNativeViewHidden,
        "the owned native viewport did not restore after the modal closed", failures);
  if (hasNativeScrollDocument) {
    Check(NSEqualRects(fixture.scroll.contentView.bounds, clipBounds) &&
              NSEqualRects(VisibleDocumentRect(fixture), scrollPosition),
          "modal hide/show discarded the user's native document scroll position", failures);
  }

  NSWindow *otherWindow = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 300, 200)
                                                     styleMask:NSWindowStyleMaskBorderless
                                                       backing:NSBackingStoreBuffered
                                                         defer:NO];
  otherWindow.releasedWhenClosed = NO;
  NSView *wrongParent = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 1280, 800)];
  [fixture.parent addSubview:wrongParent];
  [fixture.viewport removeFromSuperview];
  [wrongParent addSubview:fixture.viewport];
  Check(!fixture.lifecycle.isAttached,
        "moving the viewport under a different parent in the same window still reports an attached lifecycle", failures);
  Check(![fixture.lifecycle resizeWithX:35.0 y:229.0 width:1210.0 height:445.0 zoom:1.0],
        "the lifecycle accepted bounds after the viewport moved under a different same-window parent", failures);
  [fixture.viewport removeFromSuperview];
  [fixture.parent addSubview:fixture.viewport];
  Check(fixture.lifecycle.isAttached,
        "restoring the viewport to its exact trusted parent did not restore attachment", failures);

  NSView *otherSubview = [[NSView alloc] initWithFrame:NSMakeRect(12, 16, 30, 24)];
  [otherWindow.contentView addSubview:otherSubview];
  NSResponder *otherResponder = otherWindow.firstResponder;
  const NSRect otherSubviewFrame = otherSubview.frame;
  [fixture.viewport removeFromSuperview];
  [otherWindow.contentView addSubview:fixture.viewport];
  Check(!fixture.lifecycle.isAttached,
        "moving the viewport outside its exact trusted parent still reports an attached lifecycle", failures);
  Check(![fixture.lifecycle resizeWithX:35.0 y:229.0 width:1210.0 height:445.0 zoom:1.0],
        "the lifecycle accepted new bounds after its viewport moved to an unrelated window", failures);
  [fixture.lifecycle detach];
  Check(!fixture.lifecycle.isAttached && fixture.hosted.superview == nil,
        "detach left the hosted native document attached", failures);
  Check(fixture.viewport.superview == nil,
        "detach did not remove only the owned native viewport", failures);
  Check(fixture.sibling.superview == fixture.parent && NSEqualRects(fixture.sibling.frame, siblingFrame),
        "detach altered an unrelated sibling in the exact parent", failures);
  Check(otherSubview.superview == otherWindow.contentView && NSEqualRects(otherSubview.frame, otherSubviewFrame) &&
            otherWindow.firstResponder == otherResponder,
        "detach or focus handling changed an unrelated native window", failures);
}

}  // namespace

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSApplication *application = [NSApplication sharedApplication];
    [application setActivationPolicy:NSApplicationActivationPolicyAccessory];
    std::vector<std::string> failures;
    const std::string criterion = argc > 1 ? argv[1] : "";
    if (criterion == "short") {
      RunShortViewport(failures, 558.0, NO);
      RunShortViewport(failures, 700.0, YES);
    }
    else if (criterion == "resize") RunResize(failures);
    else if (criterion == "ownership") RunOwnershipAndLifecycle(failures);
    else {
      std::fprintf(stderr, "HARNESS_SETUP_ERROR|expected one of short, resize, ownership\n");
      return 2;
    }
    if (failures.empty()) {
      std::printf("NATIVE_CONTRACT_RESULT|%s|PASS\n", criterion.c_str());
      return 0;
    }
    for (const std::string &failure : failures) {
      std::printf("NATIVE_CONTRACT_ASSERTION|%s|FAIL|%s\n", criterion.c_str(), failure.c_str());
    }
    return 1;
  }
}
