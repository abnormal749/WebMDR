import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// GitHub Pages project site for abnormal749/WebMDR is served under /WebMDR/ (case-sensitive).
// Override with WEBMDR_BASE=/ for a user site or custom domain.
const PAGES_BASE = '/WebMDR/';

// Optional visit counter for the owner's deployment only: set WEBMDR_GOATCOUNTER to a
// GoatCounter count endpoint (e.g. https://NAME.goatcounter.com/count). The page requests
// it as an image (src/ui/main.ts), so no third-party script runs. Unset (local builds,
// forks), nothing is added.
const COUNTER = counterEndpoint(process.env.WEBMDR_GOATCOUNTER);

function counterEndpoint(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.search || url.hash) {
    throw new Error(`WEBMDR_GOATCOUNTER must be an https URL without query or fragment: ${value}`);
  }
  return url;
}

// Only same-origin, build-local scripts and styles. No network access is needed:
// the device is reached through Web Serial, not fetch.
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  COUNTER ? `img-src 'self' ${COUNTER.origin}` : "img-src 'self'",
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
      ...(COUNTER ? [{ tag: 'meta', attrs: { name: 'webmdr-counter', content: COUNTER.href }, injectTo: 'head' as const }] : []),
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
