import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sdkPath = resolve('node_modules/@openai/codex-sdk/dist/index.js');
const source = readFileSync(sdkPath, 'utf8');

const spawnBlock = /const child = spawn\(this\.executablePath, commandArgs, \{\s*env,\s*signal: args\.signal,?\s*\}\);/;
const hiddenSpawnBlock = /const child = spawn\(this\.executablePath, commandArgs, \{[^}]*windowsHide:\s*true[^}]*\}\);/;

if (hiddenSpawnBlock.test(source)) {
  console.log('Codex SDK Windows process hiding already applied.');
} else if (spawnBlock.test(source)) {
  writeFileSync(sdkPath, source.replace(spawnBlock, `const child = spawn(this.executablePath, commandArgs, {
      env,
      signal: args.signal,
      windowsHide: true,
    });`), 'utf8');
  console.log('Patched Codex SDK to hide spawned Windows console windows.');
} else {
  throw new Error(
    'Unable to patch @openai/codex-sdk: expected spawn block was not found. '
    + 'Review the installed SDK before updating the patch.',
  );
}
