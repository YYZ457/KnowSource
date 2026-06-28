import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: 'renderer',
  plugins: [
    vue({
      template: {
        compilerOptions: {
          // Electron 特有元素 <webview> 在浏览器开发模式下会被 Vue 视为未知组件并发出警告，
          // 声明为自定义元素后 Vue 不再尝试解析它，避免 "Failed to resolve component: webview" 警告。
          isCustomElement: (tag) => tag === 'webview'
        }
      }
    })
  ],
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./renderer/src', import.meta.url)),
      '@core': fileURLToPath(new URL('./core', import.meta.url)),
      '@services': fileURLToPath(new URL('./services', import.meta.url))
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // 手动分包：将第三方依赖按功能域拆分为独立 chunk，
        // 提升 vendor 缓存命中率 + 并行解析速度 + 懒加载组件按需加载其依赖。
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('/vue/') || id.includes('/@vue/') || id.includes('/pinia/')) {
            return 'vendor-vue';
          }
          if (id.includes('/d3-') || id.includes('/delaunator') || id.includes('/robust-predicates') || id.includes('/internmap')) {
            return 'vendor-d3';
          }
          if (id.includes('/markdown-it') || id.includes('/dompurify') || id.includes('/entities/') || id.includes('/linkify') || id.includes('/mdurl')) {
            return 'vendor-markdown';
          }
          if (id.includes('/splitpanes')) {
            return 'vendor-splitpanes';
          }
          if (id.includes('/pdfjs-dist')) {
            return 'vendor-pdf';
          }
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
});
