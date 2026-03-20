import type { WebViewMessage } from './types';

declare const acquireVsCodeApi: () => {
  postMessage: (msg: WebViewMessage) => void;
};

let _vscode: ReturnType<typeof acquireVsCodeApi> | undefined;

export function getVsCodeApi() {
  if (!_vscode) { _vscode = acquireVsCodeApi(); }
  return _vscode;
}
