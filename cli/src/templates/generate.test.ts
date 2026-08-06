import { describe, it, expect } from 'vitest';
import { renderCapabilityTs } from './generate.js';

describe('renderCapabilityTs', () => {
  it('marks the no-input scaffold as a placeholder capix check can detect', () => {
    expect(renderCapabilityTs('getItem', false)).toContain('// TODO: implement');
  });

  it('marks the with-input scaffold as a placeholder capix check can detect', () => {
    expect(renderCapabilityTs('getItem', true)).toContain('// TODO: implement');
  });
});
