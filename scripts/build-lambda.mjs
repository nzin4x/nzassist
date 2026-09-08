// dist/lambda/ 를 만든다. deploy-lambda.ps1 이 이걸 zip으로 묶어 올린다.
//
//   node scripts/build-lambda.mjs
//
// lambda.mjs 를 index.mjs 로 이름만 바꿔 넣고, src/*.js 를 그대로 옆에 둔다.
// 상대경로(`./src/...`)가 그대로 성립하도록 디렉터리 구조를 유지한다.
// npm 의존성이 없다 (D13: googleapis 대신 fetch만 쓴다) — node_modules 복사가 필요 없다.

import { mkdir, rm, cp, readFile, writeFile } from 'node:fs/promises';

const OUT = 'dist/lambda';

await rm(OUT, { recursive: true, force: true });
await mkdir(`${OUT}/src`, { recursive: true });

await writeFile(`${OUT}/index.mjs`, await readFile('lambda.mjs', 'utf8'));
await cp('src', `${OUT}/src`, { recursive: true, filter: src => !src.endsWith('.test.js') });

// package.json이 없으면 Lambda의 Node 런타임이 src/*.js 를 CommonJS로 취급해
// "Named export not found" 로 죽는다 (실측). type:module 만 있으면 되고 의존성은 없다.
await writeFile(`${OUT}/package.json`, JSON.stringify({ type: 'module' }) + '\n');

console.log(`빌드 완료: ${OUT}/`);
console.log('다음: scripts/deploy-lambda.ps1 로 zip + 배포');
