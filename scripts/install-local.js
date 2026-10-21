const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = os.homedir();
const extensionsDir = path.join(homeDir, '.vscode', 'extensions');
const targetExtensionDir = path.join(extensionsDir, 'javier-fernandez.sfcc-impex-explorer-1.0.4');
const projectDir = path.resolve(__dirname, '..');

console.log('Instalando extensión SFCC Impex en VS Code local...');
console.log('Origen:', projectDir);
console.log('Destino:', targetExtensionDir);

if (!fs.existsSync(extensionsDir)) {
  fs.mkdirSync(extensionsDir, { recursive: true });
}

// Si ya existe enlace o directorio anterior, eliminarlo
if (fs.existsSync(targetExtensionDir) || fs.lstatSync(targetExtensionDir, { throwIfNoEntry: false })) {
  try {
    fs.unlinkSync(targetExtensionDir);
  } catch (e) {
    fs.rmSync(targetExtensionDir, { recursive: true, force: true });
  }
}

try {
  fs.symlinkSync(projectDir, targetExtensionDir, 'junction');
  console.log('✓ Enlace simbólico creado exitosamente en ~/.vscode/extensions/javier-fernandez.sfcc-impex-explorer-1.0.4');
  console.log('Reinicia VS Code o ejecuta "Developer: Reload Window" (Ctrl+Shift+P) para comenzar a usar la extensión.');
} catch (err) {
  console.error('Error al crear symlink:', err.message);
  process.exit(1);
}
