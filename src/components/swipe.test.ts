import { describe, expect, it } from 'vitest';
import { swipeDecision } from './SwipeCard';

describe('swipe decision', () => {
  it('long drags swipe regardless of speed', () => {
    expect(swipeDecision(120, 0)).toBe('right');
    expect(swipeDecision(-120, 0)).toBe('left');
  });

  it('a short, fast flick counts', () => {
    expect(swipeDecision(50, 0.9)).toBe('right');
    expect(swipeDecision(-50, -0.9)).toBe('left');
  });

  it('short slow drags, tiny jitters and backwards flicks snap back', () => {
    expect(swipeDecision(50, 0.1)).toBeNull();
    expect(swipeDecision(20, 2)).toBeNull();
    expect(swipeDecision(60, -1)).toBeNull(); // moved right, but was flicking back left at release
  });
});
