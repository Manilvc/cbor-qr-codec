import { defineConfig } from 'vite';

// Dev-only playground for trying encode()/decode() in a browser.
// Not part of the published package (see package.json "files").
export default defineConfig({
  root: 'demo',
  server: {
    port: 5173,
  },
});
