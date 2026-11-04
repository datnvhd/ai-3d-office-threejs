// Builds the Ubuntu .deb (`npm run dist:linux`) in Docker, so it works from Windows too: the sources are copied into a
// Linux container and the dependencies installed there, so native modules (node-pty, esbuild, rollup) are the Linux
// ones. The package lands in release/. Electron and builder downloads are cached in a Docker volume between builds.
import {spawnSync} from 'node:child_process';

const IMAGE='node:22-bookworm';
const steps=[
  'mkdir /build',
  'tar -C /project --exclude=./node_modules --exclude=./release --exclude=./dist --exclude=./.git -cf - . | tar -xf - -C /build',
  'cd /build',
  'npm ci --no-audit --no-fund',
  'npx vite build',
  'npx electron-builder --linux --publish never',
  'mkdir -p /project/release',
  'cp release/*.deb /project/release/',
];
const r=spawnSync('docker',['run','--rm','-v',`${process.cwd()}:/project`,'-v','ai-3d-office-build-cache:/root/.cache',IMAGE,'bash','-ec',steps.join(' && ')],{stdio:'inherit'});
if(r.error)console.error(`Không chạy được Docker: ${r.error.message}`);
process.exit(r.status??1);
