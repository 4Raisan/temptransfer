# Temp-Transfer ⚡

A minimalist, high-speed web application for quickly storing and transferring temporary text snippets between devices with automatic 24-hour expiration, direct one-click copy buttons, and an input clear button.

🌐 **Live on Vercel**: Ready for deployment to `temptransfer.vercel.app`

---

## ✨ Features

- **Direct One-Click Copy**: Every saved text card has a prominent "Copy Text" button that immediately copies text to clipboard with instant visual feedback.
- **24-Hour Auto-Clear**: All saved snippets automatically self-destruct exactly 24 hours after creation. Active real-time countdown timer is displayed on every card.
- **Clear Text Box**: Dedicated "Clear Box" button to wipe the input field instantly.
- **Quick Keyboard Shortcuts**: Press `Ctrl + Enter` (or `Cmd + Enter`) to instantly add text.
- **QR Code Transfer**: Scan any text card with your phone's camera to transfer the text directly to mobile.
- **Privacy First**: All data is stored securely in the browser; no tracking, no persistent database bloat.
- **Dark & Light Mode**: Clean, glassmorphic UI with responsive mobile-friendly layouts.

---

## 🚀 Running Locally

```bash
# Start local server (no dependencies required)
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ☁️ Deploying to Vercel

### Option 1: Via Vercel CLI
```bash
npx vercel
```
Follow the quick prompts:
1. Set project name: `temptransfer`
2. Deploy to production: `npx vercel --prod`

### Option 2: Via GitHub Integration
1. Push this repository to GitHub:
   ```bash
   git add .
   git commit -m "Initial commit for Temp-Transfer"
   gh repo create temptransfer --public --source=. --push
   ```
2. Import the repository in [vercel.com/new](https://vercel.com/new).
3. Set Project Name to `temptransfer`.
4. Click **Deploy**. Vercel will assign `temptransfer.vercel.app`.
