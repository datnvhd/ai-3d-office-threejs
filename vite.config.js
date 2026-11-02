import {defineConfig} from 'vite';
import {claudeBridge} from './server/claude-bridge.js';

export default defineConfig({plugins:[claudeBridge()]});
