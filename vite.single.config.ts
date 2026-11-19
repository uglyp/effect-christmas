import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function inlineSingleHtml(): Plugin {
  return {
    name: 'inline-single-html',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const htmlName = Object.keys(bundle).find((name) => name.endsWith('.html'));
      const htmlAsset = htmlName ? bundle[htmlName] : undefined;
      if (!htmlName || !htmlAsset || htmlAsset.type !== 'asset') return;

      let html = htmlAsset.source.toString();
      const escapeName = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const icon = readFileSync(new URL('./public/vite.svg', import.meta.url));
      html = html.replace(
        /(href=["'])(?:\.\/|\/)?vite\.svg(["'])/g,
        `$1data:image/svg+xml;base64,${icon.toString('base64')}$2`,
      );

      for (const name of Object.keys(bundle)) {
        if (!/\.(svg|png|jpe?g|webp|gif|ico)$/i.test(name)) continue;
        const file = bundle[name];
        if (file.type !== 'asset') continue;
        const bytes = typeof file.source === 'string' ? Buffer.from(file.source) : Buffer.from(file.source);
        const mime = name.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
        const data = `data:${mime};base64,${bytes.toString('base64')}`;
        html = html.replace(
          new RegExp(`(href=["'])[^"']*${escapeName(name)}(["'])`),
          `$1${data}$2`,
        );
        delete bundle[name];
      }

      for (const name of Object.keys(bundle)) {
        if (!name.endsWith('.css')) continue;
        const file = bundle[name];
        if (file.type !== 'asset') continue;
        html = html.replace(
          new RegExp(`<link[^>]*href=["'][^"']*${escapeName(name)}["'][^>]*>`),
          () => `<style>${file.source.toString()}</style>`,
        );
        delete bundle[name];
      }

      for (const name of Object.keys(bundle)) {
        if (!name.endsWith('.js')) continue;
        const file = bundle[name];
        if (file.type !== 'chunk') continue;
        const code = file.code.replace(/<\/script/gi, '<\\/script');
        const pattern = escapeName(name);
        html = html.replace(
          new RegExp(`<script\\b[^>]*src=["'][^"']*${pattern}["'][^>]*>\\s*</script>`),
          () => `<script type="module">${code}</script>`,
        );
        html = html.replace(new RegExp(`<link[^>]*href=["'][^"']*${pattern}["'][^>]*>`, 'g'), '');
        delete bundle[name];
      }

      htmlAsset.fileName = 'christmas-tree.html';
      htmlAsset.source = html;
      if (htmlName !== htmlAsset.fileName) {
        bundle[htmlAsset.fileName] = htmlAsset;
        delete bundle[htmlName];
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), inlineSingleHtml()],
  base: './',
  publicDir: false,
  build: {
    outDir: 'standalone',
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 20000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
