<p align="center">
  <h1 align="center">🌸 NanamiWork</h1>
  <p align="center">
    <strong>An AI pair-programming and desktop agent workspace powered by Google Antigravity, Nanami Gateway, and OpenCode.</strong>
  </p>
  <p align="center">
    <a href="https://github.com/JmDemisana/nami-openwork/releases"><img src="https://img.shields.io/github/v/release/JmDemisana/nami-openwork?color=emerald&label=Release" alt="Latest Release" /></a>
    <a href="https://github.com/JmDemisana/nami-openwork/blob/dev/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License" /></a>
    <a href="https://nanami-ai.pages.dev"><img src="https://img.shields.io/badge/Powered%20By-Nanami%20AI-pink.svg" alt="Nanami AI" /></a>
  </p>
</p>

---

## 🌟 Overview

**NanamiWork** is a high-performance, distraction-free desktop environment for AI agent coding, pair-programming, and system execution. Built as an authentic derivative of [OpenWork](https://github.com/different-ai/openwork) and [OpenCode](https://opencode.ai), NanamiWork brings first-class **Google Antigravity multi-account management**, live quota tracking, and the **Nanami AI Gateway** directly to your desktop.

---

## ✨ Key Features

### 1. 🛡️ Multi-Account Antigravity Integration
- **Direct 1-Click Google OAuth**: Seamlessly authenticate multiple Antigravity accounts directly through your browser on port `51121`.
- **Authentic Google Quota Buckets**: Live tracking of official quota buckets via Google's `retrieveUserQuotaSummary` API:
  - Gemini Flash & Pro weekly buckets
  - Claude Sonnet 4.6 & Claude Opus 4.6 weekly and 5-hour rolling limits
  - GPT-OSS 120B weekly buckets
  - Argon weekly quotas
- **Multi-Account Auto-Rotation**: Automatic quota balancing across accounts powered by the `opencode-antigravity-auth` plugin with custom quota thresholds.
- **Verification Guidance**: Native actionable detection for fresh Google accounts requiring first-time Antigravity confirmation.

### 2. 🔒 Nanami Router Gateway (Server-Side PIN Gate)
- Pre-configured access to Nanami AI's curated model ladder:
  - `gemini-router` (Frontier Flash round-robin pool)
  - `openrouter-auto` (Curated open-weights pool)
  - `uncensored` (NoTrack privacy-first model)
- **Zero Secrets on Client**: Gate PIN verification is enforced entirely server-side via `nanami-ai.pages.dev`, preserving security and open-source derivative compliance.
- Unlocked for contributors donating three platform keys or holding the Gate PIN.

### 3. ⏪ "Undo Up to This Point" (Chat Timeline Rewind)
- Replaces standard destructive reverts with an intuitive, non-destructive workflow:
  - Reverts and hides the selected message and all subsequent agent responses.
  - Automatically pastes the original user prompt back into the composer.
  - Immediately shifts cursor focus to the composer for quick adjustments and resending.

### 4. 🗄️ 100% Conflict-Free Standalone Engine
- **Sandboxed Configuration**: Stores all configs, accounts, and session data in `~/.config/nanamiwork`.
- **Zero OpenCode Collisions**: Spawns its own isolated sidecar engine (`opencode.exe` / `opencode2.exe`). Never touches or collides with existing global OpenCode CLI setups (`~/.config/opencode`).
- **Zero Global Dependencies**: Bundles its own runtime, sidecars, and tools—no prior installation of Node, Python, or OpenCode required on target machines.

---

## 📥 Downloads & Installation

Prebuilt standalone binaries are provided for every major platform on the [**Releases Page**](https://github.com/JmDemisana/nami-openwork/releases):

| Platform | Format | Description |
| :--- | :--- | :--- |
| **Windows** | `.exe` | Windows 10/11 standalone NSIS installer |
| **Linux (Debian / Ubuntu)** | `.deb` | Standard Debian / Ubuntu package (`dpkg -i`) |
| **Linux (Universal)** | `.AppImage` | Portable executable for all Linux distributions |
| **macOS** | `.dmg` / `.zip` | Apple Silicon (`arm64`) & Intel (`x64`) bundles |

---

## 🚀 Getting Started

1. **Launch NanamiWork** from your applications menu or desktop shortcut.
2. **Add an Antigravity Account**:
   - Open the model selector and click **+ Add Antigravity Account**.
   - Your browser will open the official Google authentication portal.
   - Complete sign-in, and your account and quotas will immediately reflect in the picker!
3. **Switch to Nanami Router Models**:
   - Select any model under the **Nanami** provider.
   - Enter your Gate PIN to verify server-side and begin chatting.

---

## 🛠️ Building from Source

```bash
# Clone the repository
git clone https://github.com/JmDemisana/nami-openwork.git
cd nami-openwork

# Install dependencies (Node 24+, pnpm 11+)
pnpm install

# Build the Electron application
pnpm --filter @openwork/desktop build:electron

# Package for your platform
pnpm --dir apps/desktop exec electron-builder --config electron-builder.yml
```

---

## 📄 License & Attribution

NanamiWork is licensed under the [MIT License](./LICENSE).  
Derived with ❤️ from [OpenWork](https://github.com/different-ai/openwork) by Different AI and [OpenCode](https://opencode.ai) by Anomaly.
Nanami personality and gateway integrations provided by the [Nanami Project](https://nanami-ai.pages.dev).
