import {test,expect} from 'bun:test';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
for (const scenario of ['wrong-build','wrong-cap','wrong-profile','stale-output','failed-off','camera-error','camera-owner','bad-reading','bad-frame','no-reading']) {
  test(`visual controller fails closed: ${scenario}`, async () => {
    const output = path.join(await mkdtemp(path.join(os.tmpdir(),'toffee-visual-sim-')),'SIMULATION');
    const child = Bun.spawn([process.execPath,'--preload','./tests/visual-calibration-preload.ts','./tests/visual-calibration.ts',
      '/SIMULATED-DEPS','0x00100000','0x26100407','http://127.0.0.1:5174',output],
      {env:{...process.env,TOFFEE_VISUAL_SIMULATION:scenario},stdin:'pipe',stdout:'pipe',stderr:'pipe'});
    let text = '';
    const read = (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of child.stdout) {
        text += decoder.decode(chunk);
        if (text.includes('VIEW IMAGE THEN SUBMIT') && ['bad-reading','bad-frame','no-reading'].includes(scenario)) {
          const request = scenario === 'no-reading' ? {type:'pattern',name:'forbidden',indices:[0],rgb:[255,0,0]} :
            {type:'reading',frame:scenario === 'bad-frame' ? 41:42,currentMa:scenario === 'bad-reading' ? 1000:90,voltage:5.24};
          child.stdin.write(JSON.stringify(request)+'\n'); await child.stdin.flush();
          break;
        }
      }
    })();
    const [code,err] = await Promise.all([child.exited,new Response(child.stderr).text(),read]);
    expect(code).toBe(1); expect(text).toContain('SIMULATION ONLY');
    const rows=(await Bun.file(path.join(output,'events.jsonl')).text()).trim().split('\n').map(JSON.parse);
    expect(rows.some(r=>r.event==='failure')).toBe(true);
    const commands=rows.filter(r=>r.event==='command');
    expect(commands.some(r=>r.code===0x8a)).toBe(false);
    if (['wrong-build','wrong-cap','wrong-profile','stale-output'].includes(scenario))
      expect(commands.some(r=>r.code===0x7c)).toBe(false);
    else expect(commands.at(-1).code).toBe(0x7c);
    if (scenario==='failed-off') expect(err).toContain('All-off unconfirmed');
  },10000);
}

for (const scenario of ['sample-review-dark', 'sample-off-fails']) {
  test(`captured sample is published only after confirmed blackout: ${scenario}`, async () => {
    const output = path.join(await mkdtemp(path.join(os.tmpdir(),'toffee-visual-sim-')),'SIMULATION');
    const child = Bun.spawn([process.execPath,'--preload','./tests/visual-calibration-preload.ts','./tests/visual-calibration.ts',
      '/SIMULATED-DEPS','0x00100000','0x26100407','http://127.0.0.1:5174',output],
      {env:{...process.env,TOFFEE_VISUAL_SIMULATION:scenario},stdin:'pipe',stdout:'pipe',stderr:'pipe'});
    let buffer = '', published = 0;
    const read = (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of child.stdout) {
        buffer += decoder.decode(chunk);
        let end;
        while ((end = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0,end); buffer = buffer.slice(end+1);
          if (!line.startsWith('VIEW IMAGE THEN SUBMIT reading: ')) continue;
          const frame = JSON.parse(line.slice(32)); published++;
          expect(frame.reviewWhileDark).toBe(true);
          if (published === 1) child.stdin.write([
            {type:'reading',frame:frame.frame,currentMa:90,voltage:5.24},
            {type:'pattern',name:'pulse',indices:[0],rgb:[255,0,0],holdMs:5000},
          ].map(JSON.stringify).join('\n')+'\n');
          else child.stdin.write(JSON.stringify({type:'quit'})+'\n');
          await child.stdin.flush();
        }
      }
    })();
    const [code] = await Promise.all([child.exited,new Response(child.stderr).text(),read]);
    const rows = (await Bun.file(path.join(output,'events.jsonl')).text()).trim().split('\n').map(JSON.parse);
    if (scenario === 'sample-review-dark') {
      expect(code).toBe(0); expect(published).toBe(2);
      const blackout = rows.findIndex(r=>r.event==='review-blackout');
      const sample = rows.findIndex(r=>r.event==='frame' && r.name==='pulse');
      expect(blackout).toBeGreaterThan(0); expect(sample).toBeGreaterThan(blackout);
      expect(rows[blackout].sums.groups).toEqual([[0,0,0],[0,0,0],[0,0,0]]);
      expect(rows[sample].sums.groups).toEqual([[255,0,0],[0,0,0],[0,0,0]]);
    } else {
      expect(code).toBe(1); expect(published).toBe(1);
      expect(rows.some(r=>r.event==='review-blackout')).toBe(false);
      expect(rows.some(r=>r.event==='failure')).toBe(true);
    }
  },15000);
}
