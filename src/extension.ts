import { UpdateChecker } from "./updater/updateChecker";
import * as vscode from 'vscode';
import { ConfigManager } from './config/configManager';
import { ImpexFileSystemProvider } from './providers/impexFileSystemProvider';
import { ImpexTreeDataProvider } from './providers/impexTreeDataProvider';
import { FileCommands } from './commands/fileCommands';

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('SFCC Impex Explorer');
  outputChannel.appendLine('Activando extensión SFCC Impex Explorer...');

  // 1. Gestor de configuración (dw.json / webdav.json)
  const configManager = new ConfigManager();
  context.subscriptions.push(configManager);

  // 2. FileSystemProvider virtual (sfcc-impex://)
  const fsProvider = new ImpexFileSystemProvider(configManager);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(ImpexFileSystemProvider.SCHEME, fsProvider, {
      isCaseSensitive: true
    })
  );

  // 3. TreeDataProvider para la vista en el panel de Explorador
  const treeDataProvider = new ImpexTreeDataProvider(configManager);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('sfccImpexExplorer', treeDataProvider)
  );

  // 4. Comandos de acción
  const fileCommands = new FileCommands(configManager, treeDataProvider, fsProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand('sfcc-impex.refresh', () => {
      treeDataProvider.refresh();
      outputChannel.appendLine('Árbol Impex refrescado.');
    }),

    vscode.commands.registerCommand('sfcc-impex.openFile', (item) => {
      fileCommands.openFile(item);
    }),

    vscode.commands.registerCommand('sfcc-impex.uploadFile', (item) => {
      fileCommands.uploadFile(item);
    }),

    vscode.commands.registerCommand('sfcc-impex.downloadFile', (item) => {
      fileCommands.downloadFile(item);
    }),

    vscode.commands.registerCommand('sfcc-impex.createFolder', (item) => {
      fileCommands.createFolder(item);
    }),

    vscode.commands.registerCommand('sfcc-impex.deleteItem', (item) => {
      fileCommands.deleteItem(item);
    }),

    vscode.commands.registerCommand('sfcc-impex.renameItem', (item) => {
      fileCommands.renameItem(item);
    }),

    vscode.commands.registerCommand('sfcc-impex.copyRemotePath', (item) => {
      fileCommands.copyRemotePath(item);
    }),

    vscode.commands.registerCommand('sfcc-impex.mountWorkspaceFolder', () => {
      fileCommands.mountWorkspaceFolder();
    }),

    vscode.commands.registerCommand('sfcc-impex.switchRoot', () => {
      fileCommands.switchRoot();
    }),

    vscode.commands.registerCommand('sfcc-impex.reloadConfig', () => {
      const cfg = configManager.reloadConfig();
      if (cfg) {
        vscode.window.showInformationMessage(`SFCC Impex: Conectado a ${cfg.hostname} (${cfg.username})`);
      } else {
        vscode.window.showWarningMessage('SFCC Impex: No se encontró ningún archivo dw.json o webdav.json válido.');
      }
    })
  );

  const initialConfig = configManager.getCurrentConfig();
  if (initialConfig) {
    outputChannel.appendLine(`Configuración detectada: ${initialConfig.hostname} (${initialConfig.username})`);
    
    // Auto-montar si está configurado
    const autoMount = vscode.workspace.getConfiguration('sfccImpex').get<boolean>('autoMountWorkspace', false);
    if (autoMount) {
      fileCommands.mountWorkspaceFolder();
    }
  } else {
    outputChannel.appendLine('Aviso: No se detectó ningún dw.json o webdav.json en el workspace actual.');
  }

  outputChannel.appendLine('Extensión SFCC Impex Explorer lista.');
}

export function deactivate() {
  console.log('Desactivando extensión SFCC Impex Explorer...');
}
