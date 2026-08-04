import { describe, it, expect } from 'vitest';
import { toKebabCase, parseCapabilityArgs } from './generate.js';

describe('toKebabCase', () => {
  it('converts camelCase to kebab-case', () => {
    expect(toKebabCase('getUser')).toBe('get-user');
    expect(toKebabCase('listProjectTasks')).toBe('list-project-tasks');
  });

  it('leaves already-lowercase names unchanged', () => {
    expect(toKebabCase('ping')).toBe('ping');
  });

  it('does not add a leading dash for a name starting with an uppercase letter', () => {
    expect(toKebabCase('GetUser')).toBe('get-user');
  });
});

describe('parseCapabilityArgs', () => {
  it('single bare name — no group', () => {
    expect(parseCapabilityArgs(['getUser'])).toEqual({ capabilityName: 'getUser', groupParts: [] });
  });

  it('single slash-separated name — group from path segments', () => {
    expect(parseCapabilityArgs(['users/variants/list'])).toEqual({
      capabilityName: 'list',
      groupParts: ['users', 'variants'],
    });
  });

  it('two args — group name then capability name', () => {
    expect(parseCapabilityArgs(['users', 'getUser'])).toEqual({ capabilityName: 'getUser', groupParts: ['users'] });
  });

  it('multiple args, some slash-separated — flattened into groupParts', () => {
    expect(parseCapabilityArgs(['users', 'profile/settings', 'getUser'])).toEqual({
      capabilityName: 'getUser',
      groupParts: ['users', 'profile', 'settings'],
    });
  });
});
