import { expect, spyOn, test } from 'bun:test';
import { deobfuscateData, isObfuscated, obfuscateData } from '@/utils/encryption';

test('obfuscates and restores Unicode without browser globals or fallback warnings', () => {
  expect(typeof window).toBe('undefined');
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const value = 'Test configuration 配置';
    const payload = obfuscateData(value);
    expect(isObfuscated(payload)).toBe(true);
    expect(payload).not.toContain(value);
    expect(deobfuscateData(payload)).toBe(value);
    expect(warn).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});
