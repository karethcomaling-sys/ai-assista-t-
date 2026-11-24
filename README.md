# Hey Assistant AI — Windows 11 Voice Assistant

**Hey Assistant AI** is a full-stack voice-controlled personal assistant built with React, Node.js, Express, WebSockets, and the Google Gemini Live API (`@google/genai`), designed to run locally on Windows 11 and package cleanly into a desktop executable using Electron.

## Features

- **Multilingual Voice & Auto-Detection**: Speaks and understands **English**, **Filipino / Tagalog**, and **Cebuano / Bisaya**, automatically detecting your spoken language and responding in the same language.
- **Real-Time Gemini Live API (`gemini-3.8-live`)**: Low-latency bidirectional 16kHz PCM microphone input and 24kHz PCM spoken output over a secure server-side WebSocket bridge (`GEMINI_API_KEY` stays strictly on the server).
- **Hands-Free & Fallback Controls**:
  - Wake phrase listener (`"Hey Assistant"`)
  - Large microphone button for continuous conversation
  - Push-to-Talk fallback (`Hold to Talk` button or `Spacebar`)
  - Instant interruption (barge-in or `Interrupt Assistant` button)
  - Live conversation transcripts & searchable local history
  - Text fallback via `gemini-4-hydrogen`
- **Secure Windows 11 Command Allowlist**:
  - Open **Notepad**, **Calculator**, and **Google Chrome**
  - Open validated public `https://` / `http://` websites and **Google Search**
  - Read current local **time & date**
  - Increase, decrease, mute, and unmute system **volume**
  - Check and control device **flashlight** only when compatible Windows hardware exists
  - **Safety Gate**: Never runs arbitrary terminal commands; always requires explicit confirmation before sensitive actions (messages, calls, file deletions, purchases)
- **Desktop Preferences**:
  - Selectable Gemini voices (`Zephyr`, `Puck`, `Kore`, `Fenrir`, `Charon`)
  - Configurable system prompt
  - Microphone hardware test with live dB level meter and 2.5s record-and-playback check
  - **Start with Windows** and **Minimize to System Tray** options

---

## Project Architecture

```text
├── server.ts                  # Express + Vite/static server entry point (port 3000)
├── server/
│   ├── geminiClient.ts        # Server-side @google/genai initialization & tool definitions
│   ├── liveBridge.ts          # WebSocket bridge (/ws/live) to Gemini Live API
│   ├── windowsCommands.ts     # Strict Windows 11 allowlisted command runner & safety gates
│   └── storage.ts             # Local JSON persistence (.hey-assistant-data/)
├── electron/
│   ├── main.cjs               # Electron desktop window, Windows tray, & startup hook
│   └── preload.cjs            # Context-isolated IPC bridge
├── src/
│   ├── App.tsx                # Main dark console layout & live voice interface
│   ├── hooks/useVoiceAssistant.ts  # AudioContext 16kHz/24kHz PCM, WS reconnect, wake word
│   ├── components/            # MicTestModal, CommandConsoleView, HistoryView, SettingsView
│   ├── utils/                 # PCM audio encoding/decoding & language detector
│   └── types/assistant.ts     # Shared TypeScript interfaces & defaults
```

---

## Windows 11 Local Installation & Setup

### Prerequisites
1. **Windows 11** (64-bit)
2. **Node.js 22.14+** (Download from [nodejs.org](https://nodejs.org/))
3. A **Google Gemini API Key**

### 1. Export / Clone the Project
If exporting from AI Studio, download the project ZIP and extract it to a local folder such as `C:\Projects\hey-assistant-ai`.

Open **Windows Terminal** or **PowerShell** inside the project folder:
```powershell
cd C:\Projects\hey-assistant-ai
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` in the project root:
```powershell
Copy-Item .env.example .env
```
Edit `.env` and set your Gemini API key:
```env
GEMINI_API_KEY="your_actual_gemini_api_key_here"
PORT=3000
```
> **Security Note:** Never put `GEMINI_API_KEY` into `VITE_*` variables or frontend files. The Node.js backend reads it directly from `process.env.GEMINI_API_KEY`.

### 3. Grant Windows 11 Microphone Permission
Open **Windows Settings → Privacy & security → Microphone** and ensure:
- **Microphone access** is **On**
- **Let apps access your microphone** is **On**
- **Let desktop apps access your microphone** is **On**

### 4. Run Locally on Windows 11
Start the development server (runs backend + frontend on `http://localhost:3000`):
```powershell
npm run dev
```
Or build the frontend for production and run with Node.js:
```powershell
npm run build
npm start
```
Then open `http://localhost:3000` in Microsoft Edge or Google Chrome.

---

## Packaging as a Windows 11 Desktop App (Electron)

To run and package **Hey Assistant AI** as a native Windows 11 desktop application with System Tray support and Start with Windows:

### 1. Install Electron & Electron Builder (Dev Dependencies)
```powershell
npm install -D electron electron-builder
```

### 2. Build Frontend and Bundled Server
```powershell
npm run build
npm run build:server
```
This builds `dist/` (React UI) and `dist-server/server.mjs` (Express + WebSocket server), which `electron/main.cjs` automatically prefers when launching in Electron.

### 3. Run in Electron Desktop Mode Locally
Start the local server and launch Electron:
```powershell
npx electron .
```
Or run the server separately in another terminal:
```powershell
$env:SKIP_INTERNAL_SERVER="1"; npm start
# In a second terminal:
npx electron .
```

### 4. Export a Windows 11 Installer (`.exe`)
Add an `electron-builder` configuration to `package.json`:
```json
"build": {
  "appId": "com.heyassistant.ai",
  "productName": "Hey Assistant AI",
  "directories": {
    "output": "release"
  },
  "files": [
    "dist/**/*",
    "dist-server/**/*",
    "electron/**/*",
    "package.json"
  ],
  "win": {
    "target": ["nsis", "portable"]
  }
}
```
Then package the Windows `.exe` installer:
```powershell
npm run build
npm run build:server
npx electron-builder --win
```
Your Windows 11 installer and portable executable will be generated inside the `release/` folder.
