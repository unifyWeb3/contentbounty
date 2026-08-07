import { createClient, createAccount } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { readFileSync } from 'fs'

const PRIVATE_KEY = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY
if (!PRIVATE_KEY || !/^0x[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) {
  console.error('Set GENLAYER_DEPLOYER_PRIVATE_KEY to a 0x-prefixed 32-byte key.')
  process.exit(1)
}

const account = createAccount(PRIVATE_KEY)
const client = createClient({ chain: studionet })
const code = readFileSync('./contracts/content_bounty.py', 'utf8')

console.log('Deploying from:', account.address)
console.log('Deploying ContentBounty v2 to Studionet...')

try {
  const tx = await client.deployContract({ account, code, args: [] })
  console.log('Tx submitted:', tx)
  console.log('Waiting for receipt...')
  const receipt = await client.waitForTransactionReceipt({
    hash: tx,
    status: 'FINALIZED',
    retries: 120,
    interval: 3000,
  })
  const address = receipt?.data?.contract_address
    ?? receipt?.contractAddress
    ?? receipt?.result?.contract_address
  if (address) {
    console.log('\nDEPLOYED AND FINALIZED')
    console.log('VITE_CONTRACT_ADDRESS=' + address)
    console.log('Explorer: https://explorer-studio.genlayer.com/address/' + address)
    console.log('\nRecord both the address and transaction hash in IMPLEMENTATION_LOG.md.')
  } else {
    console.log('\nNo contract address in receipt:')
    console.log(JSON.stringify(receipt, null, 2))
  }
} catch (e) {
  console.error('Error:', e?.message ?? e)
}
