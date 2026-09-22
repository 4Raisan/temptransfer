---
name: deploy-to-vercel
description: Automatically build, configure, commit, deploy web apps directly to Vercel production, and perform automated live post-deployment verification.
---

# Deploy to Vercel Skill

Use this instruction protocol when the user asks to deploy, publish, or host a web project on Vercel with autonomous verification.

## 1. Pre-Flight Environment Checks
Before running build or deploy commands, inspect the environment:
- **Git Repository**: Check if `.git` exists in the project root. If not, run `git init`.
- **GitHub CLI**: Check `gh auth status`. If authenticated and a GitHub repo is desired, prepare to push using `gh repo create <project-name> --public --source=. --remote=origin --push`.
- **Vercel CLI**: Check if Vercel CLI is available or authenticated via `npx --yes vercel whoami`. If needed, install locally via `npm install --save-dev vercel`.

---

## 2. Configuration & Architecture Best Practices

### Avoid the Common Pitfall: `FUNCTION_INVOCATION_FAILED`
When deploying a Node-based or hybrid app to Vercel:
1. Never call `server.listen(PORT)` unconditionally at the top level in serverless mode.
2. Export a standard handler function:
   ```javascript
   module.exports = (req, res) => { /* request handler */ };

   // Only listen if executed standalone locally:
   if (require.main === module) {
     const http = require('http');
     http.createServer(module.exports).listen(process.env.PORT || 3000);
   }
   ```
3. In `vercel.json`, use clean rewrites to map incoming traffic cleanly:
   ```json
   {
     "rewrites": [
       { "source": "/(.*)", "destination": "/server.js" }
     ]
   }
   ```
4. Set `"main": "server.js"` in `package.json` so Vercel detects the server entrypoint unambiguously.
5. Create `.vercelignore` to exclude `node_modules` and `.git`:
   ```
   node_modules
   .git
   ```

---

## 3. Production Deployment Execution
Deploy non-interactively to production:

```bash
# Using local devDependency
node ./node_modules/vercel/dist/index.js deploy --prod --yes

# Or using npx
npx vercel deploy --prod --yes
```

Monitor the deployment task output until Vercel reports:
- `✓ Build complete`
- `▲ Aliased https://<project-name>.vercel.app`
- `readyState: READY`

---

## 4. Mandatory Post-Deployment Live Verification
Never assume deployment succeeded without testing the live URL. Immediately run an automated check:

```powershell
$res = Invoke-WebRequest -Uri "https://<your-project>.vercel.app" -UseBasicParsing
Write-Output "Status: $($res.StatusCode)"
```

- If status is `200 OK`, verify that static assets (`/style.css`, `/script.js`, `/favicon.svg`) and APIs also return `200`.
- If an error occurs (e.g., `FUNCTION_INVOCATION_FAILED` or 404), inspect the Vercel deployment log, fix the routing/handler in code, commit, and redeploy until the live site returns `200 OK`.
