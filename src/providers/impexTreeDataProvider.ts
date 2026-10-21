import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
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

      // Al hacer clic o doble clic, abre el archivo descargándolo temporalmente
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

export class ImpexTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.TreeDragAndDropController<vscode.TreeItem> {
  public dropMimeTypes = ["application/vnd.code.tree.sfccImpexExplorer", "text/uri-list"];
  public dragMimeTypes = ["application/vnd.code.tree.sfccImpexExplorer"];

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

  // --- Implementación de Drag and Drop (Arrastrar y Soltar) ---
  public async handleDrag(source: readonly vscode.TreeItem[], treeDataTransfer: vscode.DataTransfer): Promise<void> {
    treeDataTransfer.set("application/vnd.code.tree.sfccImpexExplorer", new vscode.DataTransferItem(source));
  }

  public async handleDrop(target: vscode.TreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const config = this.configManager.getCurrentConfig();
    if (!config || !this.client) {
      vscode.window.showErrorMessage("No hay conexión con la sandbox SFCC.");
      return;
    }

    let targetDir = config.root || "/on/demandware.servlet/webdav/Sites/Impex";
    if (target instanceof ImpexTreeItem) {
      targetDir = target.item.isDirectory ? target.item.path : path.dirname(target.item.path);
    }

    // 1. Mover carpetas/ficheros arrastrados dentro del propio árbol
    const internalTransfer = dataTransfer.get("application/vnd.code.tree.sfccImpexExplorer");
    if (internalTransfer) {
      const items = internalTransfer.value as ImpexTreeItem[];
      for (const src of items) {
        if (!(src instanceof ImpexTreeItem)) continue;
        const destPath = `${targetDir.replace(/\/$/, "")}/${src.item.displayName}`;
        if (src.item.path === destPath) continue;
        try {
          await this.client.move(src.item.path, destPath);
          vscode.window.showInformationMessage(`Movido: ${src.item.displayName} -> ${targetDir}`);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Error al mover elemento: ${err.message}`);
        }
      }
      this.refresh();
      return;
    }

    // 2. Subir ficheros arrastrados desde fuera (Explorador de VS Code o del Sistema Operativo)
    const uriListItem = dataTransfer.get("text/uri-list");
    if (uriListItem) {
      const uriStr = await uriListItem.asString();
      const lines = uriStr.split(/\r?\n/).filter(l => l.trim().length > 0 && !l.startsWith("#"));
      
      if (lines.length > 0) {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Subiendo archivos arrastrados a ${path.basename(targetDir)}...`,
          cancellable: false
        }, async (progress) => {
          for (const line of lines) {
            try {
              const fileUri = vscode.Uri.parse(line);
              if (fileUri.scheme === "file") {
                const fsPath = fileUri.fsPath;
                if (fs.existsSync(fsPath)) {
                  const stat = fs.statSync(fsPath);
                  if (stat.isFile()) {
                    const fileName = path.basename(fsPath);
                    progress.report({ message: `Subiendo ${fileName}` });
                    const destPath = `${targetDir.replace(/\/$/, "")}/${fileName}`;
                    const content = fs.readFileSync(fsPath);
                    await this.client!.put(destPath, content);
                  }
                }
              }
            } catch (e: any) {
              vscode.window.showErrorMessage(`Error al subir ${line}: ${e.message}`);
            }
          }
        });
        vscode.window.showInformationMessage(`Archivos subidos correctamente a ${targetDir}`);
        this.refresh();
      }
    }
  }
}
