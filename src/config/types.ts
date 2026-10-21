import * as vscode from 'vscode';

export interface DwConfig {
  hostname: string;
  username: string;
  password?: string;
  version?: string;
  'code-version'?: string;
  root?: string;
  cartridgesPath?: string;
  verbose?: boolean;
  configPath?: string;
}

export interface WebdavItem {
  href: string;
  path: string;
  displayName: string;
  isDirectory: boolean;
  size: number;
  modifiedTime: number;
  etag?: string;
}

export interface ImpexTreeItemContext {
  item: WebdavItem;
  config: DwConfig;
}
