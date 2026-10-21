import * as vscode from 'vscode';
import { ConfigManager } from '../config/configManager';
import { WebdavClient } from '../webdav/webdavClient';

export class ImpexFileSystemProvider implements vscode.FileSystemProvider {
  public static readonly SCHEME = 'sfcc-impex';

  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

  private client: WebdavClient | null = null;

  constructor(private configManager: ConfigManager) {
    this.updateClient();
    this.configManager.onDidChangeConfig(() => {
      this.updateClient();
    });
  }

  private updateClient() {
    const config = this.configManager.getCurrentConfig();
    if (config) {
      this.client = new WebdavClient(config);
    } else {
      this.client = null;
    }
  }

  private getClient(): WebdavClient {
    if (!this.client) {
      this.updateClient();
      if (!this.client) {
        throw vscode.FileSystemError.Unavailable('No se ha detectado configuración válida en dw.json o webdav.json');
      }
    }
    return this.client;
  }

  public getUriForPath(remotePath: string): vscode.Uri {
    const config = this.configManager.getCurrentConfig();
    const hostname = config ? config.hostname : 'sfcc';
    return vscode.Uri.parse(`${ImpexFileSystemProvider.SCHEME}://${hostname}${remotePath}`);
  }

  watch(_uri: vscode.Uri): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const client = this.getClient();
    const remotePath = uri.path;

    try {
      const items = await client.propfind(remotePath, '0');
      if (items.length === 0) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      const item = items[0];
      return {
        type: item.isDirectory ? vscode.FileType.Directory : vscode.FileType.File,
        ctime: item.modifiedTime,
        mtime: item.modifiedTime,
        size: item.size
      };
    } catch (err: any) {
      if (err.message && err.message.includes('HTTP 404')) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      throw vscode.FileSystemError.Unavailable(err.message || String(err));
    }
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const client = this.getClient();
    const remotePath = uri.path;

    try {
      const items = await client.propfind(remotePath, '1');
      return items.map((item) => [
        item.displayName,
        item.isDirectory ? vscode.FileType.Directory : vscode.FileType.File
      ]);
    } catch (err: any) {
      throw vscode.FileSystemError.Unavailable(err.message || String(err));
    }
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    const client = this.getClient();
    const remotePath = uri.path;

    try {
      await client.mkcol(remotePath);
      this._emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
    } catch (err: any) {
      throw vscode.FileSystemError.Unavailable(`Error creando carpeta remota: ${err.message}`);
    }
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const client = this.getClient();
    const remotePath = uri.path;

    try {
      const buffer = await client.get(remotePath);
      return new Uint8Array(buffer);
    } catch (err: any) {
      throw vscode.FileSystemError.Unavailable(`Error leyendo archivo remoto: ${err.message}`);
    }
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const client = this.getClient();
    const remotePath = uri.path;

    try {
      await client.put(remotePath, Buffer.from(content));
      vscode.window.setStatusBarMessage(`$(check) Guardado en SFCC Sandbox WebDAV: ${remotePath}`, 4000);
      this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error guardando en WebDAV SFCC [${remotePath}]: ${err.message}`);
      throw vscode.FileSystemError.Unavailable(`Error guardando en WebDAV SFCC: ${err.message}`);
    }
  }

  async delete(uri: vscode.Uri, _options: { recursive: boolean }): Promise<void> {
    const client = this.getClient();
    const remotePath = uri.path;

    try {
      await client.delete(remotePath);
      this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
    } catch (err: any) {
      throw vscode.FileSystemError.Unavailable(`Error eliminando elemento remoto: ${err.message}`);
    }
  }

  async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
    const client = this.getClient();
    const oldPath = oldUri.path;
    const newPath = newUri.path;

    try {
      await client.move(oldPath, newPath, options.overwrite);
      this._emitter.fire([
        { type: vscode.FileChangeType.Deleted, uri: oldUri },
        { type: vscode.FileChangeType.Created, uri: newUri }
      ]);
    } catch (err: any) {
      throw vscode.FileSystemError.Unavailable(`Error renombrando elemento remoto: ${err.message}`);
    }
  }
}
