# SFCC Impex Explorer (Extensión de Visual Studio Code)

Extensión de VS Code desarrollada por Javier Fernandez para el equipo de desarrollo de SFCC. Permite navegar, visualizar, editar, subir y descargar archivos del directorio WebDAV **Impex** (y Logs) de la sandbox activa, integrada de forma nativa en el explorador de archivos.

---

## Características

- 🔍 **Detección Automática:** Lee automáticamente el `dw.json` o `webdav.json` de tu proyecto (`erebor-spa-typescript` o raíz del workspace) para obtener el `hostname`, `username` y `password`.
- 📁 **Integración en el Explorador de Archivos:**
  - Panel **SFCC Impex** integrado directamente en la barra lateral del Explorador de VS Code.
  - Soporte de **FileSystemProvider** (`sfcc-impex://`): abre y edita archivos remotos como si fueran locales con coloreado de sintaxis (XML, CSV, JSON, LOG).
  - Al pulsar `Ctrl+S`, los cambios se guardan directamente en la sandbox mediante WebDAV `PUT`.
- ⚡ **Montaje en el Workspace:** Comando para añadir la carpeta Impex directamente como carpeta raíz en el árbol de archivos del workspace.
- 🔄 **Cambio Rápido de Raíz:** Selector rápido para cambiar entre:
  - `Impex` (`/on/demandware.servlet/webdav/Sites/Impex`)
  - `Logs` (`/on/demandware.servlet/webdav/Sites/Logs`)
  - `Cartridges` (`/on/demandware.servlet/webdav/Sites/Cartridges`)
  - Rutas personalizadas.
- 🚀 **Operaciones Remotas:**
  - **Subir archivos locales:** Selecciona uno o varios archivos y súbelos a cualquier carpeta remota.
  - **Descargar:** Guarda cualquier archivo remoto en tu disco local.
  - **Crear carpeta:** Crea nuevos subdirectorios en WebDAV (`MKCOL`).
  - **Eliminar con confirmación:** Elimina archivos o carpetas con ventana modal de seguridad.
  - **Renombrar:** Mueve o renombra archivos en la sandbox (`MOVE`).
  - **Copiar ruta:** Copia la ruta WebDAV al portapapeles.

---

## Requisitos y Compilación

Para compilar la extensión:

```bash
cd tools/vscode-sfcc-impex
npm install
npm run build
```

Para instalarla directamente en tu VS Code local (`~/.vscode/extensions/`):

```bash
npm run install-local
```

Una vez instalada, en VS Code ejecuta `Developer: Reload Window` (`Ctrl+Shift+P` -> recargar ventana).

---

## Configuración (`settings.json`)

| Opción | Tipo | Defecto | Descripción |
|---|---|---|---|
| `sfccImpex.defaultRoot` | `string` | `/on/demandware.servlet/webdav/Sites/Impex` | Ruta raíz inicial de WebDAV. |
| `sfccImpex.confirmDelete` | `boolean` | `true` | Solicitar confirmación antes de borrar en la sandbox. |
| `sfccImpex.autoMountWorkspace` | `boolean` | `false` | Montar automáticamente Impex como carpeta del workspace al abrir VS Code. |
