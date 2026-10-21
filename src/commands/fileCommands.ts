import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { ConfigManager } from "../config/configManager";
import { WebdavClient } from "../webdav/webdavClient";
import { ImpexTreeDataProvider, ImpexTreeItem } from "../providers/impexTreeDataProvider";
import { ImpexFileSystemProvider } from "../providers/impexFileSystemProvider";

export class FileCommands {
  // Mapa de ruta local temporal -> ruta remota en SFCC WebDAV
  private localToRemoteMap: Map<string, string> = new Map<string, string>();

  constructor(
    private configManager: ConfigManager,
    private treeDataProvider: ImpexTreeDataProvider,
    private fsProvider: ImpexFileSystemProvider
  ) {}

  private getClient(): WebdavClient | null {
    const config = this.configManager.getCurrentConfig();
    return config ? new WebdavClient(config) : null;
  }

  public getRemotePathForLocal(localPath: string): string | undefined {
    return this.localToRemoteMap.get(localPath);
  }

  public async handleDidSaveTextDocument(doc: vscode.TextDocument): Promise<void> {
    const localPath = doc.uri.fsPath;
    const remotePath = this.localToRemoteMap.get(localPath);
    if (!remotePath) {
      return;
    }

    const client = this.getClient();
    if (!client) {
      vscode.window.showErrorMessage("SFCC Impex: No se pudo guardar en la sandbox porque no hay configuración activa.");
      return;
    }

    try {
      const content = fs.readFileSync(localPath);
      await client.put(remotePath, content);
      vscode.window.setStatusBarMessage(`$(check) Guardado en SFCC Impex: ${path.basename(remotePath)}`, 4000);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error al subir cambios a SFCC Impex [${remotePath}]: ${err.message}`);
    }
  }

  public async openFile(treeItem?: ImpexTreeItem): Promise<void> {
    if (!treeItem || treeItem.item.isDirectory) {
      return;
    }

    const item = treeItem.item;
    const client = this.getClient();
    if (!client) {
      vscode.window.showErrorMessage("No hay conexión con la sandbox SFCC.");
      return;
    }

    // Avisar si el archivo es muy grande (> 10MB)
    if (item.size > 10 * 1024 * 1024) {
      const confirm = await vscode.window.showWarningMessage(
        `El archivo "${item.displayName}" pesa ${(item.size / (1024 * 1024)).toFixed(1)} MB. ¿Deseas descargarlo y abrirlo?`,
        "Descargar y abrir",
        "Cancelar"
      );
      if (confirm !== "Descargar y abrir") {
        return;
      }
    }

    try {
      // Descargar a carpeta temporal local
      const tempBaseDir = path.join(os.tmpdir(), "sfcc-impex-temp");
      const cleanRelPath = item.path.replace(/^\/+/, "");
      const localFilePath = path.join(tempBaseDir, cleanRelPath);

      fs.mkdirSync(path.dirname(localFilePath), { recursive: true });

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: `Descargando ${item.displayName}...`
        },
        async () => {
          const buffer = await client.get(item.path);
          fs.writeFileSync(localFilePath, buffer);
        }
      );

      // Registrar mapeo para auto-guardado hacia la sandbox
      this.localToRemoteMap.set(localFilePath, item.path);

      // Abrir en el editor de VS Code como archivo local normal
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(localFilePath));
      await vscode.window.showTextDocument(doc, { preview: false });

    } catch (err: any) {
      vscode.window.showErrorMessage(`Error al descargar y abrir ${item.displayName}: ${err.message}`);
    }
  }

  public async uploadFile(treeItem?: ImpexTreeItem): Promise<void> {
    const client = this.getClient();
    const config = this.configManager.getCurrentConfig();
    if (!client || !config) {
      vscode.window.showErrorMessage("No hay conexión con sandbox SFCC.");
      return;
    }

    let targetDir = config.root || "/on/demandware.servlet/webdav/Sites/Impex";
    if (treeItem) {
      targetDir = treeItem.item.isDirectory ? treeItem.item.path : path.dirname(treeItem.item.path);
    }

    const fileUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      openLabel: "Subir a Impex"
    });

    if (!fileUris || fileUris.length === 0) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Subiendo archivos a SFCC Impex...",
        cancellable: false
      },
      async (progress) => {
        for (const fileUri of fileUris) {
          const fileName = path.basename(fileUri.fsPath);
          progress.report({ message: `Subiendo ${fileName}` });
          const remoteDest = `${targetDir.replace(/\/$/, "")}/${fileName}`;
          const content = fs.readFileSync(fileUri.fsPath);
          await client.put(remoteDest, content);
        }
      }
    );

    vscode.window.showInformationMessage(`Archivos subidos correctamente a ${targetDir}`);
    this.treeDataProvider.refresh();
  }

  public async downloadFile(treeItem?: ImpexTreeItem): Promise<void> {
    const client = this.getClient();
    if (!client || !treeItem) {
      return;
    }

    const item = treeItem.item;
    if (item.isDirectory) {
      vscode.window.showInformationMessage("La descarga de carpetas recursivas completas no está soportada directamente en esta versión. Descarga los archivos individuales.");
      return;
    }

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(item.displayName),
      saveLabel: "Guardar archivo local"
    });

    if (!saveUri) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Descargando ${item.displayName}...`,
        cancellable: false
      },
      async () => {
        const buffer = await client.get(item.path);
        fs.writeFileSync(saveUri.fsPath, buffer);
      }
    );

