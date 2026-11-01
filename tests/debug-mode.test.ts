import {expect, test} from 'bun:test';
import {DEBUG_ENABLED, DEBUG_STORAGE_KEY, readDebugMode} from '../src/config/debug';

const tab = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {values.set(key, value);},
    removeItem: (key: string) => {values.delete(key);},
  };
};

test('?debug=1 turns Debug on and the tab remembers it', () => {
  const storage = tab();
  expect(readDebugMode('?debug=1', storage)).toBe(true);
  expect(storage.values.get(DEBUG_STORAGE_KEY)).toBe('1');
  expect(readDebugMode('', storage)).toBe(true);
  expect(readDebugMode('?recovery=1', storage)).toBe(true);
});

test('?debug=0 turns Debug off and forgets it', () => {
  const storage = tab();
  readDebugMode('?debug=1', storage);
  expect(readDebugMode('?debug=0', storage)).toBe(false);
  expect(storage.values.has(DEBUG_STORAGE_KEY)).toBe(false);
  expect(readDebugMode('', storage)).toBe(false);
});

test('a new tab without ?debug=1 starts with Debug off; other values change nothing', () => {
  expect(readDebugMode('', tab())).toBe(false);
  expect(readDebugMode('?debug=true', tab())).toBe(false);
  const on = tab();
  readDebugMode('?debug=1', on);
  expect(readDebugMode('?debug=yes', on)).toBe(true);
});

test('with storage blocked, only the current URL decides', () => {
  const blocked = {
    getItem: () => {throw new Error('blocked');},
    setItem: () => {throw new Error('blocked');},
    removeItem: () => {throw new Error('blocked');},
  };
  expect(readDebugMode('?debug=1', blocked)).toBe(true);
  expect(readDebugMode('', blocked)).toBe(false);
  expect(readDebugMode('?debug=1', null)).toBe(true);
});

test('build scripts and unit tests have no page URL, so the debug pages are built', () => {
  expect(DEBUG_ENABLED).toBe(true);
});
