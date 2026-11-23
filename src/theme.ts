import {
  argbFromHex, hexFromArgb, Hct, MaterialDynamicColors as M, DynamicScheme,
  SchemeContent, SchemeExpressive, SchemeFidelity, SchemeFruitSalad, SchemeMonochrome, SchemeNeutral, SchemeRainbow, SchemeTonalSpot, SchemeVibrant,
} from '@material/material-color-utilities'

const ROLES = [
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer', 'inversePrimary',
  'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
  'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
  'error', 'onError', 'errorContainer', 'onErrorContainer',
  'surface', 'surfaceDim', 'surfaceBright', 'onSurface', 'onSurfaceVariant',
  'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest',
  'outline', 'outlineVariant', 'inverseSurface', 'inverseOnSurface', 'scrim',
  'primaryFixed', 'primaryFixedDim', 'onPrimaryFixed', 'tertiaryFixed', 'onTertiaryFixed', 'secondaryFixed', 'onSecondaryFixed',
] as const
type Role = typeof ROLES[number]

export type SchemeStyle = 'expressive' | 'vibrant' | 'tonal' | 'fidelity' | 'content' | 'fruit' | 'rainbow' | 'neutral' | 'monochrome'
export type Contrast = 0 | 0.5 | 1

type Ctor = new (src: Hct, dark: boolean, contrast: number) => DynamicScheme
const CTORS: Record<SchemeStyle, Ctor> = {
  expressive: SchemeExpressive, vibrant: SchemeVibrant, tonal: SchemeTonalSpot, fidelity: SchemeFidelity, content: SchemeContent,
  fruit: SchemeFruitSalad, rainbow: SchemeRainbow, neutral: SchemeNeutral, monochrome: SchemeMonochrome,
}
export const STYLES: { v: SchemeStyle; label: string }[] = [
  { v: 'expressive', label: 'Expressive' }, { v: 'vibrant', label: 'Vibrant' }, { v: 'tonal', label: 'Tonal spot' },
  { v: 'fidelity', label: 'Fidelity' }, { v: 'content', label: 'Content' }, { v: 'fruit', label: 'Fruit salad' },
  { v: 'rainbow', label: 'Rainbow' }, { v: 'neutral', label: 'Neutral' }, { v: 'monochrome', label: 'Monochrome' },
]

export const SEEDS = [
  '#6750A4', '#3F51B5', '#2F6BFF', '#00838F', '#0E8A7B', '#2E7D32', '#7CB342', '#D9A400',
  '#F57C00', '#FF5A36', '#D32F2F', '#C7388B', '#8E24AA', '#795548', '#607D8B', '#212121',
]

export interface Preset { id: string; name: string; seed: string; style: SchemeStyle; contrast?: Contrast; amoled?: boolean }
export const PRESETS: Preset[] = [
  { id: 'midnight', name: 'Midnight Ink', seed: '#1E3A8A', style: 'tonal', contrast: 0.5 },
  { id: 'ember', name: 'Ember', seed: '#E8590C', style: 'vibrant' },
  { id: 'forest', name: 'Forest', seed: '#2D6A4F', style: 'tonal' },
  { id: 'ocean', name: 'Ocean', seed: '#0077B6', style: 'expressive' },
  { id: 'sakura', name: 'Sakura', seed: '#E8879C', style: 'fruit' },
  { id: 'sunflower', name: 'Sunflower', seed: '#F2C230', style: 'vibrant' },
  { id: 'arctic', name: 'Arctic', seed: '#7FB8D4', style: 'neutral' },
  { id: 'graphite', name: 'Graphite', seed: '#5F6368', style: 'monochrome' },
  { id: 'neon', name: 'Neon', seed: '#FF2BD6', style: 'rainbow' },
  { id: 'mocha', name: 'Mocha', seed: '#8B5E3C', style: 'content' },
  { id: 'lavender', name: 'Lavender', seed: '#9C89D9', style: 'expressive' },
  { id: 'terminal', name: 'Terminal', seed: '#00C853', style: 'fidelity', contrast: 0.5, amoled: true },
]

