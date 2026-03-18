import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  // 不使用 publicDir，通过插件精确控制静态资源复制
  publicDir: false,

  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main:         'index.html',
        moni:         'moni.html',
        moni_content: 'moni_content.html',
      },
    },
    // 静态资源不做 base64 内联
    assetsInlineLimit: 0,
  },

  plugins: [
    viteStaticCopy({
      targets: [
        { src: 'xr-standalone', dest: '.' },
        { src: 'models',        dest: '.' },
        { src: 'image-targets', dest: '.' },
      ],
    }),
  ],

  // 开发服务器需要 COOP/COEP 头（SharedArrayBuffer / XR8 要求）
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
