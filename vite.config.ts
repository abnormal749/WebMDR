import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// GitHub Pages project site for abnormal749/WebMDR is served under /WebMDR/ (case-sensitive).
// Override with WEBMDR_BASE=/ for a user site or custom domain.
const PAGES_BASE = '/WebMDR/';

// Only same-origin, build-local scripts and styles. No network access is needed:
// the device is reached through Web Serial, not fetch.
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

/** Commit shown in the page footer and diagnostics header, so hardware reports can name the build. */
function buildId(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    return execSync('git status --porcelain', { encoding: 'utf8' }).trim() ? `${sha}+dirty` : sha;
  } catch (error) {
    console.warn(`build id unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return 'unknown';
  }
}

function productionHardening(): Plugin {
  return {
    name: 'webmdr-production',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
    generateBundle() {
      // Required notice for adapted MIT material ships with the deployed site.
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: readFileSync('THIRD_PARTY_NOTICES.txt', 'utf8') });
    },
  };
}

// `vite preview` must serve the same base as the build to test the Pages path locally.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? (process.env.WEBMDR_BASE ?? PAGES_BASE) : '/',
  plugins: [productionHardening()],
  define: { __WEBMDR_BUILD__: JSON.stringify(buildId()) },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Keep /*! notices from adapted source files in the shipped bundle.
    rolldownOptions: { output: { comments: { legal: true } } },
  },
  test: { include: ['test/**/*.test.ts'] },
}));
