import * as vscode from "vscode";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  assets: GitHubReleaseAsset[];
  html_url: string;
}

export class UpdateChecker {
  public static async check(context: vscode.ExtensionContext, manual = false): Promise<void> {
    const DEFAULT_REPO = "jfernandezs-hiberuscom/vstudio-sfcc-impex-explorer";
    const config = vscode.workspace.getConfiguration("sfccImpex");
    let repo = (config.get<string>("githubRepo") || DEFAULT_REPO).trim() || DEFAULT_REPO;

    let currentVersion = "1.0.0";
    try {
      const ext = vscode.extensions.getExtension("javier-fernandez.sfcc-impex-explorer");
      if (ext && ext.packageJSON && ext.packageJSON.version) {
        currentVersion = ext.packageJSON.version;
      } else if (context.extension?.packageJSON?.version) {
        currentVersion = context.extension.packageJSON.version;
      }
    } catch (e) {}

    try {
      const release = await this.fetchLatestRelease(repo);
      if (!release) {
        if (manual) {
          vscode.window.showInformationMessage(`No se encontraron releases publicadas en ${repo}`);
        }
        return;
      }

      const latestVersion = release.tag_name.replace(/^v/i, "").trim();

      if (this.isNewer(latestVersion, currentVersion)) {
        const vsixAsset = release.assets.find((a) => a.name.endsWith(".vsix"));
        if (!vsixAsset) {
          if (manual) {
            vscode.window.showWarningMessage(
              `Hay una nueva versión (${release.tag_name}), pero la release no contiene ningún archivo .vsix para instalar.`
            );
          }
          return;
        }

        const action = await vscode.window.showInformationMessage(
          `Hay una nueva versión disponible de SFCC Impex Explorer (v${latestVersion}). Tu versión actual es v${currentVersion}.`,
          "Actualizar ahora",
          "Ver en GitHub",
          "Más tarde"
        );

        if (action === "Actualizar ahora") {
          await this.downloadAndInstall(vsixAsset);
        } else if (action === "Ver en GitHub") {
          vscode.env.openExternal(vscode.Uri.parse(release.html_url));
        }
      } else {
        if (manual) {
          vscode.window.showInformationMessage(`Ya tienes instalada la versión más reciente (v${currentVersion}).`);
        }
      }
    } catch (err: any) {
      if (manual) {
        vscode.window.showErrorMessage(`Error al comprobar actualizaciones: ${err.message}`);
      }
    }
  }

  private static isNewer(latest: string, current: string): boolean {
    const lParts = latest.split(".").map((n) => parseInt(n, 10) || 0);
    const cParts = current.split(".").map((n) => parseInt(n, 10) || 0);

    for (let i = 0; i < Math.max(lParts.length, cParts.length); i++) {
      const l = lParts[i] || 0;
      const c = cParts[i] || 0;
      if (l > c) return true;
      if (l < c) return false;
    }
    return false;
  }

  private static fetchLatestRelease(repo: string): Promise<GitHubRelease | null> {
    return new Promise((resolve, reject) => {
      const url = `https://api.github.com/repos/${repo}/releases/latest`;
      const options: https.RequestOptions = {
        headers: {
          "User-Agent": "VSCode-SFCC-Impex-Explorer-Updater",
          Accept: "application/vnd.github.v3+json"
        },
        timeout: 10000
      };

      https
        .get(url, options, (res) => {
          if (res.statusCode === 404) {
            return resolve(null);
          }
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              if (res.statusCode === 200) {
                resolve(JSON.parse(data));
              } else {
                reject(new Error(`GitHub API HTTP ${res.statusCode}: ${data}`));
              }
            } catch (e: any) {
              reject(e);
            }
          });
        })
        .on("error", reject);
    });
  }

  private static async downloadAndInstall(asset: GitHubReleaseAsset): Promise<void> {
    const tempFile = path.join(os.tmpdir(), asset.name);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Descargando actualización (${asset.name})...`,
        cancellable: false
      },
      async () => {
        await this.downloadFileWithRedirects(asset.browser_download_url, tempFile);
      }
    );

    try {
      await vscode.commands.executeCommand("workbench.extensions.installExtension", vscode.Uri.file(tempFile));

      const reload = await vscode.window.showInformationMessage(
        "SFCC Impex Explorer se ha actualizado correctamente.",
        "Recargar ventana"
      );

      if (reload === "Recargar ventana") {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error al instalar la actualización: ${err.message}`);
    } finally {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (e) {}
    }
  }

  private static downloadFileWithRedirects(urlStr: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const getFollow = (currentUrl: string, depth = 0) => {
        if (depth > 5) {
          return reject(new Error("Demasiados redireccionamientos al descargar VSIX"));
        }

        const options: https.RequestOptions = {
          headers: {
            "User-Agent": "VSCode-SFCC-Impex-Explorer-Updater"
          }
        };

        https
          .get(currentUrl, options, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              return getFollow(res.headers.location, depth + 1);
            }

            if (res.statusCode !== 200) {
              return reject(new Error(`Error al descargar VSIX: HTTP ${res.statusCode}`));
            }

            const fileStream = fs.createWriteStream(destPath);
            res.pipe(fileStream);

            fileStream.on("finish", () => {
              fileStream.close();
              resolve();
            });

            fileStream.on("error", (err) => {
              fs.unlink(destPath, () => {});
              reject(err);
            });
          })
          .on("error", reject);
      };

      getFollow(urlStr);
    });
  }
}
