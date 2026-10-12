/**
 * MoneyMart — static asset hosting for the unified deployment.
 *
 * The platform ships as ONE origin: this gateway serves the built web SPA (and
 * optionally the TV bundle) alongside `/api` and `/socket.io`. That removes the
 * CORS surface, needs a single TLS certificate, and means a deep link like
 * /auctions/auc_rolex resolves on a hard refresh from the same host that serves
 * the API it calls.
 */
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface StaticHostOptions {
  /** Directory containing the built web app (index.html + assets). */
  webDir?: string;
  /** Optional built TV bundle, mounted under /tv. */
  tvDir?: string;
  /** Serve HSTS. Only meaningful behind TLS. */
  secure?: boolean;
}

/** Security headers applied to every response. */
function securityHeaders(secure: boolean) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(self), camera=(self)');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (secure) {
      // Two years, subdomains included — standard hardening once TLS is real.
      res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }

    /**
     * CSP is intentional and explicit rather than permissive:
     *  • fonts come from Fontshare plus the bundled @fontsource files
     *  • artwork and the TV QR code are data: URIs
     *  • connect-src allows same-origin REST + WebSocket
     *  • 'unsafe-inline' is limited to styles (Vite injects a style block)
     */
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://api.fontshare.com",
        "font-src 'self' data: https://api.fontshare.com https://cdn.fontshare.com",
        "img-src 'self' data: blob:",
        "media-src 'self' blob: https:",
        "connect-src 'self' ws: wss:",
        "form-action 'self'",
        "upgrade-insecure-requests",
      ].join('; '),
    );
    next();
  };
}

/**
 * Cache policy.
 *
 * Vite emits content-hashed filenames, so hashed assets are immutable and may be
 * cached for a year. HTML documents must never be cached, or a deploy leaves a
 * stale shell pointing at asset hashes that no longer exist.
 *
 * Applied per-file by express.static rather than by a preceding middleware, so
 * `no-cache` cannot leak onto hashed assets.
 */
function assetCacheHeaders(res: Response, filePath: string): void {
  const name = path.basename(filePath);
  /**
   * Vite emits `name-<contentHash>.ext`, i.e. the hash is separated by a HYPHEN
   * and sits immediately before the extension. Testing for a dot-delimited hash
   * never matches and silently downgrades every asset to no-cache, so the
   * predicate is expressed as "the stem ends with -<8+ hash chars>".
   */
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const hasHash = /-[0-9a-zA-Z_-]{8,}$/.test(stem);
  if (hasHash) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (/\.(svg|png|jpg|jpeg|webp|ico|woff2?|ttf)$/.test(name)) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
  } else {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  }
}

export function mountStaticHost(app: Express, options: StaticHostOptions): { mounted: string[] } {
  const mounted: string[] = [];
  const { webDir, tvDir, secure = false } = options;

  app.use(securityHeaders(secure));

  /**
   * Unmatched API and WebSocket paths must remain API errors.
   *
   * Declared BEFORE the SPA fallback so a typo'd endpoint returns JSON with a 404
   * instead of quietly receiving the HTML shell — which would look like a
   * successful response to any client that does not check content type.
   */
  app.use(['/api', '/api/*', '/socket.io', '/socket.io/*'], (req: Request, res: Response) => {
    res.status(404).json({
      error: 'not_found',
      detail: `No API route matches ${req.method} ${req.path}`,
    });
  });

  // The TV bundle, when present, lives under /tv.
  if (tvDir && existsSync(path.join(tvDir, 'index.html'))) {
    app.use(
      '/tv',
      express.static(tvDir, {
        index: false,
        fallthrough: true,
        setHeaders: (res, filePath) => assetCacheHeaders(res, filePath),
      }),
    );
    app.get('/tv', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      res.sendFile(path.join(tvDir, 'index.html'));
    });
    app.get('/tv/*', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      res.sendFile(path.join(tvDir, 'index.html'));
    });
    mounted.push(`/tv → ${tvDir}`);
  }

  if (webDir && existsSync(path.join(webDir, 'index.html'))) {
    app.use(
      express.static(webDir, {
        index: false,
        fallthrough: true,
        setHeaders: (res, filePath) => assetCacheHeaders(res, filePath),
      }),
    );

    const indexFile = path.join(webDir, 'index.html');
    const indexHtml = readFileSync(indexFile);

    // SPA fallback — API and WebSocket prefixes were already handled above.
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/tv')) {
        next();
        return;
      }

      /**
       * A missing asset must not be answered with the HTML shell. Serving 200
       * text/html for a stale /assets/*.js reference turns a deploy mistake into
       * a silent blank page; a 404 makes it visible immediately.
       */
      if (req.path.startsWith('/assets/') || /\.[a-z0-9]{2,5}$/i.test(req.path)) {
        res.status(404).json({ error: 'asset_not_found', detail: req.path });
        return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      res.status(200).send(indexHtml);
    });
    mounted.push(`/ → ${webDir}`);
  }

  return { mounted };
}

export default mountStaticHost;
