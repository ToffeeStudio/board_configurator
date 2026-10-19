import {expect, test} from 'bun:test';
import {firmwarePageEntry} from '../scripts/firmware-page-entry';
test('static firmware entry reuses the built HTML and absolute asset links', () => {
  const emitted: any[] = [], source = '<html><script src="/assets/index.js"></script></html>';
  (firmwarePageEntry().generateBundle as Function).call({emitFile: (file: any) => emitted.push(file)}, {}, {
    'index.html': {type: 'asset', source},
  });
  expect(emitted).toEqual([{type: 'asset', fileName: 'toffee-firmware/index.html', source}]);
});
test('missing built HTML fails rather than emitting an unusable firmware entry', () => {
  expect(() => (firmwarePageEntry().generateBundle as Function).call({emitFile() {throw new Error('Forbidden');}}, {}, {})).toThrow('index.html');
});
