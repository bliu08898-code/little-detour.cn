import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const vite = join(root, 'node_modules', '.bin', 'vite')
const processes = [
  spawn(process.execPath, ['server/index.mjs'], { cwd: root, stdio: 'inherit' }),
  spawn(vite, ['--host', '127.0.0.1'], { cwd: root, stdio: 'inherit' }),
]

function stop() {
  for (const child of processes) child.kill('SIGTERM')
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
process.on('exit', stop)

await Promise.all(processes.map((child) => new Promise((resolve) => child.on('exit', resolve))))