    vscode.window.showInformationMessage(`Archivo guardado en: ${saveUri.fsPath}`);
  }

  public async createFolder(treeItem?: ImpexTreeItem): Promise<void> {
    const client = this.getClient();
    const config = this.configManager.getCurrentConfig();
    if (!client || !config) {
      return;
    }

    let parentDir = config.root || "/on/demandware.servlet/webdav/Sites/Impex";
    if (treeItem) {
      parentDir = treeItem.item.isDirectory ? treeItem.item.path : path.dirname(treeItem.item.path);
    }

    const folderName = await vscode.window.showInputBox({
      prompt: `Crear nueva carpeta dentro de ${parentDir}`,
      placeHolder: "nombre-de-carpeta",
      validateInput: (value) => {
        if (!value || !value.trim()) return "El nombre no puede estar vacío";
        if (value.includes("/") || value.includes("\\")) return "El nombre no puede contener barras";
        return null;
      }
    });

    if (!folderName) {
      return;
    }

    const newPath = `${parentDir.replace(/\/$/, "")}/${folderName.trim()}`;
    try {
      await client.mkcol(newPath);
      vscode.window.showInformationMessage(`Carpeta "${folderName}" creada en SFCC.`);
      this.treeDataProvider.refresh();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error creando carpeta: ${err.message}`);
    }
  }

  public async deleteItem(treeItem?: ImpexTreeItem): Promise<void> {
    const client = this.getClient();
    if (!client || !treeItem) {
      return;
    }

    const item = treeItem.item;
    const confirmSetting = vscode.workspace.getConfiguration("sfccImpex").get<boolean>("confirmDelete", true);

    if (confirmSetting) {
      const typeStr = item.isDirectory ? "la carpeta completa y su contenido" : "el archivo";
      const confirm = await vscode.window.showWarningMessage(
        `¿Estás seguro de que deseas eliminar permanentemente ${typeStr} "${item.displayName}" de la sandbox SFCC?`,
        { modal: true },
        "Eliminar permanentemente"
      );

      if (confirm !== "Eliminar permanentemente") {
        return;
      }
    }

    try {
      await client.delete(item.path);
      vscode.window.showInformationMessage(`Eliminado: ${item.displayName}`);
      this.treeDataProvider.refresh();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error al eliminar: ${err.message}`);
    }
  }

  public async renameItem(treeItem?: ImpexTreeItem): Promise<void> {
    const client = this.getClient();
    if (!client || !treeItem) {
      return;
    }

    const item = treeItem.item;
    const parentDir = path.dirname(item.path);

    const newName = await vscode.window.showInputBox({
      prompt: `Renombrar ${item.displayName}`,
      value: item.displayName,
      validateInput: (value) => {
        if (!value || !value.trim()) return "El nombre no puede estar vacío";
        if (value.includes("/") || value.includes("\\")) return "El nombre no puede contener barras";
        return null;
      }
    });

    if (!newName || newName.trim() === item.displayName) {
      return;
    }

    const destPath = `${parentDir.replace(/\/$/, "")}/${newName.trim()}`;
    try {
      await client.move(item.path, destPath);
      vscode.window.showInformationMessage(`Renombrado a: ${newName}`);
      this.treeDataProvider.refresh();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error al renombrar: ${err.message}`);
    }
  }

  public async copyRemotePath(treeItem?: ImpexTreeItem): Promise<void> {
    if (!treeItem) return;
    await vscode.env.clipboard.writeText(treeItem.item.path);
    vscode.window.showInformationMessage(`Ruta copiada al portapapeles: ${treeItem.item.path}`);
  }

  public async selectConfigFile(): Promise<void> {
    const fileUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        "JSON Files": ["json"]
      },
      openLabel: "Seleccionar dw.json o webdav.json"
    });

    if (fileUris && fileUris.length > 0) {
      const selected = fileUris[0].fsPath;
      const loaded = this.configManager.setManualConfigFile(selected);
      if (loaded) {
        vscode.window.showInformationMessage(`SFCC Impex: Conectado a ${loaded.hostname} (${loaded.username})`);
      } else {
        vscode.window.showErrorMessage(`No se pudo leer configuración válida de ${selected}`);
      }
      this.treeDataProvider.refresh();
    }
  }

  public async switchRoot(): Promise<void> {
    const options = [
      {
        label: "$(file-directory) Impex",
        description: "/on/demandware.servlet/webdav/Sites/Impex",
        path: "/on/demandware.servlet/webdav/Sites/Impex"
      },
      {
        label: "$(output) Logs",
        description: "/on/demandware.servlet/webdav/Sites/Logs",
        path: "/on/demandware.servlet/webdav/Sites/Logs"
      },
      {
        label: "$(package) Cartridges",
        description: "/on/demandware.servlet/webdav/Sites/Cartridges",
        path: "/on/demandware.servlet/webdav/Sites/Cartridges"
      },
      {
        label: "$(edit) Otra ruta personalizada...",
        description: "Escribir ruta manual de WebDAV",
        path: "__CUSTOM__"
      }
    ];

    const selected = await vscode.window.showQuickPick(options, {
      placeHolder: "Selecciona el directorio raíz de SFCC WebDAV a visualizar"
    });

    if (!selected) return;

    if (selected.path === "__CUSTOM__") {
      const customPath = await vscode.window.showInputBox({
        prompt: "Ruta absoluta en WebDAV",
        value: this.configManager.getCurrentRoot()
      });
      if (customPath && customPath.trim()) {
        this.configManager.setCustomRoot(customPath.trim());
      }
    } else {
      this.configManager.setCustomRoot(selected.path);
    }
  }

  public async mountWorkspaceFolder(): Promise<void> {
    const config = this.configManager.getCurrentConfig();
    if (!config) {
      vscode.window.showErrorMessage("No hay configuración de dw.json / webdav.json cargada.");
      return;
    }

    const rootPath = config.root || "/on/demandware.servlet/webdav/Sites/Impex";
    const folderUri = vscode.Uri.parse(
      `${ImpexFileSystemProvider.SCHEME}://${config.hostname}${rootPath}`
    );

    const folderName = `SFCC Impex (${config.hostname.split(".")[0]})`;

    const existingIndex = (vscode.workspace.workspaceFolders || []).findIndex(
      (f) => f.uri.toString() === folderUri.toString()
    );

    if (existingIndex !== -1) {
      vscode.window.showInformationMessage("La carpeta remota ya está montada en el workspace.");
      return;
    }

    const currentCount = (vscode.workspace.workspaceFolders || []).length;
    const success = vscode.workspace.updateWorkspaceFolders(currentCount, 0, {
      uri: folderUri,
      name: folderName
    });

    if (success) {
      vscode.window.showInformationMessage(`Carpeta ${folderName} añadida al Explorador de archivos.`);
    } else {
      vscode.window.showErrorMessage("No se pudo añadir la carpeta al workspace.");
    }
  }
}