/** Codeforces rank colours (expert nudged to a friendlier but still unmistakable blue) */
export const TIER_SEEDS: [number, string, string][] = [
  [0, 'Newbie', '#808080'], [1200, 'Pupil', '#008000'], [1400, 'Specialist', '#03A89E'], [1600, 'Expert', '#2F5BFF'],
  [1900, 'Candidate Master', '#AA00AA'], [2100, 'Master', '#FF8C00'], [2300, 'International Master', '#FF8C00'], [2400, 'Grandmaster', '#FF0000'],
]
export function tierSeed(rating: number) {
  let i = 0; while (i + 1 < TIER_SEEDS.length && rating >= TIER_SEEDS[i + 1][0]) i++
  return TIER_SEEDS[i][2]
}

const kebab = (s: string) => s.replace(/[A-Z]/g, m => '-' + m.toLowerCase())
const get = (r: Role, s: DynamicScheme) => (M as unknown as Record<string, { getArgb: (s: DynamicScheme) => number }>)[r]?.getArgb(s)

export function makeScheme(seed: string, dark: boolean, style: SchemeStyle, contrast = 0) {
  return new (CTORS[style] || SchemeExpressive)(Hct.fromInt(argbFromHex(seed)), dark, contrast)
}

/** every role as hex; AMOLED (dark only) swaps the surfaces for true black + stepped neutral greys */
export function schemeColors(seed: string, dark: boolean, style: SchemeStyle, contrast = 0, amoled = false) {
  const s = makeScheme(seed, dark, style, contrast)
  const out = {} as Record<Role, string>
  for (const r of ROLES) { const v = get(r, s); if (v !== undefined) out[r] = hexFromArgb(v) }
  if (dark && amoled) {
    const t = (n: number) => hexFromArgb(s.neutralPalette.tone(n))
    Object.assign(out, {
      surface: '#000000', surfaceDim: '#000000', surfaceContainerLowest: '#000000',
      surfaceContainerLow: t(4), surfaceContainer: t(6), surfaceContainerHigh: t(10), surfaceContainerHighest: t(14), surfaceBright: t(20),
    })
  }
  return out
}

/** fixed categorical series colours (dataviz reference palette, validated per mode) for styles whose primary/secondary/tertiary collapse to near-greys */
const CHART_FIXED = { light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'], dark: ['#3987e5', '#d95926', '#199e70', '#c98500'] }
const LOW_CHROMA: SchemeStyle[] = ['monochrome', 'neutral']

export function applyTheme(seed: string, dark: boolean, style: SchemeStyle, contrast = 0, amoled = false) {
  const c = schemeColors(seed, dark, style, contrast, amoled)
  const root = document.documentElement
  for (const [r, v] of Object.entries(c)) root.style.setProperty('--' + kebab(r), v)
  const chart = chartPalette(style, dark)
  chart.forEach((v, i) => root.style.setProperty(`--chart-${i + 1}`, v))
  root.style.colorScheme = dark ? 'dark' : 'light'
  root.dataset.scheme = dark ? 'dark' : 'light'
  root.dataset.style = style
  if (dark && amoled) root.dataset.amoled = ''; else delete root.dataset.amoled
  const meta = document.querySelector('meta[name=theme-color]')
  if (meta) meta.setAttribute('content', c.surface)
}

/** chart series colours, in fixed order. Defaults to the currently applied theme.
 *  Chromatic styles → the theme roles; monochrome/neutral → a fixed validated categorical palette. */
export function chartPalette(style?: SchemeStyle, dark?: boolean): string[] {
  const root = typeof document !== 'undefined' ? document.documentElement : null
  style ??= (root?.dataset.style as SchemeStyle) || 'expressive'
  dark ??= root?.dataset.scheme === 'dark'
  if (LOW_CHROMA.includes(style)) return CHART_FIXED[dark ? 'dark' : 'light']
  return ['var(--primary)', 'var(--tertiary)', 'var(--secondary)', 'var(--error)']
}

export interface Preview { primary: string; secondary: string; tertiary: string; primaryContainer: string; surface: string; surfaceContainer: string }
const pcache = new Map<string, Preview>()
/** small swatch preview of a scheme (memoised — cheap to call from render) */
export function previewColors(seed: string, style: SchemeStyle, dark: boolean, contrast = 0, amoled = false): Preview {
  const k = [seed, style, dark, contrast, amoled].join('|')
  let p = pcache.get(k)
  if (!p) {
    const c = schemeColors(seed, dark, style, contrast, amoled)
    p = { primary: c.primary, secondary: c.secondary, tertiary: c.tertiary, primaryContainer: c.primaryContainer, surface: c.surface, surfaceContainer: c.surfaceContainer }
    pcache.set(k, p)
  }
  return p
}
