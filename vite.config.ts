import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { supabaseProxy } from './server/supabaseProxy.ts';

export default defineConfig({
  plugins: [react(), supabaseProxy()],
});
