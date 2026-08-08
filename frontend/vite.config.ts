import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

const HISTORICAL_V0_2_ADDRESS = '0xFf546d6B1CD45d2859a705a7FA181807670B9015'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const fileEnvironment = loadEnv(mode, process.cwd(), '')
  const configuredAddress = (
    process.env.VITE_CONTRACT_ADDRESS
    ?? fileEnvironment.VITE_CONTRACT_ADDRESS
    ?? ''
  ).trim()
  if (configuredAddress.toLowerCase() === HISTORICAL_V0_2_ADDRESS.toLowerCase()) {
    throw new Error('The historical ContentBounty v0.2 address is incompatible with the v2.1.1 frontend build.')
  }
  return {
    plugins: [vue()],
  }
})
