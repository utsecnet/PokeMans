import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * Things that live in public/ for the dev server and have no business in the build.
 *
 * Vite copies everything under public/ into dist, which is right for a favicon and wrong
 * for both of these.
 *
 * The vendored images come from R2 in production, so copying them is not merely wasteful:
 * dist/ came to 23,217 files and 408 MB, and Workers refuses an asset directory over 20,000
 * files, so the deploy failed outright rather than just uploading 352 MB it already had.
 *
 * admin-lab is the console layout proposals. They are local prototypes with a snapshot of
 * real figures baked in -- storage, row counts, set coverage -- and nothing links to them,
 * so shipping them would put an unfinished admin console on a public origin where only the
 * filename kept anyone out. The build check in CI would not have caught it either: six
 * files is nowhere near the 500 that fails a build.
 *
 * Removing them after the copy, rather than keeping them outside public/, leaves one source
 * of truth for the dev server and costs a directory delete at the end of a build.
 */
function dropFromBuild(): Plugin {
  const dirs = ['cards', 'cards-hi', 'logos', 'sprites', 'artwork', 'admin-lab']
  return {
    name: 'drop-from-build',
    apply: 'build',
    closeBundle() {
      const out = resolve(import.meta.dirname, 'dist')
      for (const d of dirs) rmSync(resolve(out, d), { recursive: true, force: true })
    },
  }
}

// The port comes from the environment so a second checkout (a git worktree used for trying
// things out) can run at the same time as this one without colliding. Set CLIENT_PORT in
// client/.env.local, which is gitignored, so each checkout keeps its own.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss(), dropFromBuild()],
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
