import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * The vendored images live in public/ so the dev server can serve them, and Vite copies
 * everything in public/ into the build. In production they come from R2 instead, so copying
 * them is not merely wasteful: dist/ came to 23,217 files and 408 MB, and Workers refuses an
 * asset directory over 20,000 files, so the deploy would fail outright rather than just
 * uploading 352 MB it already has.
 *
 * Removing them after the copy, rather than moving them out of public/, keeps one source of
 * truth for the dev server and costs a directory delete at the end of a build.
 */
function dropVendoredImages(): Plugin {
  const dirs = ['cards', 'cards-hi', 'logos', 'sprites', 'artwork']
  return {
    name: 'drop-vendored-images',
    apply: 'build',
    closeBundle() {
      const out = resolve(__dirname, 'dist')
      for (const d of dirs) rmSync(resolve(out, d), { recursive: true, force: true })
      // The foil overlay lab is a scratch page for looking at rarity treatments. It is not
      // part of the app and has no business on a public origin.
      rmSync(resolve(out, 'foil-lab.html'), { force: true })
    },
  }
}

// The port comes from the environment so a second checkout (a git worktree used for trying
// things out) can run at the same time as this one without colliding. Set CLIENT_PORT in
// client/.env.local, which is gitignored, so each checkout keeps its own.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss(), dropVendoredImages()],
    server: {
      port: Number(env.CLIENT_PORT) || 5173,
      // Fail rather than slide to the next free port, so two checkouts cannot quietly
      // end up sharing one and leave you unsure which is which.
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
        //
        // public/cards-hi is deliberately absent from this list. It fills at runtime, one file
        // per card someone opens, and the card view swaps to each new file the moment the
        // server reports it — which only works if Vite can see a file it did not start with.
        ignored: ["**/public/cards/**", "**/public/artwork/**", "**/public/sprites/**"],
      },
    },
  }
})
