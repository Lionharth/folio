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
    textSecondary: '#77746F',
    textTertiary: '#9A968F',
    border: '#E8E6E1',
    borderStrong: '#D6D3CC',
    ink: '#171717',
    onInk: '#F8F7F4',
    danger: '#8C3B2E',
    dangerSurface: '#F6EDEA',
    success: '#3F6B4F',
    overlay: 'rgba(23, 23, 23, 0.55)',
    scrim: 'rgba(248, 247, 244, 0.92)',
  },
  dark: {
    background: '#111111',
    surface: '#1B1B1B',
    surfaceSubtle: '#252523',
    surfaceRaised: '#202020',
    textPrimary: '#F5F4F0',
    textSecondary: '#A09E99',
    textTertiary: '#7C7A75',
    border: '#30302E',
    borderStrong: '#3D3D3A',
    ink: '#F5F4F0',
    onInk: '#111111',
    danger: '#D98B7C',
    dangerSurface: '#2A1E1C',
    success: '#8FB79B',
    overlay: 'rgba(0, 0, 0, 0.65)',
    scrim: 'rgba(17, 17, 17, 0.92)',
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
  tabBarHeight: 60,
  maxContentWidth: 640,
} as const;

export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  pill: 999,
} as const;

/**
 * Both families are bundled as assets; no runtime download.
 * See DEVELOPMENT.md for the licensing note.
 */
export const fontFamily = {
  serifLight: 'CormorantGaramond_300Light',
  serif: 'CormorantGaramond_400Regular',
  serifItalic: 'CormorantGaramond_400Regular_Italic',
  serifMedium: 'CormorantGaramond_500Medium',
  serifSemiBold: 'CormorantGaramond_600SemiBold',
  sans: 'Manrope_400Regular',
  sansMedium: 'Manrope_500Medium',
  sansSemiBold: 'Manrope_600SemiBold',
  sansBold: 'Manrope_700Bold',
} as const;

export const typeScale = {
  display: { fontFamily: fontFamily.serifMedium, fontSize: 40, lineHeight: 44, letterSpacing: -0.4 },
  title: { fontFamily: fontFamily.serifMedium, fontSize: 30, lineHeight: 34, letterSpacing: -0.2 },
  headline: { fontFamily: fontFamily.serif, fontSize: 23, lineHeight: 29, letterSpacing: -0.1 },
  vlogTitle: { fontFamily: fontFamily.serifSemiBold, fontSize: 21, lineHeight: 26 },
  body: { fontFamily: fontFamily.sans, fontSize: 15.5, lineHeight: 23 },
  bodyStrong: { fontFamily: fontFamily.sansMedium, fontSize: 15.5, lineHeight: 23 },
  callout: { fontFamily: fontFamily.sansMedium, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: fontFamily.sansSemiBold, fontSize: 12.5, lineHeight: 16, letterSpacing: 0.2 },
  caption: { fontFamily: fontFamily.sans, fontSize: 12.5, lineHeight: 17 },
  meta: { fontFamily: fontFamily.sansMedium, fontSize: 11.5, lineHeight: 15, letterSpacing: 0.35 },
  button: { fontFamily: fontFamily.sansSemiBold, fontSize: 14.5, lineHeight: 18, letterSpacing: 0.1 },
  mono: {
    fontFamily: Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' }),
    fontSize: 12,
    lineHeight: 17,
  },
} as const;

export type TypeVariant = keyof typeof typeScale;
