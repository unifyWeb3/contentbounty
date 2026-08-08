import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HISTORICAL_V0_2_ADDRESS = '0xFf546d6B1CD45d2859a705a7FA181807670B9015'

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

export function verifyFrontendBundle(directory) {
  const root = resolve(directory)
  if (!statSync(root).isDirectory()) throw new Error('Frontend bundle directory does not exist: ' + root)
  const files = filesUnder(root)
  const needle = HISTORICAL_V0_2_ADDRESS.toLowerCase()
  const offenders = files.filter((path) => {
    const content = readFileSync(path)
    return content.toString('utf8').toLowerCase().includes(needle)
  })
  if (offenders.length) {
    throw new Error('Historical v0.2 address embedded in frontend bundle: ' + offenders.join(', '))
  }
  return { directory: root, filesScanned: files.length, historicalAddressEmbedded: false }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(verifyFrontendBundle(process.argv[2] || 'frontend/dist'), null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
