/**
 * Terminal settings types, VS Code-aligned defaults, and normalization.
 *
 * These are pure data types with no runtime dependencies beyond TypeScript.
 * Normalization clamps out-of-range values and strips unknown keys.
 */

// ---------------------------------------------------------------------------
// String-enum style types
// ---------------------------------------------------------------------------

export type CursorStyle = 'block' | 'underline' | 'bar';
export type CursorInactiveStyle = 'outline' | 'block' | 'bar' | 'underline' | 'none';
export type RightClickBehavior = 'default' | 'paste' | 'nothing' | 'selectWord';
export type GpuAcceleration = 'auto' | 'on' | 'off';

// ---------------------------------------------------------------------------
// Settings interface
// ---------------------------------------------------------------------------

export interface TerminalSettings {
  fontSize: number;
  fontFamily: string;
  fontFamilyCJK: string;
  fontWeight: string | number;
  fontWeightBold: string | number;
  lineHeight: number;
  letterSpacing: number;

  cursorBlink: boolean;
  cursorStyle: CursorStyle;
  cursorInactiveStyle: CursorInactiveStyle;
  cursorWidth: number;

  scrollback: number;
  fastScrollSensitivity: number;
  scrollSensitivity: number;

  minimumContrastRatio: number;
  copyOnSelection: boolean;
  rightClickBehavior: RightClickBehavior;
  gpuAcceleration: GpuAcceleration;
  wordSeparators: string;
  altClickMovesCursor: boolean;
}

// ---------------------------------------------------------------------------
// Defaults (VS Code-aligned)
// ---------------------------------------------------------------------------

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  fontSize: 14,
  fontFamily: '',
  fontFamilyCJK: '',
  fontWeight: 'normal',
  fontWeightBold: 'bold',
  lineHeight: 1,
  letterSpacing: 0,

  cursorBlink: false,
  cursorStyle: 'bar',
  cursorInactiveStyle: 'outline',
  cursorWidth: 1,

  scrollback: 1000,
  fastScrollSensitivity: 5,
  scrollSensitivity: 1,

  minimumContrastRatio: 4.5,
  copyOnSelection: false,
  rightClickBehavior: 'default',
  gpuAcceleration: 'auto',
  wordSeparators: ' ()[]{}\'"`,:;',
  altClickMovesCursor: true,
};

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

interface NumericClamp {
  min: number;
  max: number;
}

const NUMERIC_CLAMPS: Record<string, NumericClamp> = {
  fontSize: { min: 6, max: 100 },
  scrollback: { min: 0, max: 1_000_000 },
  lineHeight: { min: 0.5, max: 10 },
  letterSpacing: { min: -20, max: 20 },
  cursorWidth: { min: 1, max: 10 },
  minimumContrastRatio: { min: 1, max: 21 },
};

const KNOWN_KEYS = new Set<string>(Object.keys(DEFAULT_TERMINAL_SETTINGS));

function clamp(value: number, clampSpec: NumericClamp): number {
  return Math.min(clampSpec.max, Math.max(clampSpec.min, value));
}

/**
 * Merge a partial settings object with defaults.
 *
 * - Missing values are filled from DEFAULT_TERMINAL_SETTINGS.
 * - `undefined` and `null` values are ignored (treated as missing).
 * - Unknown keys are silently dropped.
 * - Numeric fields with clamping rules are clamped to their valid range.
 */
export function normalizeTerminalSettings(
  partial: Partial<TerminalSettings>,
): TerminalSettings {
  const result: TerminalSettings = { ...DEFAULT_TERMINAL_SETTINGS };

  for (const key of Object.keys(partial)) {
    if (!KNOWN_KEYS.has(key)) {
      continue;
    }

    const value = (partial as Record<string, unknown>)[key];
    if (value === undefined || value === null) {
      continue;
    }

    const clamped = NUMERIC_CLAMPS[key];
    if (clamped && typeof value === 'number') {
      (result as unknown as Record<string, unknown>)[key] = clamp(value, clamped);
    } else {
      (result as unknown as Record<string, unknown>)[key] = value;
    }
  }

  return result;
}
