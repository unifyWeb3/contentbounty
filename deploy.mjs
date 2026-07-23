import { createClient, createAccount } from './frontend/node_modules/genlayer-js/dist/index.js'
import { studionet } from './frontend/node_modules/genlayer-js/dist/chains/index.js'
import { readFileSync } from 'fs'

const PRIVATE_KEY = process.argv[2]
if (!PRIVATE_KEY || !/^0x[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) {
  console.error('Usage: node deploy.mjs 0xYOUR_PRIVATE_KEY')
  process.exit(1)
}

const account = createAccount(PRIVATE_KEY)
const client = createClient({ chain: studionet })
const code = readFileSync('./contracts/content_bounty.py', 'utf8')

console.log('Deploying from:', account.address)
console.log('Deploying to studionet (studio.genlayer.com)...')

try {
  const tx = await client.deployContract({ account, code, args: [] })
  console.log('Tx submitted:', tx)
  console.log('Waiting for receipt...')
  const receipt = await client.waitForTransactionReceipt({ hash: tx, retries: 40, interval: 3000 })
  const address = receipt?.data?.contract_address
    ?? receipt?.contractAddress
    ?? receipt?.result?.contract_address
  if (address) {
    console.log('\n✅ DEPLOYED!')
    console.log('VITE_CONTRACT_ADDRESS=' + address)
    console.log('Explorer: https://explorer-studio.genlayer.com/address/' + address)
    console.log('\nNext: put that address in frontend/.env, then `cd frontend && npm run dev`.')
  } else {
    console.log('\nNo contract address in receipt:')
    console.log(JSON.stringify(receipt, null, 2))
  }
} catch (e) {
  console.error('Error:', e?.message ?? e)
}
