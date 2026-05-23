const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

function buildDefinitions() {
  const args = process.argv.slice(2);
  const shouldForceBuild = args.includes('--fresh') || args.includes('-f');

  if (!shouldForceBuild && fs.existsSync('./public/definitions/hash.json')) {
    return;
  }

  console.log('Definitions re-building...');

  const cliPath = path.join(
    path.dirname(require.resolve('via-keyboards/package.json')),
    'bin',
    'cli.js',
  );
  const result = spawnSync(process.execPath, [cliPath, 'public/definitions'], {
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

buildDefinitions();
