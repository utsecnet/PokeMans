import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Ports come from the environment so a second checkout (a git worktree used for trying
// things out) can run at the same time as this one without colliding. Set them in
// client/.env.local and server/.env, both gitignored, so each checkout keeps its own.
//
// Defaults match the stable checkout: API on 4000, client on 5173.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiPort = env.API_PORT || '4000'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(env.CLIENT_PORT) || 5173,
      // Fail rather than slide to the next free port. A checkout that was never given a
      // CLIENT_PORT lands on an occupied 5173, quietly moves to 5174, and looks fine — until
      // its /api calls go nowhere, because the proxy below still points at this checkout's
      // own API port. Better to refuse to start and say why.
      strictPort: true,
      watch: {
        // The vendored image sets are static: 20,000+ files that cannot change during a dev
        // session, because only the vendor scripts write them. Watching them cost Vite a
        // gigabyte of resident memory and got the card vendor OOM-killed three times while it
        // wrote into public/ — the watcher grew faster than the download progressed.
        //
        // The trade: files added to these directories while the server is up are invisible to
        // it until a restart — requests for them fall through to the SPA index and arrive as
        // text/html. Restart after any vendor run.
        ignored: ["**/public/cards/**", "**/public/artwork/**", "**/public/sprites/**"],
      },
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
  }
})
