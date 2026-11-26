import { Platform } from 'react-native';

export type ColorScheme = 'light' | 'dark';

export interface Palette {
  background: string;
  surface: string;
  surfaceSubtle: string;
  surfaceRaised: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  borderStrong: string;
  ink: string;
  onInk: string;
  danger: string;
  dangerSurface: string;
  success: string;
  overlay: string;
  scrim: string;
}

export const palettes: Record<ColorScheme, Palette> = {
  light: {
    background: '#F8F7F4',
    surface: '#FFFFFF',
    surfaceSubtle: '#EFEEE9',
    surfaceRaised: '#FFFFFF',
    textPrimary: '#171717',
    textSecondary: '#65615B',
    textTertiary: '#716C65',
    border: '#E8E6E1',
    borderStrong: '#C9C5BC',
    ink: '#171717',
    onInk: '#F8F7F4',
    danger: '#8C3B2E',
    dangerSurface: '#F6EDEA',
    success: '#3F6B4F',
    overlay: 'rgba(23, 23, 23, 0.55)',
    scrim: 'rgba(248, 247, 244, 0.94)',
  },
  dark: {
    background: '#111111',
    surface: '#1B1B1B',
    surfaceSubtle: '#252523',
    surfaceRaised: '#202020',
    textPrimary: '#F5F4F0',
    textSecondary: '#AAA69F',
    textTertiary: '#99958E',
    border: '#30302E',
    borderStrong: '#484743',
    ink: '#F5F4F0',
    onInk: '#111111',
    danger: '#E09A8B',
    dangerSurface: '#2A1E1C',
    success: '#9BC2A7',
    overlay: 'rgba(0, 0, 0, 0.65)',
    scrim: 'rgba(17, 17, 17, 0.94)',
  },
};

/** 4dp spacing scale. */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 48,
} as const;

export const layout = {
  screenMargin: 24,
  minTouchTarget: 48,
  icon: 22,
  iconLarge: 24,
  tabBarHeight: 72,
  maxContentWidth: 640,
} as const;

export const media = {
  heroAspect: 4 / 3,
  standardAspect: 16 / 10,
  gridAspect: 4 / 5,
  viewerCollapsedAspect: 16 / 12,
} as const;

export const motion = {
  none: 0,
  fast: 140,
  standard: 220,
  enter: 320,
  sheet: 280,
} as const;

export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  pill: 999,
} as const;

/** Both families are bundled as assets; no runtime download. */
export const fontFamily = {
  serifLight: 'CormorantGaramond_300Light',
  serif: 'CormorantGaramond_400Regular',
  serifItalic: 'CormorantGaramond_400Regular_Italic',
  serifMedium: 'CormorantGaramond_500Medium',
  serifSemiBold: 'CormorantGaramond_600SemiBold',
  sans: 'InstrumentSans_400Regular',
  sansMedium: 'InstrumentSans_500Medium',
  sansSemiBold: 'InstrumentSans_600SemiBold',
  sansBold: 'InstrumentSans_700Bold',
} as const;

export const typeScale = {
  display: { fontFamily: fontFamily.serifMedium, fontSize: 46, lineHeight: 48, letterSpacing: -0.6 },
  title: { fontFamily: fontFamily.serifMedium, fontSize: 34, lineHeight: 38, letterSpacing: -0.3 },
  headline: { fontFamily: fontFamily.serif, fontSize: 24, lineHeight: 30, letterSpacing: -0.1 },
  vlogTitle: { fontFamily: fontFamily.serifSemiBold, fontSize: 24, lineHeight: 29 },
  body: { fontFamily: fontFamily.sans, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: fontFamily.sansMedium, fontSize: 16, lineHeight: 24 },
  callout: { fontFamily: fontFamily.sansMedium, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: fontFamily.sansSemiBold, fontSize: 12.5, lineHeight: 17, letterSpacing: 0.2 },
  caption: { fontFamily: fontFamily.sans, fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: fontFamily.sansMedium, fontSize: 12, lineHeight: 16, letterSpacing: 0.25 },
  button: { fontFamily: fontFamily.sansSemiBold, fontSize: 14.5, lineHeight: 19, letterSpacing: 0.1 },
  mono: {
    fontFamily: Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' }),
    fontSize: 12,
    lineHeight: 17,
  },
} as const;

export type TypeVariant = keyof typeof typeScale;
