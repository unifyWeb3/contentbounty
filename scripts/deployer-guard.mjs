export const COMPROMISED_DEPLOYER_ADDRESSES = Object.freeze([
  '0x3211d1419709682b81c53cc51cb63622e25488d3',
  '0x3d5915888e60cdaffbb1f94deeb71694f5de2a5d',
])

export function assertSafeDeployerAddress(address, label = 'deployer') {
  const normalized = typeof address === 'string' ? address.toLowerCase() : ''
  if (COMPROMISED_DEPLOYER_ADDRESSES.includes(normalized)) {
    throw new Error(`Configured ${label} is a compromised account and must not sign`)
  }
  return address
}

export function assertSafeDeployerAccount(account, label = 'deployer') {
  if (!account?.address) throw new Error(`Configured ${label} account has no address`)
  assertSafeDeployerAddress(account.address, label)
  return account
}
