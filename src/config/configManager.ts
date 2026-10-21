import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { DwConfig } from "./types";

export class ConfigManager {
  private currentConfig: DwConfig | null = null;
  private currentRoot: string = "/on/demandware.servlet/webdav/Sites/Impex";
  private manualConfigPath: string | null = null;
  private lastErrorMessage: string | null = null;

  private onDidChangeConfigEmitter = new vscode.EventEmitter<DwConfig | null>();
  public readonly onDidChangeConfig = this.onDidChangeConfigEmitter.event;
  private watchers: vscode.FileSystemWatcher[] = [];

  constructor() {
    this.setupWatchers();
    this.reloadConfig();
  }

  public getCurrentConfig(): DwConfig | null {
    if (!this.currentConfig) {
      return null;
    }
    return {
      ...this.currentConfig,
      root: this.currentRoot
    };
  }

  public getLastError(): string | null {
    return this.lastErrorMessage;
  }

  public getCurrentRoot(): string {
    return this.currentRoot;
  }

  public setCustomRoot(root: string) {
    this.currentRoot = root.endsWith("/") ? root.slice(0, -1) : root;
    this.onDidChangeConfigEmitter.fire(this.getCurrentConfig());
  }

  public setManualConfigFile(filePath: string): DwConfig | null {
    this.manualConfigPath = filePath;
    return this.reloadConfig();
  }

  public reloadConfig(): DwConfig | null {
    this.lastErrorMessage = null;
    const config = this.findAndLoadConfig();
    this.currentConfig = config;
    if (config && config.root) {
      this.currentRoot = config.root.endsWith("/") ? config.root.slice(0, -1) : config.root;
    }
    this.onDidChangeConfigEmitter.fire(this.getCurrentConfig());
    return this.currentConfig;
  }

  private findAndLoadConfig(): DwConfig | null {
    // 1. Si el usuario seleccionó un archivo manualmente
    if (this.manualConfigPath && fs.existsSync(this.manualConfigPath)) {
      const manual = this.readConfigFile(this.manualConfigPath);
      if (manual) return manual;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const candidateFiles = ["webdav.json", "dw.json"];

    if (workspaceFolders && workspaceFolders.length > 0) {
      // 2. Buscar en la raíz de cada carpeta del workspace
      for (const folder of workspaceFolders) {
        const folderPath = folder.uri.fsPath;
        for (const fileName of candidateFiles) {
          const filePath = path.join(folderPath, fileName);
          if (fs.existsSync(filePath)) {
            const loaded = this.readConfigFile(filePath);
            if (loaded) return loaded;
          }
        }
      }

      // 3. Buscar de forma recursiva hasta 4 niveles en el workspace
      for (const folder of workspaceFolders) {
        const foundPath = this.searchRecursively(folder.uri.fsPath, candidateFiles, 0, 4);
        if (foundPath) {
          const loaded = this.readConfigFile(foundPath);
          if (loaded) return loaded;
        }
      }
    }

    // 4. Buscar en el directorio home del usuario (~/.dw.json o ~/dw.json)
    const homeDir = os.homedir();
    for (const fileName of [".dw.json", "dw.json", ".webdav.json", "webdav.json"]) {
      const homePath = path.join(homeDir, fileName);
      if (fs.existsSync(homePath)) {
        const loaded = this.readConfigFile(homePath);
        if (loaded) return loaded;
      }
    }

    this.lastErrorMessage = "No se encontró ningún archivo dw.json o webdav.json en el workspace ni en la carpeta de usuario.";
    return null;
  }

  private searchRecursively(dir: string, fileNames: string[], depth: number, maxDepth: number): string | null {
    if (depth > maxDepth) return null;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const name = entry.name;
        if (name === "node_modules" || name === ".git" || name === "dist" || name === "build" || name === ".vscode") {
          continue;
        }
        const fullPath = path.join(dir, name);
        if (entry.isFile() && fileNames.includes(name)) {
          return fullPath;
        }
        if (entry.isDirectory()) {
          const found = this.searchRecursively(fullPath, fileNames, depth + 1, maxDepth);
          if (found) return found;
        }
      }
    } catch (e) {}
    return null;
  }

  private readConfigFile(filePath: string): DwConfig | null {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content);

      // Limpiar y normalizar hostname (eliminar https://, http:// y barras)
      let hostname = (parsed.hostname || parsed.host || "").trim();
      hostname = hostname.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");

      // Soporte flexible para nombres de campo
      const username = (parsed.username || parsed.user || parsed["user-name"] || "").trim();
      const password = parsed.password || parsed.pass || "";

      if (!hostname) {
        this.lastErrorMessage = "El archivo " + path.basename(filePath) + " no contiene campo hostname válido.";
        return null;
      }

      if (!username) {
        this.lastErrorMessage = "El archivo " + path.basename(filePath) + " no contiene campo username / user.";
        return null;
      }

      return {
        ...parsed,
        hostname,
        username,
        password,
        configPath: filePath,
        root: parsed.root || "/on/demandware.servlet/webdav/Sites/Impex"
      };
    } catch (err: any) {
      this.lastErrorMessage = "Error leyendo " + filePath + ": " + err.message;
      return null;
    }
  }

  private setupWatchers() {
    try {
      const dwWatcher = vscode.workspace.createFileSystemWatcher("**/dw.json");
      const webdavWatcher = vscode.workspace.createFileSystemWatcher("**/webdav.json");

      const onFileChange = () => {
        vscode.window.showInformationMessage("SFCC Impex: Se detectó cambio en configuración dw.json/webdav.json. Recargando...");
        this.reloadConfig();
      };

      dwWatcher.onDidChange(onFileChange);
      dwWatcher.onDidCreate(onFileChange);
      dwWatcher.onDidDelete(onFileChange);

      webdavWatcher.onDidChange(onFileChange);
      webdavWatcher.onDidCreate(onFileChange);
      webdavWatcher.onDidDelete(onFileChange);

      this.watchers.push(dwWatcher, webdavWatcher);
    } catch (e) {
      console.error("Error setting up file watchers:", e);
    }
  }

  public dispose() {
    this.watchers.forEach(w => w.dispose());
    this.onDidChangeConfigEmitter.dispose();
  }
}
