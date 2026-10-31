import { defineConfig } from 'vitest/config'

// base: './' keeps the build portable on GitHub Pages project sites.
// No @vitejs/plugin-react: it is not in the allowed dependency list.
// Vite's esbuild pipeline transpiles TSX on its own; dev uses full reloads.
export default defineConfig({
  base: './',
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
