'use client';

import { useState, useEffect } from 'react';

/**
 * Breakpoints matching Tailwind CSS defaults
 */
export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536
} as const;

export type Breakpoint = keyof typeof breakpoints;

export interface ResponsiveState {
  width: number;
  height: number;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isSmallScreen: boolean; // < md
  isMediumScreen: boolean; // >= md && < lg
  isLargeScreen: boolean; // >= lg
  orientation: 'portrait' | 'landscape';
  breakpoint: Breakpoint | 'xs';
}

/**
 * Hook to get responsive state
 */
export function useResponsive(): ResponsiveState {
  const [state, setState] = useState<ResponsiveState>(() => {
    if (typeof window === 'undefined') {
      return {
        width: 1024,
        height: 768,
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        isSmallScreen: false,
        isMediumScreen: false,
        isLargeScreen: true,
        orientation: 'landscape',
        breakpoint: 'lg'
      };
    }

    return getResponsiveState();
  });

  useEffect(() => {
    const handleResize = () => {
      setState(getResponsiveState());
    };

    const handleOrientationChange = () => {
      // Small delay to ensure dimensions are updated
      setTimeout(() => {
        setState(getResponsiveState());
      }, 100);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientationChange);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, []);

  return state;
}

/**
 * Get current responsive state
 */
function getResponsiveState(): ResponsiveState {
  const width = window.innerWidth;
  const height = window.innerHeight;

  const isMobile = width < breakpoints.md;
  const isTablet = width >= breakpoints.md && width < breakpoints.lg;
  const isDesktop = width >= breakpoints.lg;

  const isSmallScreen = width < breakpoints.md;
  const isMediumScreen = width >= breakpoints.md && width < breakpoints.lg;
  const isLargeScreen = width >= breakpoints.lg;

  const orientation = width > height ? 'landscape' : 'portrait';

  let breakpoint: Breakpoint | 'xs' = 'xs';
  if (width >= breakpoints['2xl']) {
    breakpoint = '2xl';
  } else if (width >= breakpoints.xl) {
    breakpoint = 'xl';
  } else if (width >= breakpoints.lg) {
    breakpoint = 'lg';
  } else if (width >= breakpoints.md) {
    breakpoint = 'md';
  } else if (width >= breakpoints.sm) {
    breakpoint = 'sm';
  }

  return {
    width,
    height,
    isMobile,
    isTablet,
    isDesktop,
    isSmallScreen,
    isMediumScreen,
    isLargeScreen,
    orientation,
    breakpoint
  };
}

/**
 * Hook to match media query
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);

    const handleChange = (e: MediaQueryListEvent) => {
      setMatches(e.matches);
    };

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
    // Legacy browsers
    else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [query]);

  return matches;
}

/**
 * Hook to check if viewport is at or above a breakpoint
 */
export function useBreakpoint(breakpoint: Breakpoint): boolean {
  return useMediaQuery(`(min-width: ${breakpoints[breakpoint]}px)`);
}

/**
 * Hook to get touch support
 */
export function useTouchSupport(): boolean {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const hasTouch =
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      (navigator as any).msMaxTouchPoints > 0;

    setIsTouch(hasTouch);
  }, []);

  return isTouch;
}

/**
 * Hook to detect reduced motion preference
 */
export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/**
 * Hook to detect dark mode preference
 */
export function usePrefersDarkMode(): boolean {
  return useMediaQuery('(prefers-color-scheme: dark)');
}
