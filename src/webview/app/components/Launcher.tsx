import React from 'react';
import { useLauncher } from '../hooks/useLauncher';

function basename(p: string): string {
  return p.split('/').pop() || p;
}

export function Launcher() {
  const {
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
  } = useLauncher();

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === '__browse__') {
      browse();
      // Reset select to previous value
      e.target.value = selectedCwd;
      return;
    }
    setSelectedCwd(value);
  };

  return (
    <div className="launcher-panel">
      <div className="launcher-dir">
        <select
          className="launcher-select"
          value={selectedCwd}
          onChange={handleSelect}
        >
          {workspaceFolders.map((f) => (
            <option key={f} value={f}>{basename(f)}</option>
          ))}
          {customPaths.length > 0 && workspaceFolders.length > 0 && (
            <option disabled>───</option>
          )}
          {customPaths.map((p) => (
            <option key={p} value={p}>{basename(p)}</option>
          ))}
          <option disabled>───</option>
          <option value="__browse__">+ ワークスペースを追加...</option>
        </select>
        {customPaths.includes(selectedCwd) && (
          <button
            className="launcher-remove-btn"
            onClick={() => removePath(selectedCwd)}
            title="パスを削除"
          >×</button>
        )}
      </div>
      <div className="launcher-options">
        <label className="launcher-checkbox">
          <input
            type="checkbox"
            checked={skipPermissions}
            onChange={(e) => setSkipPermissions(e.target.checked)}
          />
          承認スキップモード
        </label>
        <label className="launcher-checkbox">
          <input
            type="checkbox"
            checked={discordChannel}
            onChange={(e) => setDiscordChannel(e.target.checked)}
          />
          Discord接続
        </label>
      </div>
      <button
        className="launcher-btn"
        onClick={launch}
        disabled={!selectedCwd}
      >
        Claude Code を起動
      </button>
    </div>
  );
}
