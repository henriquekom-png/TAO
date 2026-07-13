import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            manifest: {
                name: 'TAO Ambiente de Estudos',
                short_name: 'TAO',
                description: 'Aplicativo de Estudos Híbrido',
                theme_color: '#ffffff',
                icons: [
                    {
                        src: 'icon.svg',
                        sizes: '192x192 512x512',
                        type: 'image/svg+xml',
                        purpose: 'any maskable'
                    }
                ]
            },
            workbox: {
                maximumFileSizeToCacheInBytes: 10485760, // 10 MB
                globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
                // API data caching is handled by Dexie/IndexedDB in each hook (single source of truth).
                // No runtimeCaching here to avoid redundant cache layers and stale-data conflicts.
            },
            devOptions: {
                enabled: true,
                type: 'module'
            }
        })
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
