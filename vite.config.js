import {defineConfig} from 'vite';
import {claudeBridge} from './server/claude-bridge.js';
import {machineBridge} from './server/machine-bridge.js';

export default defineConfig({plugins:[claudeBridge(),machineBridge()]});
