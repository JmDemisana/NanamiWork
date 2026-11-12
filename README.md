<p align="center">
  <h1 align="center">🌸 NanamiWork</h1>
  <p align="center">
    <strong>An agent instance manager and unified desktop frontend bringing your Antigravity, Codex, and GitHub Copilot accounts together.</strong>
  </p>
</p>

<p align="center">
  <img src="./docs/images/nanamiwork-preview.png" alt="NanamiWork Preview" width="850" />
</p>

---

## 🌟 Overview

**NanamiWork** is a desktop agent workspace and instance manager designed to effortlessly unify your developer accounts across the three major agent platforms: **Google Antigravity**, **Codex (ChatGPT)**, and **GitHub Copilot**.

Instead of juggling scattered CLI tokens, separate login flows, or conflicting global configurations, NanamiWork provides a clean, single-pane-of-glass desktop frontend. Connect multiple personal, student, or team accounts, monitor live quotas and rolling limits in real time, and run agent tasks in an isolated, conflict-free sandbox.

*(Note: The built-in Nanami Gateway section is a private, optional utility reserved for trusted peers with a Gate PIN. The core application is entirely powered by your own connected developer instances and accounts.)*

---

## ✨ Features

* **🛡️ 3-in-1 Agent Instance Manager**  
  Easily link, manage, and switch between your instances across **Google Antigravity**, **Codex (ChatGPT)**, and **GitHub Copilot** with 1-click device & browser authorization.

* **📊 Live Quotas & Rolling Limits**  
  Track independent account health and quota exhaustion at a glance:
  * **Antigravity**: Real-time bucket trackers for Gemini, Claude, and GPT-OSS models with accurate reset timers.
  * **Codex (ChatGPT)**: Adaptive rolling limit trackers distinguishing Free allowances from Paid 5-hour and weekly limits, with reasoning effort controls (Low / Medium / High).
  * **GitHub Copilot**: 1-click GitHub device flow for Student Pack and Individual accounts with automatic model discovery and monthly quota tracking.

* **⚡ Complete Sandbox Isolation**  
  NanamiWork operates strictly inside its isolated profile (`~/.config/nanamiwork`). It never modifies or pollutes your global OpenCode, OpenWork, VS Code Copilot, Antigravity, or Codex installations.

* **⏪ "Undo Up to This Point"**  
  Rewind any turn on the fly. Restores your exact previous prompt back into the composer with instant autofocus so you can refine instructions without losing context.

* **💻 Fully Cross-Platform & Portable**  
  Zero hardcoded paths or assumptions. Works seamlessly out of the box across Windows, Linux, and macOS.

---

## 📥 Downloads

Grab the latest installer for your operating system from the [**Releases Page**](https://github.com/JmDemisana/NanamiWork/releases):

| Platform | Format | Notes |
| :--- | :--- | :--- |
| **Windows** | `.exe` | Windows 10 / 11 NSIS setup |
| **Linux (Debian / Ubuntu)** | `.deb` | Standard package installer |
| **Linux (Universal)** | `.AppImage` | Portable binary for all modern distributions |
| **macOS** | `.dmg` / `.zip` | Universal support for Apple Silicon and Intel |

---

## 🚀 Quick Start

1. **Launch NanamiWork**.
2. **Connect Your Platforms**:
   * Open the Model Picker modal (`Select Model`).
   * Connect your desired platform (**Antigravity**, **Copilot**, or **ChatGPT**) via 1-click device or browser authorization.
3. **Choose Your Instance & Code**:
   * Pick any model from your connected accounts.
   * Open your local workspace folder and start building!

---

## 🛠️ Building from Source

```bash
# Clone the repository
git clone https://github.com/JmDemisana/NanamiWork.git
cd NanamiWork

# Install workspace dependencies
pnpm install

# Build the Electron bundle
pnpm --filter @openwork/desktop build:electron

# Package for your platform
pnpm --dir apps/desktop exec electron-builder --config electron-builder.yml
```

---

## ⚖️ Provider Terms & Compliance

NanamiWork provides multi-account profile switching to help developers organize personal, educational, and workplace credentials across distinct workspace contexts. All API interactions and authentication flows occur directly between the user's client and the upstream services (Google, OpenAI, GitHub). Users are solely responsible for complying with the Terms of Service, Acceptable Use Policies, and rate limits of each respective provider. NanamiWork does not alter, bypass, or circumvent provider access controls.

---

## 📄 License & Attribution

NanamiWork is licensed under the [GNU General Public License v3.0 (GPL-3.0)](./LICENSE).  
NanamiWork is grateful to the projects and people whose work makes it possible:

- [OpenWork](https://github.com/different-ai/openwork) by Different AI, Inc. provides the foundation NanamiWork is built on.
- [OpenCode](https://github.com/anomalyco/opencode) provides the agent engine and the upstream code used by the vendored code-mode package. See its [upstream notes](./packages/codemode/UPSTREAM.md) and [notice](./packages/codemode/NOTICE).
- [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) by NoeFabris and contributors provides the community Antigravity authentication plugin used by NanamiWork.
- [Electron](https://www.electronjs.org/) and [React](https://react.dev/) provide the desktop application and interface frameworks.

NanamiWork also connects to services from [Google Antigravity](https://antigravity.google/), [OpenAI](https://openai.com/), and [GitHub Copilot](https://github.com/features/copilot). These are independent products, and their inclusion does not imply endorsement or affiliation.

These projects and their dependencies retain their own licenses and notices. See the [Documents third-party notices](./packages/documents/THIRD_PARTY_NOTICES.md) for that package's dependencies.
