// Halo Stage lighting: how zones look, and the shared store against the emulated Module. No hardware.
import {expect, test} from 'bun:test';
import {effectMotion, zoneHex, zoneLook} from '../src/utils/toffee_studio/lighting-look';
import {REAR_EFFECTS} from '../src/utils/toffee_studio/lighting-effects';

test('zone colours use the board hue (red at 0, clockwise) and saturation at full value', () => {
  expect(zoneHex(0, 255)).toBe('#ff0000');
  expect(zoneHex(85, 255)).toBe('#00ff00');
  expect(zoneHex(170, 255)).toBe('#0000ff');
  expect(zoneHex(123, 0)).toBe('#ffffff');
});

test('zone looks: unknown boards get a quiet violet underglow; Off and brightness set the level', () => {
  expect(zoneLook('rear', undefined)).toEqual({colour: '#7b2dff', level: 0.6, motion: 'none'});
  expect(zoneLook('front', undefined).level).toBe(0);
  const lit = {effect: 0, speed: 0, brightness: 255, hue: 0, saturation: 255};
  expect(zoneLook('rear', lit)).toEqual({colour: '#ff0000', level: 1, motion: 'none'}); // Solid
  expect(zoneLook('front', lit).level).toBe(0); // Off
  expect(zoneLook('badge', {...lit, effect: 2, brightness: 51}).level).toBe(0.2);
  expect(REAR_EFFECTS.map(effect => effectMotion(effect.label))).toEqual(
    ['none', 'breathe', 'cycle', 'cycle', 'none', 'none', 'cycle', 'cycle', 'cycle', 'flicker']);
  expect(effectMotion('Typing Heatmap')).toBe('flicker');
  expect(effectMotion('Rainbow Cycle')).toBe('cycle');
});

test('the store loads all three zones and sends each edit to the board', async () => {
  // Own process: other suites mock modules that the full store imports.
  const child = Bun.spawn([process.execPath, 'tests/halo-lighting-store-fixture.ts'], {stdout: 'pipe', stderr: 'pipe'});
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect({stdout, stderr, code}).toMatchObject({code: 0});
  expect(stdout).toContain('HALO STORE PASS');
});
