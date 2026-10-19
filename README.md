# bolt.diy — Alexandre's fork

This repository is [Alexandre's fork](https://github.com/alexandre-leng/bolt.diy) of [stackblitz-labs/bolt.diy](https://github.com/stackblitz-labs/bolt.diy). It contains the Bolt interface, mobile and reliability improvements used by the self-hosted instance. It is not an official upstream release. Upstream remains the source for general documentation and community support.

> **Security:** Never commit API keys, credentials, `.env.local`, browser storage, or production logs. The GitHub fork is public. Server-side authentication, reverse-proxy configuration, and runtime credentials are managed outside this repository.

[![bolt.diy: AI-Powered Full-Stack Web Development in the Browser](./public/social_preview_index(1).jpg)](https://bolt.diy)

Welcome to **bolt.diy**, the open-source AI developer workspace that lets you select your preferred LLM for every prompt. Build full-stack web applications in the browser with support for 22+ model providers (OpenAI, Anthropic, Gemini, Groq, xAI, DeepSeek, Ollama, LM Studio, and more), or extend it with any provider supported by the Vercel AI SDK. OpenRouter, Anthropic, OpenAI, and Google are enabled by default; enable and configure other providers in Settings.

[Documentation](https://stackblitz-labs.github.io/bolt.diy/) | [Community Forum](https://thinktank.ottomator.ai) | [FAQ & Troubleshooting](FAQ.md)

---

Also [this pinned post in our community](https://thinktank.ottomator.ai/t/videos-tutorial-helpful-content/3243) has a bunch of incredible resources for running and deploying bolt.diy yourself!

bolt.diy was originally started by [Cole Medin](https://www.youtube.com/@ColeMedin) but has quickly grown into a massive community effort to build the BEST open source AI coding assistant!

---

## Table of Contents

- [Quick Start](#quick-start)
- [This Fork: Changes and Deployment](#this-fork-changes-and-deployment)
- [Running with Docker](#running-with-docker)
- [Desktop App (Electron)](#desktop-app-electron)
- [Configuring API Keys and Providers](#configuring-api-keys-and-providers)
- [Features](#features)
- [Recent Highlights](#recent-highlights)
- [Available Scripts](#available-scripts)
- [Contributing & Community](#contributing--community)
- [Licensing](#licensing)

---

## Quick Start

### Prerequisites
- **Node.js** >= 22.12.0
- **pnpm** >= 9.15.9 (`npm install -g pnpm`)

### 1. Clone & Install

```bash
git clone https://github.com/alexandre-leng/bolt.diy.git
cd bolt.diy
pnpm install
```

### 2. Run the Development Server

```bash
pnpm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

> **Pre-built Desktop Binaries**: This fork does not publish standalone installers. Upstream binaries, which do not contain this fork's changes, are available from [upstream Releases](https://github.com/stackblitz-labs/bolt.diy/releases/latest).

---

## This Fork: Changes and Deployment

This fork adds OpenCode Go as a provider (default `deepseek-v4.1-flash` for a new browser), account-backed settings/history, project restoration, and touch-friendly chat/Preview navigation. Project code now runs in a separate server-side Docker/gVisor runtime; StackBlitz WebContainer has been removed. Provider availability still requires your own configuration; a cloned repository does not inherit the self-hosted server's keys.

**Start here:** [Self-hosted architecture, validation, delivery and audit status](docs/docs/self-hosted-bolt.md). This is the fork-specific operational guide; upstream instructions may describe a different runtime.

**Local quality gates:** `pnpm run typecheck`, `pnpm run lint`, `pnpm exec vitest run --no-file-parallelism`, and `pnpm run build`. The mobile interface must also be checked in a browser at 360, 390, 768 and 1440 px, in both themes, after changes to layout or navigation.

**Self-hosted deployment is separate from GitHub.** The live instance uses an external Docker Compose file, an entrypoint that forwards selected environment variables to the Cloudflare Worker, and an nginx authentication/proxy layer. Those files and secrets are not in this repository. To reproduce the deployment, provide your own secrets and authentication, build the `bolt-ai-production` Docker target, and use `wrangler dev` to serve the generated Worker behind a protected reverse proxy. A Git push does **not** rebuild or restart the live instance; consult the maintainer before deploying.

**Audit boundary:** UI changes in this fork are not a claim that every screen, browser and device has been manually verified. In particular, Firefox for Android and a real Agent/Preview project require their own end-to-end checks.

---

## Running with Docker

> The commands below are inherited development/generic examples. The self-hosted Worker production installation uses an external Compose file and `wrangler dev`, not the legacy `vite preview` production command. Configure the separate runtime and auth services before expecting project execution. Follow the [fork deployment guide](docs/docs/self-hosted-bolt.md#production-serving) for that distinction.

1. **Configure Environment Variables**:
   ```bash
   cp .env.example .env.local
   ```

2. **Build and Run**:
   ```bash
   # Development mode with hot-reload:
   docker compose --profile development up

   # Production build:
   pnpm run dockerbuild:prod
   docker compose --profile production up
   ```

---

## Desktop App (Electron)

bolt.diy is also available as a cross-platform desktop application:

- **Download**: This fork provides no installer; [upstream releases](https://github.com/stackblitz-labs/bolt.diy/releases/latest) are built from upstream source, not this fork.
- **Build from Source**:
  ```bash
  pnpm electron:build:dist
  ```

---

## Configuring API Keys and Providers

You can configure model providers either directly in the UI or via environment variables:

### Option A: In the UI (Recommended)
Click the model settings control in the composer to select a provider/model and enter a key when needed. For integration settings, open **Settings → Cloud Providers**. Browser-entered keys are stored on that browser; use server-side environment variables instead if you do not want to store keys in browser cookies.

### Option B: Environment Variables
Copy `.env.example` to `.env.local` and add your keys or local endpoints:

```bash
# Cloud Providers
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here

# Local Providers
OLLAMA_BASE_URL=http://127.0.0.1:11434
LMSTUDIO_BASE_URL=http://127.0.0.1:1234
```

---

## Features

- **Browser Workspace, Server Execution**: edit in the browser; project commands execute in a separately configured Docker/gVisor sandbox through `bolt-runtime`.
- **22+ AI Providers**: Cloud (Anthropic, OpenAI, Google, DeepSeek, Groq, xAI, Mistral, etc.) and Local (Ollama, LM Studio). OpenRouter, Anthropic, OpenAI, and Google are enabled by default.
- **Interactive Workbench**: Integrated code editor, terminal, visual diff viewer, and real-time live preview. On compact layouts the chat stays in front; use Preview to open the workbench and Chat to return.
- **Starter Setup**: Explicit framework requests select a matching starter in code. Starter files include detected install and development server commands before the first customization request.
- **Prompt Library**: Choose a system prompt under Settings → Workspace → Features, including Simple Sal for concise guidance and Tiny Tim for smaller models.
- **Project Workflows**: Git cloning/pushing, snapshot restoration, file conflict locking, and ZIP export.
- **Deployments**: One-click deployment to Netlify, Vercel, and GitHub Pages.
- **Database & Visuals**: Supabase integration, data visualization charts, and Model Context Protocol (MCP) tooling.

---

## Recent Highlights

- **Expanded AI & Tooling Ecosystem**: 22+ cloud and local LLM providers, Model Context Protocol (MCP) integration, and voice prompting.
- **Enhanced Code & Project Workflows**: Visual diff inspection, file conflict locking, codebase search, Git integration, and snapshot restoration.
- **Cross-Platform & Deployments**: Native Electron desktop app, Expo (React Native) support, and direct deployment to Netlify, Vercel, and GitHub Pages.
- **Data & Backend Integrations**: Built-in Supabase management, interactive charts, and bulk chat operations.
- **Prompt and Connector Controls**: Select MCP tools from the prompt attachment menu; manage GitHub, GitLab, Netlify, and other service connections under Settings → Integrations → Connectors.

> **Looking Ahead**: Ongoing work includes bug Fixes, dependance updates and fixes for reliability issues no new features are planed.

---

## Available Scripts

| Command | Description |
|---|---|
| `pnpm run dev` | Start development server with hot module reloading |
| `pnpm run build` | Build the application for production (`react-router build`) |
| `pnpm run preview` | Legacy Vite preview script; not the self-hosted Worker deployment entrypoint |
| `pnpm test` | Run unit and integration tests with Vitest |
| `pnpm run typecheck` | Run TypeScript type checks (`tsc`) |
| `pnpm run lint` | Run ESLint across the codebase |
| `pnpm run dockerbuild` | Build Docker container for development |
| `pnpm run electron:dev` | Start Electron desktop application in dev mode |
| `pnpm electron:build:dist` | Package Electron desktop app for current OS |

---

## Contributing & Community

- **Contributing**: Contributions are welcome! Read our [Contributing Guide](CONTRIBUTING.md) and [Project Management Guide](./PROJECT.md) to get started.
- **Troubleshooting & FAQ**: Common errors and setup fixes are documented in our [FAQ](FAQ.md) and [Official Docs](https://stackblitz-labs.github.io/bolt.diy/).


---

## Licensing

bolt.diy is open-source under the MIT License. This fork no longer depends on StackBlitz WebContainer. Preserve upstream and third-party notices; see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
