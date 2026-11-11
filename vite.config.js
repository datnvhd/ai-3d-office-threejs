import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {claudeBridge} from './server/claude-bridge.js';
import {machineBridge} from './server/machine-bridge.js';
import {codexBridge} from './server/codex-bridge.js';
import {googleBridge} from './server/google-bridge.js';

const page=p=>fileURLToPath(new URL(p,import.meta.url));
// Two pages: the 3D office (index.html) and the light phone page without the 3D scene (m.html)
export default defineConfig({plugins:[claudeBridge(),codexBridge(),googleBridge(),machineBridge()],build:{target:'es2022',rollupOptions:{input:{main:page('./index.html'),m:page('./m.html')}}}});
