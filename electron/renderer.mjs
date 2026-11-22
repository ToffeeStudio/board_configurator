import {stat} from 'node:fs/promises';
import {isAbsolute, relative, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const appUrl = 'toffee://app';

export function isAppPage(value) {
  if (!value) return false;
  const url = new URL(value);
  return url.protocol === 'toffee:' && url.host === 'app' && !url.username && !url.password;
}

export function isInstallerPage(value) {
  if (!isAppPage(value)) return false;
  const {pathname} = new URL(value);
  return pathname === '/toffee-firmware' || pathname === '/toffee-firmware/';
}

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

export async function serveRenderer(request, root, fetchFile) {
  if (!isAppPage(request.url) || request.method !== 'GET') {
    return new Response(null, {status: 403});
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response(null, {status: 400});
  }
  const file = resolve(root, '.' + pathname);
  const path = relative(root, file);
  if (path.startsWith('..') || isAbsolute(path) || pathname.includes('\\') || pathname.includes('\0')) {
    return new Response(null, {status: 403});
  }
  const info = await stat(file, {throwIfNoEntry: false}).catch(error => {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  });
  if (!info) return new Response(null, {status: 404});
  const response = await fetchFile(pathToFileURL(info.isDirectory() ? resolve(file, 'index.html') : file).href)
    .catch(() => new Response(null, {status: 404}));
  const headers = new Headers(response.headers);
  // The legacy VIA reader compiles definition validators with new Function.
  // Keep that allowance on the local configurator pages only.
  const installerPage = isInstallerPage(request.url);
  headers.set('Content-Security-Policy', installerPage ? csp : csp.replace(
    "script-src 'self'", "script-src 'self' 'unsafe-eval'",
  ));
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, {status: response.status, headers});
}
