# Temp-Transfer ⚡

A minimalist, high-speed web application for quickly sharing and transferring temporary text snippets across devices and users, with automatic 24-hour expiration, direct one-click copy buttons, and community-wide real-time sync.

🌐 **Live**: [temptransfer.vercel.app](https://temptransfer.vercel.app)

---

## ✨ Features

- **Community Sync**: All text snippets are shared in real-time across all users and devices. Add text on one device, see it everywhere.
- **Direct One-Click Copy**: Every saved text card has a prominent "Copy Text" button that immediately copies text to clipboard with instant visual feedback.
- **24-Hour Auto-Clear**: All saved snippets automatically self-destruct exactly 24 hours after creation. Active real-time countdown timer is displayed on every card.
- **Clear Text Box**: Dedicated "Clear Box" button to wipe the input field instantly.
- **Quick Keyboard Shortcuts**: Press `Ctrl + Enter` (or `Cmd + Enter`) to instantly add text.
- **QR Code Transfer**: Scan any text card with your phone's camera to transfer the text directly to mobile.
- **Dark & Light Mode**: Clean, glassmorphic UI with responsive mobile-friendly layouts.

> **Note**: This is a community clipboard — all texts are visible to anyone visiting the site. Do not share sensitive information like passwords or private keys.

---

## 🚀 Running Locally

```bash
npm install
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

### Environment Variables
Set these in your Vercel project settings:
- `BLOB_READ_WRITE_TOKEN` — Your Vercel Blob storage token
