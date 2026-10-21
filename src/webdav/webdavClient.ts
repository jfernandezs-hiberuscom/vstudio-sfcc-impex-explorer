import * as https from 'https';
import { DwConfig, WebdavItem } from '../config/types';

export class WebdavClient {
  private config: DwConfig;

  constructor(config: DwConfig) {
    this.config = config;
  }

  private getAuthHeader(): string {
    const username = this.config.username || '';
    const password = this.config.password || '';
    const base64 = Buffer.from(`${username}:${password}`).toString('base64');
    return `Basic ${base64}`;
  }

  private normalizePath(p: string): string {
    let clean = p.startsWith('/') ? p : `/${p}`;
    // Limpiar barras duplicadas
    clean = clean.replace(/\/+/g, '/');
    return clean;
  }

  public async propfind(remotePath: string, depth: '0' | '1' = '1'): Promise<WebdavItem[]> {
    const normalized = this.normalizePath(remotePath);
    const xml = await this.request('PROPFIND', normalized, {
      Depth: depth,
      'Content-Type': 'application/xml; charset=utf-8'
    });

    return this.parseMultiStatus(xml, normalized);
  }

  public async get(remotePath: string): Promise<Buffer> {
    const normalized = this.normalizePath(remotePath);
    return this.requestBuffer('GET', normalized);
  }

  public async put(remotePath: string, content: Buffer | Uint8Array | string): Promise<void> {
    const normalized = this.normalizePath(remotePath);
    const buffer = Buffer.isBuffer(content)
      ? content
      : typeof content === 'string'
      ? Buffer.from(content, 'utf-8')
      : Buffer.from(content);

    await this.request('PUT', normalized, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': buffer.length.toString()
    }, buffer);
  }

  public async delete(remotePath: string): Promise<void> {
    const normalized = this.normalizePath(remotePath);
    await this.request('DELETE', normalized);
  }

  public async mkcol(remotePath: string): Promise<void> {
    let normalized = this.normalizePath(remotePath);
    if (!normalized.endsWith('/')) {
      normalized += '/';
    }
    await this.request('MKCOL', normalized);
  }

  public async move(sourcePath: string, destPath: string, overwrite = true): Promise<void> {
    const normalizedSource = this.normalizePath(sourcePath);
    const normalizedDest = this.normalizePath(destPath);
    const destinationUrl = `https://${this.config.hostname}${normalizedDest}`;

    await this.request('MOVE', normalizedSource, {
      Destination: destinationUrl,
      Overwrite: overwrite ? 'T' : 'F'
    });
  }

  private request(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: Buffer
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: this.config.hostname,
        port: 443,
        path: encodeURI(path),
        method,
        headers: {
          Authorization: this.getAuthHeader(),
          'User-Agent': 'VSCode-SFCC-Impex-Explorer/1.0',
          ...headers
        },
        timeout: 30000,
        rejectUnauthorized: false
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const resBody = Buffer.concat(chunks).toString('utf-8');
          const status = res.statusCode || 0;

          if (status >= 200 && status < 300) {
            resolve(resBody);
          } else {
            reject(new Error(`WebDAV Error [${method} ${path}]: HTTP ${status} ${res.statusMessage || ''}\n${resBody}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Timeout en petición WebDAV [${method} ${path}]`));
      });

      req.on('error', (err) => reject(err));

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  private requestBuffer(
    method: string,
    path: string,
    headers: Record<string, string> = {}
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: this.config.hostname,
        port: 443,
        path: encodeURI(path),
        method,
        headers: {
          Authorization: this.getAuthHeader(),
          'User-Agent': 'VSCode-SFCC-Impex-Explorer/1.0',
          ...headers
        },
        timeout: 60000,
        rejectUnauthorized: false
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const status = res.statusCode || 0;
          if (status >= 200 && status < 300) {
            resolve(Buffer.concat(chunks));
          } else {
            const errorMsg = Buffer.concat(chunks).toString('utf-8');
            reject(new Error(`WebDAV Error [${method} ${path}]: HTTP ${status}\n${errorMsg}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Timeout al descargar archivo WebDAV [${path}]`));
      });

      req.on('error', (err) => reject(err));
      req.end();
    });
  }

  private parseMultiStatus(xml: string, targetPath: string): WebdavItem[] {
    const items: WebdavItem[] = [];
    const responseRegex = /<(?:\w+:)?response\b[^>]*>([\s\S]*?)<\/(?:\w+:)?response>/gi;
    let match: RegExpExecArray | null;

    const normalizedTarget = targetPath.endsWith('/') ? targetPath.slice(0, -1) : targetPath;

    while ((match = responseRegex.exec(xml)) !== null) {
      const block = match[1];

      // Extraer href
      const hrefMatch = /<(?:\w+:)?href\b[^>]*>([^<]+)<\/(?:\w+:)?href>/i.exec(block);
      if (!hrefMatch) continue;

      let href = decodeURIComponent(hrefMatch[1].trim());
      // Remover posible prefijo http/https y hostname
      if (href.startsWith('http://') || href.startsWith('https://')) {
        const url = new URL(href);
        href = url.pathname;
      }

      const cleanHref = href.endsWith('/') ? href.slice(0, -1) : href;

            // Si es el mismo directorio consultado, SIEMPRE ignorarlo (la raíz devuelta por WebDAV)
      if (cleanHref.toLowerCase() === normalizedTarget.toLowerCase()) {
        continue;
      }

      // Comprobar si es colección (directorio)
      const isDirectory = /<(?:\w+:)?collection\s*\/?\s*>/i.test(block);

      // Extraer tamaño
      let size = 0;
      const sizeMatch = /<(?:\w+:)?getcontentlength\b[^>]*>([^<]+)<\/(?:\w+:)?getcontentlength>/i.exec(block);
      if (sizeMatch) {
        size = parseInt(sizeMatch[1].trim(), 10) || 0;
      }

      // Extraer fecha de modificación
      let modifiedTime = Date.now();
      const modMatch = /<(?:\w+:)?getlastmodified\b[^>]*>([^<]+)<\/(?:\w+:)?getlastmodified>/i.exec(block);
      if (modMatch) {
        const parsedDate = Date.parse(modMatch[1].trim());
        if (!isNaN(parsedDate)) {
          modifiedTime = parsedDate;
        }
      }

      // Nombre a mostrar
      let displayName = '';
      const displayMatch = /<(?:\w+:)?displayname\b[^>]*>([^<]+)<\/(?:\w+:)?displayname>/i.exec(block);
      if (displayMatch && displayMatch[1].trim()) {
        displayName = displayMatch[1].trim();
      } else {
        const segments = cleanHref.split('/');
        displayName = segments[segments.length - 1] || cleanHref;
      }

      // Extraer etag
      let etag: string | undefined;
      const etagMatch = /<(?:\w+:)?getetag\b[^>]*>([^<]+)<\/(?:\w+:)?getetag>/i.exec(block);
      if (etagMatch) {
        etag = etagMatch[1].trim();
      }

      items.push({
        href,
        path: cleanHref,
        displayName,
        isDirectory,
        size,
        modifiedTime,
        etag
      });
    }

    // Ordenar: primero carpetas alfabéticamente, luego archivos alfabéticamente
    return items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  }
}
