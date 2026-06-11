import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const v = process.env.VITE_API_BASE;
  if (mode === 'production' && v && /localhost|127\.0\.0\.1/i.test(String(v))) {
    console.warn(
      '\n[vite] VITE_API_BASE is set to loopback for a production build. Production sites cannot call your PC. Remove VITE_API_BASE from client/.env for same-host deploys, or set it to https://your-api-host/api.\n'
    );
  }
  return {
    envDir: path.resolve(__dirname, '..'),
    plugins: [react()],
    server: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/exceljs')) return 'exceljs';
            if (id.includes('node_modules/jspdf')) return 'jspdf';
            if (id.includes('/CommandCentre.jsx')) return 'command-centre';
          },
        },
      },
    },
  };
});
