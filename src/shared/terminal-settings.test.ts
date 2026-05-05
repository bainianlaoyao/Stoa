import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TERMINAL_SETTINGS,
  normalizeTerminalSettings,
} from './terminal-settings';

describe('normalizeTerminalSettings', () => {
  it('returns defaults for empty input', () => {
    const result = normalizeTerminalSettings({});
    expect(result).toEqual(DEFAULT_TERMINAL_SETTINGS);
  });

  it('applies valid overrides', () => {
    const result = normalizeTerminalSettings({
      fontSize: 20,
      fontFamily: 'Fira Code',
      cursorBlink: true,
      rightClickBehavior: 'paste',
      gpuAcceleration: 'off',
      wordSeparators: ' abc',
      altClickMovesCursor: false,
    });

    expect(result.fontSize).toBe(20);
    expect(result.fontFamily).toBe('Fira Code');
    expect(result.cursorBlink).toBe(true);
    expect(result.rightClickBehavior).toBe('paste');
    expect(result.gpuAcceleration).toBe('off');
    expect(result.wordSeparators).toBe(' abc');
    expect(result.altClickMovesCursor).toBe(false);
    expect(result.scrollback).toBe(DEFAULT_TERMINAL_SETTINGS.scrollback);
    expect(result.cursorStyle).toBe(DEFAULT_TERMINAL_SETTINGS.cursorStyle);
  });

  it('ignores undefined values', () => {
    const result = normalizeTerminalSettings({
      fontSize: undefined,
      fontFamily: undefined,
    });

    expect(result.fontSize).toBe(DEFAULT_TERMINAL_SETTINGS.fontSize);
    expect(result.fontFamily).toBe(DEFAULT_TERMINAL_SETTINGS.fontFamily);
  });

  it('ignores null values', () => {
    const result = normalizeTerminalSettings({
      fontSize: null as unknown as undefined,
      fontFamily: null as unknown as undefined,
    });

    expect(result.fontSize).toBe(DEFAULT_TERMINAL_SETTINGS.fontSize);
    expect(result.fontFamily).toBe(DEFAULT_TERMINAL_SETTINGS.fontFamily);
  });

  it('ignores unknown keys', () => {
    const result = normalizeTerminalSettings({
      unknownKey: 'should be dropped',
      fontSize: 18,
    } as Record<string, unknown>);

    expect(result.fontSize).toBe(18);
    expect((result as unknown as Record<string, unknown>).unknownKey).toBeUndefined();
  });

  describe('numeric clamping', () => {
    it('clamps fontSize below minimum to 6', () => {
      expect(normalizeTerminalSettings({ fontSize: 1 }).fontSize).toBe(6);
    });

    it('clamps fontSize above maximum to 100', () => {
      expect(normalizeTerminalSettings({ fontSize: 200 }).fontSize).toBe(100);
    });

    it('keeps fontSize at boundary values', () => {
      expect(normalizeTerminalSettings({ fontSize: 6 }).fontSize).toBe(6);
      expect(normalizeTerminalSettings({ fontSize: 100 }).fontSize).toBe(100);
    });

    it('clamps scrollback below minimum to 0', () => {
      expect(normalizeTerminalSettings({ scrollback: -50 }).scrollback).toBe(0);
    });

    it('clamps scrollback above maximum to 1_000_000', () => {
      expect(normalizeTerminalSettings({ scrollback: 5_000_000 }).scrollback).toBe(1_000_000);
    });

    it('keeps scrollback at boundary values', () => {
      expect(normalizeTerminalSettings({ scrollback: 0 }).scrollback).toBe(0);
      expect(normalizeTerminalSettings({ scrollback: 1_000_000 }).scrollback).toBe(1_000_000);
    });

    it('clamps lineHeight below minimum to 0.5', () => {
      expect(normalizeTerminalSettings({ lineHeight: 0.1 }).lineHeight).toBe(0.5);
    });

    it('clamps lineHeight above maximum to 10', () => {
      expect(normalizeTerminalSettings({ lineHeight: 20 }).lineHeight).toBe(10);
    });

    it('keeps lineHeight at boundary values', () => {
      expect(normalizeTerminalSettings({ lineHeight: 0.5 }).lineHeight).toBe(0.5);
      expect(normalizeTerminalSettings({ lineHeight: 10 }).lineHeight).toBe(10);
    });

    it('clamps letterSpacing below minimum to -20', () => {
      expect(normalizeTerminalSettings({ letterSpacing: -50 }).letterSpacing).toBe(-20);
    });

    it('clamps letterSpacing above maximum to 20', () => {
      expect(normalizeTerminalSettings({ letterSpacing: 50 }).letterSpacing).toBe(20);
    });

    it('keeps letterSpacing at boundary values', () => {
      expect(normalizeTerminalSettings({ letterSpacing: -20 }).letterSpacing).toBe(-20);
      expect(normalizeTerminalSettings({ letterSpacing: 20 }).letterSpacing).toBe(20);
    });

    it('clamps cursorWidth below minimum to 1', () => {
      expect(normalizeTerminalSettings({ cursorWidth: 0 }).cursorWidth).toBe(1);
    });

    it('clamps cursorWidth above maximum to 10', () => {
      expect(normalizeTerminalSettings({ cursorWidth: 15 }).cursorWidth).toBe(10);
    });

    it('keeps cursorWidth at boundary values', () => {
      expect(normalizeTerminalSettings({ cursorWidth: 1 }).cursorWidth).toBe(1);
      expect(normalizeTerminalSettings({ cursorWidth: 10 }).cursorWidth).toBe(10);
    });

    it('clamps minimumContrastRatio below minimum to 1', () => {
      expect(normalizeTerminalSettings({ minimumContrastRatio: 0 }).minimumContrastRatio).toBe(1);
    });

    it('clamps minimumContrastRatio above maximum to 21', () => {
      expect(normalizeTerminalSettings({ minimumContrastRatio: 30 }).minimumContrastRatio).toBe(21);
    });

    it('keeps minimumContrastRatio at boundary values', () => {
      expect(normalizeTerminalSettings({ minimumContrastRatio: 1 }).minimumContrastRatio).toBe(1);
      expect(normalizeTerminalSettings({ minimumContrastRatio: 21 }).minimumContrastRatio).toBe(21);
    });
  });
});
