import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Rapier ships its physics engine as WASM inlined in the JS bundle (~4 MB).
    chunkSizeWarningLimit: 6000,
  },
});
