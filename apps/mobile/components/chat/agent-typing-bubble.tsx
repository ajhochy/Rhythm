import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  View,
} from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';

const DOT_COUNT = 3;
const DOT_DIM_OPACITY = 0.35;

/** A compact, non-interactive indicator rendered only while an agent is active. */
export function AgentTypingBubble() {
  // Start static so an unresolved system preference can never briefly animate
  // for someone who has requested reduced motion.
  const [reducedMotion, setReducedMotion] = useState(true);
  const dotOpacities = useRef(
    Array.from({ length: DOT_COUNT }, () => new Animated.Value(1)),
  ).current;
  const colorScheme = useColorScheme() ?? 'light';
  const bubbleColor = colorScheme === 'dark' ? '#343A38' : '#56605C';

  useEffect(() => {
    let mounted = true;
    let receivedMotionEvent = false;
    const onReduceMotionChanged = (enabled: boolean) => {
      receivedMotionEvent = true;
      if (mounted) setReducedMotion(enabled);
    };
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      onReduceMotionChanged,
    );

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        // An event is newer than the startup query. Do not let a delayed
        // promise restore an obsolete preference after the OS has changed it.
        if (mounted && !receivedMotionEvent) setReducedMotion(enabled);
      })
      .catch(() => {
        if (mounted && !receivedMotionEvent) setReducedMotion(true);
      });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const resetDots = () => {
      dotOpacities.forEach((opacity) => {
        opacity.stopAnimation();
        opacity.setValue(1);
      });
    };

    if (reducedMotion) {
      resetDots();
      return;
    }

    const animation = Animated.loop(
      Animated.stagger(
        120,
        dotOpacities.map((opacity) =>
          Animated.sequence([
            Animated.timing(opacity, {
              duration: 280,
              toValue: DOT_DIM_OPACITY,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              duration: 280,
              toValue: 1,
              useNativeDriver: true,
            }),
          ]),
        ),
      ),
    );
    animation.start();

    return () => {
      animation.stop();
      dotOpacities.forEach((opacity) => opacity.stopAnimation());
    };
  }, [dotOpacities, reducedMotion]);

  return (
    <View
      accessible
      accessibilityLabel="Agent working"
      accessibilityRole="text"
      style={styles.row}>
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.decoration}>
        <View style={[styles.tail, { backgroundColor: bubbleColor }]} />
        <View style={[styles.bubble, { backgroundColor: bubbleColor }]}>
          {dotOpacities.map((opacity, index) => (
            <Animated.View
              accessible={false}
              key={index}
              style={[styles.dot, { opacity }]}
              testID={`agent-typing-dot-${index}`}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    alignItems: 'center',
    borderRadius: 22,
    flexDirection: 'row',
    gap: 9,
    minHeight: 44,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  dot: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  decoration: {
    alignSelf: 'flex-start',
    position: 'relative',
  },
  row: {
    alignSelf: 'flex-start',
    marginBottom: 8,
    marginLeft: 4,
    position: 'relative',
  },
  tail: {
    borderBottomLeftRadius: 11,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 3,
    bottom: 3,
    height: 12,
    left: -5,
    position: 'absolute',
    transform: [{ rotate: '18deg' }],
    width: 12,
  },
});
