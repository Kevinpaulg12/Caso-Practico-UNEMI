import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Si los estáticos se sirven desde una CDN, su URL se indica al compilar: VITE_CDN_URL=https://cdn.ejemplo.com/
  base: process.env.VITE_CDN_URL || '/',
  build: {
    rollupOptions: {
      output: {
        // Las librerías cambian mucho menos que el código propio: en archivos aparte, el navegador
        // las conserva en caché entre despliegues. D3 solo se descarga en las pantallas con gráficas.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](d3|d3-[^\\/]+|internmap|delaunator|robust-predicates)[\\/]/.test(id)) return 'charts';
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react';
          return 'vendor';
        },
      },
    },
  },
  server: {
    host: true, // Esto es equivalente a '0.0.0.0', crucial para Docker
    port: 5173,
    watch: {
      usePolling: true // Necesario en Windows para detectar cambios a través de Docker Volumes
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    restoreMocks: true,
  },
})
