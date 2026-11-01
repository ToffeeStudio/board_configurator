import {DEBUG_ENABLED, DEBUG_PARAM} from '../config/debug';

// While Debug is on, keep ?debug=1 in the address bar so the URL always shows the mode.
// wouter navigates by path only, and a reload can turn Debug on from the remembered tab setting,
// so both would otherwise leave a URL without the parameter.
export function keepDebugInUrl(): void {
  if (!DEBUG_ENABLED) return;
  const withDebug = (url: string | URL | null | undefined) => {
    if (url === null || url === undefined) return url; // keeps the current URL
    const next = new URL(String(url), window.location.href);
    if (next.origin !== window.location.origin || next.searchParams.has(DEBUG_PARAM)) return url;
    next.searchParams.set(DEBUG_PARAM, '1');
    return next.pathname + next.search + next.hash;
  };
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
      return original.call(this, data, unused, withDebug(url));
    };
  }
  const here = window.location.pathname + window.location.search + window.location.hash;
  if (withDebug(here) !== here) history.replaceState(history.state, '', here);
}
