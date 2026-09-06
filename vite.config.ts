import { defineConfig } from 'vite';
export default defineConfig({
  server:{proxy:{'/api':{target:'http://127.0.0.1:8787',ws:true}}},
  build:{rollupOptions:{output:{manualChunks:{three:['three'],icons:['lucide']}}}}
});
