# Claude Code Dock (ccdock)

A VSCode extension that displays Claude Code sessions as cards in the secondary sidebar. Monitors all Claude Code sessions running on the machine via hooks and shows real-time status, context usage, cost, and working directory.

## Features

- Real-time session monitoring via Claude Code hooks
- Session status tracking (active, thinking, tool_use, waiting, compacting)
- Context window usage progress bar
- Cost and line change tracking
- Automatic ghost session cleanup
- Safe hooks installation (never modifies existing hooks)

## Installation

Download the `.vsix` file from [GitHub Releases](https://github.com/hexylab/ccdock/releases), then install it with:

```bash
code --install-extension ccdock-x.x.x.vsix
```

## How It Works

Claude Code hooks write session data to a SQLite database via `ccdock-writer.js`. The extension polls the database at regular intervals and renders React-based session cards in a VSCode WebView panel in the secondary sidebar. Each card shows the session's working directory, current status, context window usage, accumulated cost, and line change counts.

## Requirements

- VSCode 1.85+
- Node.js (required for hook scripts)
- Claude Code

## License

MIT
