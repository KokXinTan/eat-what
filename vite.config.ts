import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// BASE_PATH lets the same build work at a domain root ("/") or under a
// GitHub Pages repository path ("/<repo>/"). `npm run build:pages` uses /eat-what/.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  plugins: [preact()],
  build: { target: 'es2020', cssCodeSplit: false },
});
