# MiniCode

[简体中文](./README.zh-CN.md) | [Architecture](./ARCHITECTURE.md) | [License](./LICENSE)

A lightweight terminal coding assistant for local development workflows.

MiniCode provides Claude Code-like workflow and architectural ideas in a much smaller implementation, making it especially useful for learning, experimentation, and custom tooling.

## Overview

MiniCode is built around a practical terminal-first agent loop:

- accept a user request
- inspect the workspace
- call tools when needed
- review file changes before writing
- return a final response in the same terminal session

The project is intentionally compact, so the control flow, tool model, and TUI behavior remain easy to understand and extend.

## Table of Contents

- [Why MiniCode](#why-minicode)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Architecture Docs](#architecture-docs)
- [Development](#development)

## Why MiniCode

MiniCode is a good fit if you want:

- a lightweight coding assistant instead of a large platform
- a terminal UI with tool calling, transcript, and command workflow
- a small codebase that is suitable for study and modification
- a reference implementation for Claude Code-like agent architecture

## Features

### Core workflow

- multi-step tool execution in a single turn
- model -> tool -> model loop
- full-screen terminal interface
- input history, transcript scrolling, and slash command menu

### Built-in tools

- `list_files`
- `grep_files`
- `read_file`
- `write_file`
- `edit_file`
- `patch_file`
- `modify_file`
- `run_command`

### Safety and usability

- review-before-write flow for file modifications
- path and command permission checks
- local installer with independent config storage
- support for Anthropic-style API endpoints

## Installation

```bash
cd mini-code
npm install
npm run install-local
```

The installer will ask for:

- model name
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_AUTH_TOKEN`

Configuration is stored in:

- `~/.mini-code/settings.json`

The launcher is installed to:

- `~/.local/bin/minicode`

If `~/.local/bin` is not already on your `PATH`, add:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Quick Start

Run the installed launcher:

```bash
minicode
```

Run in development mode:

```bash
npm run dev
```

Run in offline demo mode:

```bash
MINI_CODE_MODEL_MODE=mock npm run dev
```

## Commands

### Local slash commands

- `/help`
- `/tools`
- `/status`
- `/model`
- `/model <name>`
- `/config-paths`

### Terminal interaction

- command suggestions and slash menu
- transcript scrolling
- prompt editing
- input history navigation

## Configuration

Example configuration:

```json
{
  "model": "your-model-name",
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_MODEL": "your-model-name"
  }
}
```

Configuration priority:

1. `~/.mini-code/settings.json`
2. compatible existing local settings
3. process environment variables

## Project Structure

- `src/index.ts`: CLI entry
- `src/agent-loop.ts`: multi-step model/tool loop
- `src/tool.ts`: tool registry and execution
- `src/tools/*`: built-in tools
- `src/tui/*`: terminal UI modules
- `src/config.ts`: runtime configuration loading
- `src/install.ts`: interactive installer

## Architecture Docs

- [Architecture Overview](./ARCHITECTURE.md)
- [中文架构说明](./ARCHITECTURE_ZH.md)

## Development

```bash
npm run check
```

MiniCode is intentionally small and pragmatic. The goal is to keep the architecture understandable, hackable, and easy to extend.
