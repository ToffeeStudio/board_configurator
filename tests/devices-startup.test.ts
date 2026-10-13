import {expect, test} from 'bun:test';

for (const scenario of ['cold', 'cached']) {
  test(`startup waits for saved and bundled definitions (${scenario} catalog)`, async () => {
    // Keep module mocks out of the HID and other regression tests' process.
    const child = Bun.spawn([process.execPath, 'tests/devices-startup-fixture.ts', scenario],
      {stdout: 'pipe', stderr: 'pipe'});
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({stdout, stderr, code}).toMatchObject({code: 0});
    expect(stdout).toContain(`STARTUP PASS ${scenario}`);
  });
}
