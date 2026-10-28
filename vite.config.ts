import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { supabaseProxy } from './server/supabaseProxy.ts';

export default defineConfig({
  // Relative asset paths, so the build works under any GitHub Pages repo path
  base: './',
  plugins: [react(), supabaseProxy()],
});
