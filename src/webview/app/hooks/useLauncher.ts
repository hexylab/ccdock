import { useState, useEffect, useCallback } from 'react';
import type { ExtensionMessage } from '../types';
import { getVsCodeApi } from '../vscodeApi';

export function useLauncher() {
  const [workspaceFolders, setWorkspaceFolders] = useState<string[]>([]);
  const [customPaths, setCustomPaths] = useState<string[]>([]);
  const [selectedCwd, setSelectedCwd] = useState<string>('');
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [discordChannel, setDiscordChannel] = useState(false);

  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionMessage>) => {
      const msg = event.data;
      if (msg.type === 'launcher:config') {
        setWorkspaceFolders(msg.workspaceFolders);
        setCustomPaths(msg.customPaths);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Auto-select first available directory when config arrives
  useEffect(() => {
    const allPaths = [...workspaceFolders, ...customPaths];
    if (allPaths.length > 0 && (!selectedCwd || !allPaths.includes(selectedCwd))) {
      setSelectedCwd(allPaths[0]);
    }
  }, [workspaceFolders, customPaths, selectedCwd]);

  const browse = useCallback(() => {
    getVsCodeApi().postMessage({ type: 'launcher:browse' });
  }, []);

  const removePath = useCallback((path: string) => {
    getVsCodeApi().postMessage({ type: 'launcher:removePath', path });
  }, []);

  const launch = useCallback(() => {
    if (!selectedCwd) return;
    const args: string[] = [];
    if (skipPermissions) args.push('--dangerously-skip-permissions');
    if (discordChannel) args.push('--channels', 'plugin:discord@claude-plugins-official');
    getVsCodeApi().postMessage({ type: 'launcher:launch', cwd: selectedCwd, args });
  }, [selectedCwd, skipPermissions, discordChannel]);

  return {
    workspaceFolders,
    customPaths,
    selectedCwd,
    setSelectedCwd,
    skipPermissions,
    setSkipPermissions,
    discordChannel,
    setDiscordChannel,
    browse,
    removePath,
    launch,
  };
}
