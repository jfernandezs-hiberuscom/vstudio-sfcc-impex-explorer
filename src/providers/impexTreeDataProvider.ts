import * as vscode from "vscode";
import * as path from "path";
import { ConfigManager } from "../config/configManager";
import { WebdavClient } from "../webdav/webdavClient";
import { WebdavItem } from "../config/types";

export class ImpexTreeItem extends vscode.TreeItem {
  constructor(
    public readonly item: WebdavItem,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(item.displayName, collapsibleState);

    this.tooltip = `${item.path} (${item.isDirectory ? "Carpeta" : this.formatBytes(item.size)})`;
    this.contextValue = item.isDirectory ? "impex-directory" : "impex-file";

    if (item.isDirectory) {
      this.iconPath = new vscode.ThemeIcon("folder");
    } else {
      this.iconPath = this.getFileIcon(item.displayName);
      this.description = this.formatBytes(item.size);

      this.command = {
        command: "sfcc-impex.openFile",
        title: "Abrir archivo",
        arguments: [this]
      };
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  private getFileIcon(filename: string): vscode.ThemeIcon {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
      case ".xml":
        return new vscode.ThemeIcon("file-code");
      case ".csv":
        return new vscode.ThemeIcon("table");
      case ".zip":
      case ".gz":
      case ".tar":
        return new vscode.ThemeIcon("file-zip");
      case ".log":
      case ".txt":
        return new vscode.ThemeIcon("output");
      case ".json":
        return new vscode.ThemeIcon("json");
      default:
        return new vscode.ThemeIcon("file");
    }
  }
}

export class ImpexTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;

  private client: WebdavClient | null = null;

  constructor(private configManager: ConfigManager) {
    this.updateClient();
    this.configManager.onDidChangeConfig(() => {
      this.updateClient();
      this.refresh();
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

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const config = this.configManager.getCurrentConfig();

    // 1. Si no hay configuración detectada, mostrar nodo informativo interactivo
    if (!config || !this.client) {
      const errorMsg = this.configManager.getLastError() || "No se detectó dw.json ni webdav.json";
      const configItem = new vscode.TreeItem("⚠️ Configuración SFCC no encontrada", vscode.TreeItemCollapsibleState.None);
      configItem.description = "Haz clic para seleccionar dw.json";
      configItem.tooltip = `${errorMsg}\nHaz clic para buscar tu archivo dw.json manualmente.`;
      configItem.iconPath = new vscode.ThemeIcon("warning");
      configItem.command = {
        command: "sfcc-impex.selectConfigFile",
        title: "Seleccionar archivo dw.json"
      };
      return [configItem];
    }

    // 2. Si estamos dentro de un ImpexTreeItem
    if (element instanceof ImpexTreeItem) {
      if (!element.item.isDirectory) {
        return [];
      }
      try {
        const items = await this.client.propfind(element.item.path, "1");
        if (items.length === 0) {
          const emptyItem = new vscode.TreeItem("(Carpeta vacía)", vscode.TreeItemCollapsibleState.None);
          emptyItem.iconPath = new vscode.ThemeIcon("circle-slash");
          return [emptyItem];
        }
        return items.map((item) => {
          const state = item.isDirectory
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;
          return new ImpexTreeItem(item, state);
        });
      } catch (err: any) {
        const errorItem = new vscode.TreeItem("❌ Error al listar carpeta", vscode.TreeItemCollapsibleState.None);
        errorItem.description = err.message || String(err);
        errorItem.tooltip = `Error: ${err.message}\nHaz clic para reintentar.`;
        errorItem.iconPath = new vscode.ThemeIcon("error");
        errorItem.command = { command: "sfcc-impex.refresh", title: "Reintentar" };
        return [errorItem];
      }
    }

    // 3. Nivel raíz
    try {
      const targetPath = config.root || "/on/demandware.servlet/webdav/Sites/Impex";
      const items = await this.client.propfind(targetPath, "1");
      if (items.length === 0) {
        const emptyItem = new vscode.TreeItem("(Directorio raíz vacío)", vscode.TreeItemCollapsibleState.None);
        emptyItem.iconPath = new vscode.ThemeIcon("circle-slash");
        return [emptyItem];
      }
      return items.map((item) => {
        const state = item.isDirectory
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;
        return new ImpexTreeItem(item, state);
      });
    } catch (err: any) {
      const errorItem = new vscode.TreeItem("❌ Error de conexión con la sandbox", vscode.TreeItemCollapsibleState.None);
      errorItem.description = err.message || String(err);
      errorItem.tooltip = `Error: ${err.message}\nServidor: ${config.hostname}\nUsuario: ${config.username}\nHaz clic para reintentar.`;
      errorItem.iconPath = new vscode.ThemeIcon("error");
      errorItem.command = { command: "sfcc-impex.refresh", title: "Reintentar" };
      return [errorItem];
    }
  }
}
