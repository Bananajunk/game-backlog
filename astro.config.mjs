// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // Tailwind CSS v4 is wired in through its first-party Vite plugin.
  // No tailwind.config.js is needed — theme tokens live in src/styles/global.css.
  vite: {
    plugins: [tailwindcss()],
  },
});
