<template>
  <div class="app">

    <!-- ── HEADER ─────────────────────────────────── -->
    <header class="header">
      <div class="header-inner">
        <div class="logo">
          <span class="logo-mark">◈</span>
          <span class="logo-text">ContentBounty</span>
          <span class="logo-tag">GenLayer</span>
        </div>
        <nav class="nav">
          <button v-for="t in mainTabs" :key="t.id" class="nav-btn"
            :class="{ active: activeTab === t.id }" @click="activeTab = t.id">
            {{ t.label }}
          </button>
          <button v-if="isAdmin" class="nav-btn nav-admin"
            :class="{ active: activeTab === 'admin' }" @click="activeTab = 'admin'">
            ⚙ Admin
          </button>
        </nav>
        <div class="wallet-area">
          <div v-if="connected" class="wallet-menu">
            <button class="wallet-trigger" :class="{ open: walletMenuOpen }"
              @click="walletMenuOpen = !walletMenuOpen" :title="walletAddress">
              <span class="wt-dot"></span>
              <span class="wt-addr">{{ shortAddr(walletAddress) }}</span>
              <span class="wt-bal">{{ balance }} GEN</span>
              <span class="wt-caret">▾</span>
            </button>
            <div v-if="walletMenuOpen" class="wallet-backdrop" @click="walletMenuOpen = false"></div>
            <Transition name="fade">
              <div v-if="walletMenuOpen" class="wallet-dropdown">
                <div class="wd-section">
                  <span class="wd-label">Connected wallet</span>
                  <span class="wd-full">{{ walletAddress }}</span>
                </div>
                <div class="wd-balrow">
                  <div>
                    <span class="wd-label">Balance</span>
                    <span class="wd-bal">{{ balance }} GEN</span>
                  </div>
                  <button class="btn-icon" @click="refreshBalance" title="Refresh balance">↻</button>
                </div>
                <button class="wd-item" @click="copyAddress">
                  <span>⧉</span> {{ copiedAddr ? 'Copied!' : 'Copy address' }}
                </button>
                <a class="wd-item" :href="explorerUrl" target="_blank" rel="noopener noreferrer"
                  @click="walletMenuOpen = false">
                  <span>↗</span> View on explorer
                </a>
                <button class="wd-item wd-danger" @click="disconnect(); walletMenuOpen = false">
                  <span>⏻</span> Disconnect
                </button>
              </div>
            </Transition>
          </div>
          <button v-else class="btn-connect-wallet" @click="showWalletModal = true">
            Connect Wallet
          </button>
        </div>
      </div>
    </header>

    <!-- ── WALLET MODAL ───────────────────────────── -->
    <Transition name="fade">
      <div v-if="showWalletModal" class="modal-overlay" @click.self="showWalletModal = false">
        <div class="modal-card">
          <div class="modal-head">
            <div>
              <h2 class="modal-title">Connect to ContentBounty</h2>
              <p class="modal-sub">GenLayer uses its own wallet _ funded once from the faucet</p>
            </div>
            <button class="btn-close" @click="showWalletModal = false">✕</button>
          </div>

          <div v-if="!walletView" class="wallet-options">
            <button class="wallet-option" @click="createNewWallet">
              <span class="wo-icon">✦</span>
              <div>
                <div class="wo-title">Create new wallet</div>
                <div class="wo-sub">Generate a fresh GenLayer account</div>
              </div>
            </button>
            <button class="wallet-option" @click="walletView = 'import'">
              <span class="wo-icon">⬆</span>
              <div>
                <div class="wo-title">Import existing wallet</div>
                <div class="wo-sub">Paste your private key to restore</div>
              </div>
            </button>
          </div>

          <div v-if="walletView === 'import'" class="wallet-import-form">
            <button class="btn-back" @click="walletView = null">← Back</button>
            <label class="field-label">Private key</label>
            <input v-model="importKeyInput" class="input" type="text"
              placeholder="0x... (64 hex characters)" autocomplete="new-password" spellchecker:false/>
            <p v-if="walletError" class="modal-error">{{ walletError }}</p>
            <button class="btn-primary w-full mt-16" @click="importWallet"
              :disabled="!importKeyInput">Import & Connect</button>
          </div>

          <div v-if="walletView === 'created'" class="wallet-created">
            <div class="created-check">✓</div>
            <h3 class="created-title">Wallet created!</h3>
            <p class="created-addr">{{ walletAddress }}</p>
            <div class="created-faucet">
              <p>Fund your wallet with free GEN to start posting bounties:</p>
              <a href="https://testnet-faucet.genlayer.foundation/" target="_blank" class="faucet-btn">
                Claim 100 GEN from faucet →
              </a>
            </div>
            <div class="created-export">
              <p class="export-warn">Save your private key _ you'll need it to restore your wallet on another device:</p>
              <div class="key-box">{{ exportKey }}</div>
              <button class="btn-copy" @click="copyKey">{{ copied ? '✓ Copied' : 'Copy key' }}</button>
            </div>
            <button class="btn-primary w-full mt-16" @click="showWalletModal = false; walletView = null">
              Done _ let's go
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── FAUCET BANNER _ hidden on studionet (balance always 0 there) -->
    <div v-if="false && connected && needsFaucet" class="faucet-banner">
      <span>⚡ Balance low - fund your wallet to post bounties</span>
      <a href="https://testnet-faucet.genlayer.foundation/" target="_blank" class="faucet-link">Claim 100 GEN →</a>
      <span class="faucet-addr">{{ walletAddress }}</span>
    </div>

    <main class="main">

      <!-- ── BROWSE ─────────────────────────────── -->
      <section v-if="activeTab === 'browse'">
        <div class="section-head">
          <div>
            <h1 class="section-title">Open Bounties</h1>
            <p class="section-sub">Submit your content. If the AI approves _ you get paid instantly.</p>
          </div>
          <button class="btn-ghost" @click="loadBounties" :disabled="loading">
            {{ loading ? 'Loading…' : 'Refresh' }}
          </button>
        </div>

        <div v-if="loading" class="state-row"><span class="pulse">Fetching on-chain data…</span></div>
        <div v-else-if="bountiesError" class="empty-state error-state">
          <span class="ei">⚠</span>
          <p>Couldn't load bounties.</p>
          <p class="es-detail">{{ bountiesError }}</p>
          <button class="btn-primary" @click="loadBounties">Try again</button>
        </div>
        <div v-else-if="bounties.length === 0" class="empty-state">
          <span class="ei">◌</span>
          <p>No open bounties yet. Be the first to post one.</p>
          <button class="btn-ghost" @click="activeTab = 'post'">Post a bounty</button>
        </div>

        <div v-else class="bounty-grid">
          <div v-for="b in bounties" :key="b.id" class="bounty-card"
            :class="{ selected: selectedId === b.id }" @click="selectBounty(b)">
            <div class="card-top">
              <span class="bid">#{{ b.id }}</span>
              <span class="badge" :class="'badge-' + b.status">{{ b.status }}</span>
            </div>
            <h2 class="card-title">{{ b.title }}</h2>
            <p class="card-desc">{{ b.description }}</p>
            <div class="card-foot">
              <span class="reward-pill">{{ formatGEN(b.reward) }} GEN</span>
              <span class="poster">{{ shortAddr(b.poster) }}</span>
            </div>
          </div>
        </div>

        <!-- Bounty drawer -->
        <Transition name="slide">
          <div v-if="selectedBounty" class="drawer">
            <div class="drawer-head">
              <div>
                <h3 class="drawer-title">{{ selectedBounty.title }}</h3>
                <p class="drawer-poster">By {{ shortAddr(selectedBounty.poster) }}</p>
              </div>
              <button class="btn-close" @click="selectedBounty = null; selectedId = null">✕</button>
            </div>

            <div class="drawer-row">
              <div class="dstat">
                <label class="field-label">Reward locked</label>
                <span class="dstat-val yellow">{{ formatGEN(selectedBounty.reward) }} GEN</span>
              </div>
              <div class="dstat">
                <label class="field-label">Status</label>
                <span class="dstat-val" :class="'c-' + selectedBounty.status">{{ selectedBounty.status }}</span>
              </div>
            </div>

            <div class="drawer-section">
              <label class="field-label">Description</label>
              <p class="drawer-text">{{ selectedBounty.description }}</p>
            </div>

            <div class="drawer-section">
              <label class="field-label">Acceptance criteria</label>
              <div class="criteria-box">{{ selectedBounty.criteria }}</div>
            </div>

            <div v-if="selectedBounty.status === 'open'" class="submit-box">
              <label class="field-label">Submit your content URL</label>
              <div v-if="!connected" class="submit-gated">
                <p>Connect your wallet to submit</p>
                <button class="btn-primary" @click="showWalletModal = true">Connect Wallet</button>
              </div>
              <div v-else class="input-row">
                <input v-model="submitUrl" class="input" type="url"
                  placeholder="https://your-article-or-thread.com" />
                <button class="btn-primary" @click="doSubmit(selectedBounty.id)"
                  :disabled="submitting || !submitUrl">
                  {{ submitting ? 'Submitting…' : 'Submit' }}
                </button>
              </div>
            </div>

            <!-- Poster sees all submissions + can evaluate; others only see their own -->
            <div v-if="visibleSubmissions.length > 0" class="drawer-section">
              <label class="field-label">
                {{ isPoster(selectedBounty) ? `Submissions (${submissions.length})` : 'Your Submission' }}
              </label>
              <div class="sub-list">
                <div v-for="s in visibleSubmissions" :key="s.id" class="sub-item">
                  <div class="sub-top">
                    <a v-if="isPoster(selectedBounty)" :href="s.content_url" target="_blank" class="sub-url">{{ s.content_url }}</a>
                    <span v-else class="sub-url">{{ s.content_url }}</span>
                    <span class="badge" :class="'badge-' + s.status">{{ s.status }}</span>
                  </div>
                  <div class="sub-meta">
                    <span v-if="isPoster(selectedBounty)">{{ shortAddr(s.creator) }}</span>
                    <span v-if="s.status !== 'pending'">Score: {{ s.score }}/100</span>
                  </div>
                  <p v-if="s.feedback" class="sub-feedback">{{ s.feedback }}</p>
                  <!-- Only the bounty poster can trigger evaluation -->
                  <button v-if="s.status === 'pending' && isPoster(selectedBounty)" class="btn-eval"
                    @click="doEvaluate(item.sub.id, item.sub.bounty_id)" :disabled="evaluatingId !== null || manualAction">
                    {{ evaluatingId === item.sub.id ? 'AI evaluating…' : ' Evaluate this submission' }}
                  </button>

                </div>
              </div>
            </div>
          </div>
        </Transition>
      </section>

      <!-- ── POST BOUNTY ────────────────────────── -->
      <section v-if="activeTab === 'post'">
        <div class="section-head">
          <div>
            <h1 class="section-title">Post a Bounty</h1>
            <p class="section-sub">Lock your reward. AI only releases it when your criteria are met.</p>
          </div>
        </div>
        <div v-if="!connected" class="empty-state">
          <span class="ei">◌</span>
          <p>Connect your wallet first to post a bounty.</p>
          <button class="btn-primary" @click="showWalletModal = true">Connect Wallet</button>
        </div>
        <div v-else class="form-card">
          <div class="form-row">
            <label class="field-label">Title *</label>
            <input v-model="form.title" class="input" placeholder="e.g. Write a thread about our staking feature" />
          </div>
          <div class="form-row">
            <label class="field-label">Description</label>
            <textarea v-model="form.description" class="textarea" rows="3" placeholder="What is this bounty about?" />
          </div>
          <div class="form-row">
            <label class="field-label">Acceptance criteria *</label>
            <p class="field-hint">The AI evaluates submissions against exactly what you write here. Be precise.</p>
            <textarea v-model="form.criteria" class="textarea mono" rows="5"
              placeholder="Must cover X… at least 400 words… factually accurate… professional tone…" />
          </div>
          <div class="form-row">
            <label class="field-label">Reward (GEN) *</label>
            <p class="field-hint">
              Locked in contract until a submission is approved.
              Balance: {{ connected ? balance + ' GEN' : '—' }}
            </p>
            <input v-model="form.rewardGEN" class="input" style="max-width:200px"
              :class="{ 'input-error': rewardExceedsBalance }"
              type="number" min="1" step="1" placeholder="e.g. 10" />
            <p v-if="connected && rewardExceedsBalance" class="field-error">
              ⚠ {{ rewardValidationMsg }}
            </p>
            <p v-else-if="connected && IS_STUDIO" class="field-note">{{ rewardValidationMsg }}</p>
          </div>
          <div class="form-foot">
            <button class="btn-primary btn-lg" @click="doPostBounty"
              :disabled="posting || !form.title || !form.criteria || !form.rewardGEN || rewardExceedsBalance">
              {{ posting ? 'Posting…' : '◈ Post & Lock Reward' }}
            </button>
          </div>
          <div v-if="postResult" class="result-box" :class="postResult.ok ? 'r-ok' : 'r-err'">
            <!-- <span v-if="postResult.ok">✓ Bounty #{{ postResult.id }} posted - reward locked on-chain</span> -->
             <span v-if="postResult.ok">✓ Bounty posted - reward locked on-chain</span>
            <span v-else>✗ {{ postResult.err }}</span>
          </div>
        </div>
      </section>

      <!-- ── MY ACTIVITY ─────────────────────── -->
      <section v-if="activeTab === 'my'">
        <div class="section-head">
          <div>
            <h1 class="section-title">My Activity</h1>
            <p class="section-sub">Your submissions and bounties you posted.</p>
          </div>
          <button class="btn-ghost" @click="loadMine" :disabled="loading">Refresh</button>
        </div>
        <div v-if="!connected" class="empty-state">
          <span class="ei">◌</span>
          <p>Connect your wallet to see your activity.</p>
          <button class="btn-primary" @click="showWalletModal = true">Connect Wallet</button>
        </div>
        <template v-else>
          <div v-if="loading && mySubmissions.length === 0 && myPostedBountySubmissions.length === 0"
            class="state-row"><span class="pulse">Loading your activity…</span></div>
          <!-- Bounties I posted that have pending submissions to evaluate -->
          <div v-if="myPostedBountySubmissions.length > 0">
            <h2 class="section-sub" style="margin:1rem 0 .5rem;font-weight:600">Bounties you posted _ pending evaluations</h2>
            <div class="mine-list">
              <div v-for="item in myPostedBountySubmissions" :key="'ps-'+item.sub.id" class="mine-card">
                <div class="mine-top">
                  <div>
                    <span class="mine-bid">Bounty #{{ item.sub.bounty_id }} · {{ item.bountyTitle }}</span>
                    <span class="sub-url mono small">{{ shortAddr(item.sub.creator) }}</span>
                  </div>
                  <span class="badge badge-lg" :class="'badge-' + item.sub.status">{{ item.sub.status }}</span>
                </div>
                <div class="mine-url" style="font-size:.8rem;margin:.25rem 0">
                  <a :href="item.sub.content_url" target="_blank">{{ item.sub.content_url }}</a>
                </div>
                <div v-if="item.sub.status !== 'pending'" class="mine-result">
                  <div class="score-ring"><span class="score-n">{{ item.sub.score }}</span></div>
                  <div class="mine-fb"><label class="field-label">AI Feedback</label><p>{{ item.sub.feedback }}</p></div>
                </div>
                <div v-if="item.sub.status === 'pending'" class="mine-pending" style="flex-direction:column;gap:.75rem;align-items:stretch">
                  <button class="btn-eval" @click="doEvaluate(item.sub.id, item.sub.bounty_id)" :disabled="evaluating || manualAction">
                    {{ evaluating ? 'AI evaluating…' : '⚡ AI Evaluate' }}
                  </button>
                  <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
                    <input v-model="manualReward[item.sub.id]" class="input" style="max-width:120px" type="number" min="1" placeholder="Reward (GEN)" />
                    <input v-model="manualFeedback[item.sub.id]" class="input" style="flex:1;min-width:140px" placeholder="Feedback message" />
                    <button class="btn-primary" style="white-space:nowrap" @click="doApprove(item.sub.id, item.sub.bounty_id)" :disabled="evaluating || manualAction || !manualReward[item.sub.id]">
                      {{ manualAction ? '…' : '✓ Approve' }}
                    </button>
                    <button class="btn-admin-cancel" @click="doReject(item.sub.id, item.sub.bounty_id)" :disabled="evaluating || manualAction">
                      {{ manualAction ? '…' : '✗ Reject' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- My own submissions to other bounties -->
          <h2 v-if="mySubmissions.length > 0" class="section-sub" style="margin:1rem 0 .5rem;font-weight:600">Your submissions</h2>
          <div v-if="!loading && mySubmissions.length === 0 && myPostedBountySubmissions.length === 0" class="empty-state">
            <span class="ei">◌</span>
            <p>No activity yet.</p>
            <button class="btn-ghost" @click="activeTab = 'browse'">Browse bounties</button>
          </div>
          <div v-if="mySubmissions.length > 0" class="mine-list">
            <div v-for="s in mySubmissions" :key="s.id" class="mine-card">
              <div class="mine-top">
                <div>
                  <span class="mine-bid">Bounty #{{ s.bounty_id }}</span>
                  <a :href="s.content_url" target="_blank" class="mine-url">{{ s.content_url }}</a>
                </div>
                <span class="badge badge-lg" :class="'badge-' + s.status">{{ s.status }}</span>
              </div>
              <div v-if="s.status !== 'pending'" class="mine-result">
                <div class="score-ring"><span class="score-n">{{ s.score }}</span></div>
                <div class="mine-fb">
                  <label class="field-label">AI Feedback</label>
                  <p>{{ s.feedback }}</p>
                </div>
              </div>
              <div v-if="s.status === 'pending'" class="mine-pending">
                <span class="pulse">Awaiting evaluation by bounty poster</span>
              </div>
            </div>
          </div>
        </template>
      </section>

      <!-- ── ADMIN DASHBOARD ────────────────────── -->
      <section v-if="activeTab === 'admin' && isAdmin">
        <div class="section-head">
          <div>
            <h1 class="section-title">Admin Dashboard</h1>
            <p class="section-sub">Manage all bounties and submissions. Only visible to your address.</p>
          </div>
          <button class="btn-ghost" @click="loadAll" :disabled="loading">Refresh all</button>
        </div>

        <div class="admin-stats">
          <div class="astat">
            <span class="astat-num">{{ allBounties.length }}</span>
            <span class="astat-label">Total bounties</span>
          </div>
          <div class="astat">
            <span class="astat-num">{{ allBounties.filter(b=>b.status==='open').length }}</span>
            <span class="astat-label">Open</span>
          </div>
          <div class="astat">
            <span class="astat-num">{{ allBounties.filter(b=>b.status==='filled').length }}</span>
            <span class="astat-label">Filled</span>
          </div>
          <div class="astat">
            <span class="astat-num">{{ totalLockedGEN }}</span>
            <span class="astat-label">GEN locked</span>
          </div>
        </div>

        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Poster</th>
                <th>Reward</th>
                <th>Status</th>
                <th>Submissions</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in allBounties" :key="b.id">
                <td class="mono">{{ b.id }}</td>
                <td>{{ b.title }}</td>
                <td class="mono small">{{ shortAddr(b.poster) }}</td>
                <td class="yellow mono">{{ formatGEN(b.reward) }}</td>
                <td><span class="badge" :class="'badge-' + b.status">{{ b.status }}</span></td>
                <td>{{ adminSubCounts[b.id] ?? 0 }}</td>
                <td>
                  <button class="btn-admin-edit" @click="openAdminEdit(b)">Edit note</button>
                  <button v-if="b.status === 'open'" class="btn-admin-cancel"
                    @click="adminCancel(b.id)">Cancel</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Admin note editor -->
        <div v-if="editingBounty" class="admin-edit-panel">
          <div class="aep-head">
            <h3>Admin note for Bounty #{{ editingBounty.id }}: {{ editingBounty.title }}</h3>
            <button class="btn-close" @click="editingBounty = null">✕</button>
          </div>
          <p class="field-hint">Notes are stored in your browser and visible only to you. Use to track amendments or flag issues.</p>
          <textarea v-model="adminNote" class="textarea" rows="4"
            placeholder="User requested criteria change: …" />
          <div class="aep-foot">
            <button class="btn-primary" @click="saveNote">Save note</button>
            <button class="btn-ghost" @click="editingBounty = null">Cancel</button>
          </div>
        </div>
      </section>

    </main>

    <!-- ── TOAST ──────────────────────────────────── -->
    <Transition name="fade">
      <div v-if="toast" class="toast" :class="'toast-' + toast.type">{{ toast.msg }}</div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
// ─────────────────────────────────────────────────
// ALL IMPORTS _ this is the critical section
// ─────────────────────────────────────────────────

import { ref, computed, onMounted, nextTick } from 'vue'
import { createClient, createAccount, generatePrivateKey } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'

// import { studionet } from 'genlayer-js/chains'


// ── Types ─────────────────────────────────────────
interface Bounty {
  id: number; title: string; description: string
  criteria: string; reward: number; status: string; poster: string
}
interface Submission {
  id: number; bounty_id: number; creator: string
  content_url: string; status: string; score: number; feedback: string
}

// ── Config ────────────────────────────────────────
const CONTRACT = import.meta.env.VITE_CONTRACT_ADDRESS
// Undefined when VITE_ADMIN_ADDRESS is unset, so isAdmin stays false (admin hidden).
// Declared (not left commented) so the isAdmin computed can't throw ReferenceError
// once a wallet connects and the && no longer short-circuits before this name.
const ADMIN_ADDR = ((import.meta.env.VITE_ADMIN_ADDRESS as string) ?? '').toLowerCase()
const STUDIO_RPC = 'https://studio.genlayer.com/api'
const PK_KEY     = 'cb_pk_v2'

// Force all eth_ calls through studio.genlayer.com/api (not window.ethereum/MetaMask)
// Passing account:{} makes genlayer-js skip the window.ethereum branch entirely
const client = createClient({ chain: studionet, account: {} as any })

// Studio/simulated networks waive fees and do not expose reliable balances,
// so balance-based validation is only meaningful on production networks.
const IS_STUDIO = (studionet as any).isStudio === true

// ── Wallet state ──────────────────────────────────
const connected      = ref(false)
const walletAddress  = ref('')
const balance        = ref('0.0000')
const balanceWei     = ref<bigint>(0n)
const balanceKnown   = ref(false)
const account        = ref<any>(null)
const showWalletModal= ref(false)
const walletView     = ref<'import'|'created'|null>(null)
const importKeyInput = ref('')
const exportKey      = ref('')
const walletError    = ref('')
const copied         = ref(false)
const walletMenuOpen = ref(false)
const copiedAddr     = ref(false)

// Block-explorer address link for the active chain (studio -> genlayer-explorer).
const explorerUrl = computed(() => {
  const base = ((studionet as any).blockExplorers?.default?.url || '').replace(/\/+$/, '')
  return base && walletAddress.value ? `${base}/address/${walletAddress.value}` : '#'
})

const isAdmin = computed(() =>
  connected.value && ADMIN_ADDR && walletAddress.value.toLowerCase() === ADMIN_ADDR
)

// ── Tab state ─────────────────────────────────────
const activeTab = ref('browse')
const mainTabs  = [
  { id: 'browse', label: 'Browse Bounties' },
  { id: 'post',   label: 'Post a Bounty'   },
  { id: 'my',     label: 'My Submissions'  },
]

// ── App state ─────────────────────────────────────
const loading       = ref(false)
const posting       = ref(false)
const submitting    = ref(false)
const evaluatingId = ref<number | null>(null)
const bounties      = ref<Bounty[]>([])
const bountiesError = ref('')
const allBounties   = ref<Bounty[]>([])
const selectedBounty= ref<Bounty|null>(null)
const selectedId    = ref<number|null>(null)
const submissions   = ref<Submission[]>([])
const mySubmissions = ref<Submission[]>([])
const submitUrl     = ref('')
const toast         = ref<{msg:string;type:string}|null>(null)
const postResult    = ref<{ok:boolean;id?:string;err?:string}|null>(null)
const form          = ref({ title:'', description:'', criteria:'', rewardGEN:'' })
const adminSubCounts= ref<Record<number,number>>({})
const editingBounty = ref<Bounty|null>(null)
const adminNote     = ref('')
const myPostedBountySubmissions = ref<{sub: Submission, bountyTitle: string}[]>([])
const manualAction  = ref(false)
const manualReward  = ref<Record<number,string>>({})
const manualFeedback= ref<Record<number,string>>({})
const needsFaucet   = computed(() => parseFloat(balance.value) < 1)
const totalLockedGEN= computed(() =>
  allBounties.value.filter(b=>b.status==='open')
    .reduce((s,b) => s + b.reward/1e18, 0).toFixed(2)
)

// Reward-vs-balance validation for the Post form.
// Reward the user typed, converted to wei (same rounding as doPostBounty).
const rewardWei = computed<bigint>(() => {
  const n = parseFloat(form.value.rewardGEN)
  if(!n || n <= 0 || !isFinite(n)) return 0n
  return BigInt(Math.round(n * 1e9)) * 1_000_000_000n
})
// Environment-aware: studio waives fees and reports 0/unreliable balances, so we
// never block there. On production networks we strictly enforce reward <= balance.
const balanceEnforced = computed(() => !IS_STUDIO && balanceKnown.value)
const rewardExceedsBalance = computed(() =>
  balanceEnforced.value && rewardWei.value > balanceWei.value
)
const rewardValidationMsg = computed(() => {
  if(rewardExceedsBalance.value)
    return `Reward exceeds your wallet balance of ${balance.value} GEN`
  if(IS_STUDIO)
    return 'Balance validation is unavailable on GenLayer Studio (fees simulated).'
  return ''
})

// ── Helpers ───────────────────────────────────────
function isPoster(b:Bounty|null){
  if(!b||!connected.value) return false
  return b.poster?.toLowerCase() === walletAddress.value?.toLowerCase()
}

// Submissions visible to current wallet:
// - poster sees all
// - others see only their own
const visibleSubmissions = computed(() => {
  if(!selectedBounty.value) return []
  if(isPoster(selectedBounty.value)) return submissions.value
  return submissions.value.filter(
    s => s.creator?.toLowerCase() === walletAddress.value?.toLowerCase()
  )
})

function shortAddr(a:string){
  if(!a||a.length<10) return a
  return a.slice(0,6)+'…'+a.slice(-4)
}
function formatGEN(wei:number|string){
  const n=Number(wei)
  if(!n) return '0'
  const g=n/1e18
  return g<0.0001 ? n+' wei' : g.toFixed(4)
}
// BigInt-safe wei -> GEN string. Avoids Number() overflow that turned large
// balances into "Infinity"; always returns a finite, fixed-decimal string.
function weiToGEN(wei:bigint, decimals=4):string{
  const base = 10n ** 18n
  const whole = wei / base
  const frac = ((wei % base) * (10n ** BigInt(decimals))) / base
  return whole.toString() + '.' + frac.toString().padStart(decimals,'0')
}
function showToast(msg:string, type='ok'){
  toast.value={msg,type}
  setTimeout(()=>{ toast.value=null },5000)
}

// ── Wallet logic ──────────────────────────────────
function activateAccount(pk:string){
  const acc = createAccount(pk as `0x${string}`)
  account.value = acc
  walletAddress.value = acc.address
  connected.value = true
  localStorage.setItem(PK_KEY, pk)
  fetchBalance()
}

function createNewWallet(){
  walletError.value = ''
  try {
    // Generate private key ourselves so we can show it to the user
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const pk = '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join('') as `0x${string}`
    exportKey.value = pk
    activateAccount(pk)
    walletView.value = 'created'
  } catch(e:any){
    walletError.value = e?.message ?? String(e)
  }
}

async function importWallet(){
  walletError.value = ''
  const k = importKeyInput.value.trim()
  if(!/^0x[0-9a-fA-F]{64}$/.test(k)){
    walletError.value = 'Invalid key _ must start with 0x followed by 64 hex characters'
    return
  }
  try {
    activateAccount(k)
    importKeyInput.value = ''
    walletView.value = null
    showWalletModal.value = false
    await nextTick()
    showToast('Wallet connected: ' + shortAddr(walletAddress.value))
    await loadBounties()
  } catch(e:any){
    walletError.value = 'Import failed: ' + (e?.message ?? String(e))
  }
}

function disconnect(){
  connected.value = false
  walletAddress.value = ''
  balance.value = '0.00'
  account.value = null
  // Do NOT clear localStorage _ let them reconnect easily
  showToast('Wallet disconnected')
}

async function copyKey(){
  await navigator.clipboard.writeText(exportKey.value)
  copied.value = true
  setTimeout(()=>{ copied.value=false },2000)
}

async function copyAddress(){
  try {
    await navigator.clipboard.writeText(walletAddress.value)
    copiedAddr.value = true
    setTimeout(()=>{ copiedAddr.value=false },2000)
  } catch { showToast('Could not copy address','err') }
}

async function fetchBalance(){
  if(!walletAddress.value) return
  try {
    const r = await fetch(STUDIO_RPC,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getBalance',params:[walletAddress.value,'latest']})
    })
    const d = await r.json()
    if(d.error) throw new Error(d.error.message || 'balance RPC error')
    const wei = BigInt(d.result ?? '0x0')
    balanceWei.value = wei
    balance.value = weiToGEN(wei)
    balanceKnown.value = true
  } catch {
    balanceWei.value = 0n
    balance.value = '—'
    balanceKnown.value = false
  }
}

function refreshBalance(){ fetchBalance(); showToast('Balance refreshed') }

// ── Contract reads ─────────────────────────────────
async function loadBounties(){
  loading.value=true
  bountiesError.value=''
  try {
    if(!CONTRACT) throw new Error('No contract address configured (VITE_CONTRACT_ADDRESS).')
    const r = await (client as any).readContract({
      address:CONTRACT, functionName:'get_all_bounties', args:[]
    })
    bounties.value = Array.isArray(r) ? [...r].reverse() : []
  } catch(e:any){
    // Keep the inline error concise; the raw RPC message can be very long.
    bountiesError.value = (e?.message ?? String(e)).split('\n')[0].slice(0,140)
    showToast('Could not load bounties','err')
  } finally { loading.value=false }
}

async function selectBounty(b:Bounty){
  selectedId.value=b.id
  try {
    const full = await (client as any).readContract({
      address:CONTRACT, functionName:'get_bounty', args:[b.id]
    })
    selectedBounty.value = full as Bounty
  } catch { selectedBounty.value=b }
  await loadSubmissionsFor(b.id)
}

async function loadSubmissionsFor(id:number){
  try {
    const r = await (client as any).readContract({
      address:CONTRACT, functionName:'get_submissions_for_bounty', args:[id]
    })
    submissions.value = Array.isArray(r) ? r : []
  } catch { submissions.value=[] }
}

async function loadMine(){
  if(!connected.value) return
  loading.value=true
  try {
    const all = await (client as any).readContract({
      address:CONTRACT, functionName:'get_all_bounties', args:[]
    }) as Bounty[]
    const mine:Submission[]=[]
    const postedSubs:{sub:Submission,bountyTitle:string}[]=[]
    for(const b of (all||[])){
      const subs = await (client as any).readContract({
        address:CONTRACT, functionName:'get_submissions_for_bounty', args:[b.id]
      }) as Submission[]
      for(const s of (subs||[])){
        if(s.creator?.toLowerCase()===walletAddress.value?.toLowerCase()) mine.push(s)
        // If I'm the poster, collect all submissions to my bounty
        if(b.poster?.toLowerCase()===walletAddress.value?.toLowerCase()){
          postedSubs.push({sub:s, bountyTitle:b.title})
        }
      }
    }
    mySubmissions.value=mine
    myPostedBountySubmissions.value=postedSubs
  } catch { showToast('Failed to load submissions','err') }
  finally { loading.value=false }
}

async function loadAll(){
  loading.value=true
  try {
    const r = await (client as any).readContract({
      address:CONTRACT, functionName:'get_all_bounties', args:[]
    })
    allBounties.value = Array.isArray(r) ? r : []
    // Count submissions per bounty
    const counts:Record<number,number>={}
    for(const b of allBounties.value){
      try {
        const subs = await (client as any).readContract({
          address:CONTRACT, functionName:'get_submissions_for_bounty', args:[b.id]
        }) as Submission[]
        counts[b.id]=Array.isArray(subs)?subs.length:0
      } catch { counts[b.id]=0 }
    }
    adminSubCounts.value=counts
  } catch { showToast('Failed to load admin data','err') }
  finally { loading.value=false }
}

// ── Contract writes ────────────────────────────────

function requireWallet(): boolean {
  if(!connected.value){ 
    showWalletModal.value = true
    return false
  }
  return true
}

// ----- Post a bounty -----
async function doPostBounty() {
  if(!requireWallet()) return
  posting.value = true
  postResult.value = null

  try {
    const rewardNum = parseFloat(form.value.rewardGEN)
if (!rewardNum || rewardNum <= 0) {
  postResult.value = { ok: false, err: 'Please enter a reward amount greater than 0' }
  posting.value = false
  return
}
// Guard before signing: on production networks reject rewards over balance.
if (rewardExceedsBalance.value) {
  postResult.value = { ok: false, err: rewardValidationMsg.value }
  posting.value = false
  return
}
const wei = BigInt(Math.round(rewardNum * 1e9)) * BigInt('1000000000')

    // 1️⃣ send tx
    const txHash = await (client as any).writeContract({
      account: account.value,
      address: CONTRACT,
      functionName: 'post_bounty',
      args: [form.value.title, form.value.description, form.value.criteria, wei],
    })

    // 2️⃣ wait for transaction confirmation
    const receipt = await (client as any).waitForTransactionReceipt({ hash: txHash })

    // 3️⃣ check success _ GenLayer receipts use result_name not status
    const ok = receipt?.result_name === 'MAJORITY_AGREE'
      || receipt?.status === 'success'
      || receipt?.status === 5
    if(ok){
      const id = String(receipt?.data?.result ?? receipt?.result ?? '?')
      postResult.value = { ok: true, id }
      showToast('Bounty posted! Reward locked on-chain.')
      form.value = { title:'', description:'', criteria:'', rewardGEN:'' }
      await loadBounties()
      await fetchBalance()
    } else {
      throw new Error('Transaction failed on-chain.')
    }

  } catch(e:any) {
    postResult.value = { ok: false, err: e?.message ?? String(e) }
    showToast('Failed: ' + (e?.message ?? String(e)).slice(0,100), 'err')
  } finally {
    posting.value = false
  }
}

// ----- Submit content -----
async function doSubmit(bountyId: number) {
  if(!requireWallet() || !submitUrl.value) return

  // Duplicate URL check
  const alreadySubmitted = submissions.value.some(
    s => s.content_url?.toLowerCase() === submitUrl.value.toLowerCase()
  )
  if(alreadySubmitted){
    showToast('This URL has already been submitted for this bounty', 'err')
    return
  }

  // Own wallet already submitted check
  const alreadyMine = submissions.value.some(
    s => s.creator?.toLowerCase() === walletAddress.value?.toLowerCase()
  )
  if(alreadyMine){
    showToast('You have already submitted to this bounty', 'err')
    return
  }

  submitting.value = true

  try {
    const txHash = await (client as any).writeContract({
      account: account.value,
      address: CONTRACT,
      functionName: 'submit_content',
      args: [bountyId, submitUrl.value],
    })

    const receipt = await (client as any).waitForTransactionReceipt({ hash: txHash })

    const ok = receipt?.result_name === 'MAJORITY_AGREE' || receipt?.status === 'success' || receipt?.status === 5
    if(ok){
      showToast('Submission stored on-chain!')
      submitUrl.value = ''
      await loadSubmissionsFor(bountyId)
    } else {
      throw new Error('Submission failed on-chain.')
    }

  } catch(e:any) {
    showToast('Submission failed: ' + (e?.message ?? String(e)).slice(0,80), 'err')
  } finally {
    submitting.value = false
  }
}

// ----- Evaluate submission -----
// bountyId is optional _ passed when called from My Activity so we can reload
async function doEvaluate(subId: number, bountyId?: number) {
  if(!requireWallet()) return
  evaluatingId.value = subId // Track the specific ID
  showToast('AI evaluation started - validators are reading the content…')

  try {
    const txHash = await (client as any).writeContract({
      account: account.value,
      address: CONTRACT,
      functionName: 'evaluate_submission',
      args: [subId],
    })

    const receipt = await (client as any).waitForTransactionReceipt({ hash: txHash })

    const ok = receipt?.result_name === 'MAJORITY_AGREE' || receipt?.status === 'success' || receipt?.status === 5
    if(ok){
      // Reload submissions to get updated status/score/feedback
      const reloadId = bountyId ?? selectedBounty.value?.id
      if(reloadId != null) await loadSubmissionsFor(reloadId)
      await loadMine()

      // Find the updated submission to show result
      const updated = submissions.value.find(s => s.id === subId)
        ?? myPostedBountySubmissions.value.find(i => i.sub.id === subId)?.sub
      if(updated){
        const resultMsg = updated.status === 'approved'
          ? `✓ Approved! Score: ${updated.score}/100 _ reward sent to creator`
          : `✗ Rejected. Score: ${updated.score}/100 _ ${updated.feedback}`
        showToast(resultMsg, updated.status === 'approved' ? 'ok' : 'err')
      } else {
        showToast('Evaluation complete _ refresh to see result')
      }
    } else {
      throw new Error('Evaluation failed on-chain.')
    }

  } catch(e:any) {
    showToast('Evaluation failed: ' + (e?.message ?? String(e)).slice(0,80), 'err')
  } finally {
    evaluatingId.value = null // Reset it
  }
}

// ----- Manual approve with custom reward -----
// ----- Manual approve with custom reward -----
async function doApprove(subId: number, bountyId: number) {
  if(!requireWallet()) return

  // 1. Check the budget! Find the bounty to know the max reward allowed
  const bounty = allBounties.value.find(b => b.id === bountyId)
  const maxRewardGEN = bounty ? (bounty.reward / 1e18) : 0

  const rewardGEN = parseFloat(manualReward.value[subId] || '0')
  if(!rewardGEN || rewardGEN <= 0){ 
    showToast('Enter a reward amount', 'err')
    return 
  }

  // 2. Prevent overspending
  if (maxRewardGEN > 0 && rewardGEN > maxRewardGEN) {
    showToast(`Amount exceeds the locked bounty reward of ${maxRewardGEN} GEN!`, 'err')
    return
  }

  // 3. Add a confirmation prompt
  if (!window.confirm(`Send ${rewardGEN} GEN to this creator? This will close the bounty and you cannot reward anyone else.`)) {
    return
  }

  const wei = BigInt(Math.round(rewardGEN * 1e9)) * BigInt('1000000000')
  const feedback = manualFeedback.value[subId] || 'Approved by bounty poster'
  manualAction.value = true

  try {
    const txHash = await (client as any).writeContract({
      account: account.value, address: CONTRACT,
      functionName: 'approve_with_reward',
      args: [subId, wei, feedback],
    })
    const receipt = await (client as any).waitForTransactionReceipt({ hash: txHash })
    const ok = receipt?.result_name === 'MAJORITY_AGREE' || receipt?.status === 'success' || receipt?.status === 5
    if(ok){
      showToast(`✓ Approved! ${rewardGEN} GEN sent to creator`)
      await loadMine()
      if(bountyId != null) await loadSubmissionsFor(bountyId)
    } else { throw new Error('Approve failed on-chain.') }
  } catch(e:any){ 
    showToast('Approve failed: '+(e?.message??String(e)).slice(0,80),'err') 
  }
  finally { manualAction.value = false }
}

// async function doApprove(subId: number, bountyId: number) {
//   if(!requireWallet()) return
//   const rewardGEN = parseFloat(manualReward.value[subId] || '0')
//   if(!rewardGEN || rewardGEN <= 0){ showToast('Enter a reward amount', 'err'); return }
//   const wei = BigInt(Math.round(rewardGEN * 1e9)) * BigInt('1000000000')
//   const feedback = manualFeedback.value[subId] || 'Approved by bounty poster'
//   manualAction.value = true
//   try {
//     const txHash = await (client as any).writeContract({
//       account: account.value, address: CONTRACT,
//       functionName: 'approve_with_reward',
//       args: [subId, wei, feedback],
//     })
//     const receipt = await (client as any).waitForTransactionReceipt({ hash: txHash })
//     const ok = receipt?.result_name === 'MAJORITY_AGREE' || receipt?.status === 'success' || receipt?.status === 5
//     if(ok){
//       showToast(`✓ Approved! ${rewardGEN} GEN sent to creator`)
//       await loadMine()
//       if(bountyId != null) await loadSubmissionsFor(bountyId)
//     } else { throw new Error('Approve failed on-chain.') }
//   } catch(e:any){ showToast('Approve failed: '+(e?.message??String(e)).slice(0,80),'err') }
//   finally { manualAction.value = false }
// }



// ----- Manual reject -----
async function doReject(subId: number, bountyId: number) {
  if(!requireWallet()) return
  const feedback = manualFeedback.value[subId] || 'Rejected by bounty poster'
  manualAction.value = true
  try {
    const txHash = await (client as any).writeContract({
      account: account.value, address: CONTRACT,
      functionName: 'reject_submission',
      args: [subId, feedback],
    })
    const receipt = await (client as any).waitForTransactionReceipt({ hash: txHash })
    const ok = receipt?.result_name === 'MAJORITY_AGREE' || receipt?.status === 'success' || receipt?.status === 5
    if(ok){
      showToast('Submission rejected', 'err')
      await loadMine()
      if(bountyId != null) await loadSubmissionsFor(bountyId)
    } else { throw new Error('Reject failed on-chain.') }
  } catch(e:any){ showToast('Reject failed: '+(e?.message??String(e)).slice(0,80),'err') }
  finally { manualAction.value = false }
}

// ── Startup ───────────────────────────────────────
// Runs on first paint. Restores a previously connected wallet so a refresh
// keeps you signed in, and always loads the public bounty list — Browse must
// populate on a clean session / refresh without requiring a manual click.
onMounted(async () => {
  const saved = localStorage.getItem(PK_KEY)
  if (saved && /^0x[0-9a-fA-F]{64}$/.test(saved)) {
    try { activateAccount(saved) } catch { localStorage.removeItem(PK_KEY) }
  }
  await loadBounties()
})

</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --bg:#050f0e; --sur:#081918; --sur2:#0d2724; --sur3:#112e2b;
  --b:#1c3f3b; --b2:#274f4b;
  --teal:#0d9488; --tl:#14b8a6; --tp:rgba(20,184,166,.1); --tg:rgba(20,184,166,.2);
  --y:#fef08a; --yd:#ca8a04; --yb:rgba(254,240,138,.08);
  --w:#f0fdfb; --m:#5eead4; --d:#2d6b65;
  --fh:'Syne',sans-serif; --fb:'DM Sans',sans-serif; --fm:'JetBrains Mono',monospace;
  --r:8px; --rl:14px;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{font-size:15px}
body{background:var(--bg);color:var(--w);font-family:var(--fb);line-height:1.65;min-height:100vh}
a{color:var(--tl);text-decoration:none}a:hover{color:var(--y)}
.app{display:flex;flex-direction:column;min-height:100vh}

/* Header */
.header{position:sticky;top:0;z-index:100;border-bottom:1px solid var(--b);background:rgba(5,15,14,.92);backdrop-filter:blur(12px)}
.header-inner{max-width:1200px;margin:0 auto;padding:0 24px;height:60px;display:flex;align-items:center;gap:20px}
.logo{display:flex;align-items:center;gap:8px;flex-shrink:0}
.logo-mark{color:var(--tl);font-size:18px}
.logo-text{font-family:var(--fh);font-weight:700;font-size:17px;color:var(--w)}
.logo-tag{font-family:var(--fm);font-size:10px;color:var(--d);background:var(--sur2);border:1px solid var(--b);padding:2px 6px;border-radius:4px}
.nav{display:flex;gap:4px;flex:1}
.nav-btn{background:none;border:none;cursor:pointer;font-family:var(--fb);font-size:14px;font-weight:500;color:var(--d);padding:6px 12px;border-radius:var(--r);transition:color .15s,background .15s}
.nav-btn:hover{color:var(--m);background:var(--sur2)}.nav-btn.active{color:var(--tl);background:var(--tp)}
.nav-admin{color:var(--yd) !important}.nav-admin.active{color:var(--y) !important;background:var(--yb) !important}
.wallet-area{margin-left:auto;display:flex;align-items:center;gap:8px;flex-shrink:0}
.wallet-pill{font-family:var(--fm);font-size:12px;color:var(--m);background:var(--sur2);border:1px solid var(--b);padding:4px 10px;border-radius:20px}
.bal-pill{font-family:var(--fm);font-size:12px;color:var(--y);background:var(--yb);border:1px solid rgba(254,240,138,.25);padding:4px 10px;border-radius:20px}
.btn-icon{background:none;border:none;color:var(--d);cursor:pointer;font-size:14px;padding:2px 6px;transition:color .15s}.btn-icon:hover{color:var(--tl)}
.btn-disconnect{background:none;border:1px solid var(--b);color:var(--d);font-size:12px;cursor:pointer;padding:3px 8px;border-radius:20px;transition:color .15s,border-color .15s}.btn-disconnect:hover{color:#f87171;border-color:#f87171}
.btn-connect-wallet{background:var(--tl);color:#0a0a0a;font-family:var(--fb);font-weight:600;font-size:13px;border:none;border-radius:20px;padding:7px 18px;cursor:pointer;transition:opacity .15s}.btn-connect-wallet:hover{opacity:.88}
/* Wallet dropdown */
.wallet-menu{position:relative}
.wallet-trigger{display:flex;align-items:center;gap:8px;background:var(--sur2);border:1px solid var(--b);border-radius:20px;padding:5px 12px;cursor:pointer;transition:border-color .15s,background .15s;font-family:var(--fm)}
.wallet-trigger:hover,.wallet-trigger.open{border-color:var(--teal)}
.wt-dot{width:7px;height:7px;border-radius:50%;background:var(--tl);box-shadow:0 0 6px var(--tl);flex-shrink:0}
.wt-addr{font-size:12px;color:var(--m)}
.wt-bal{font-size:12px;color:var(--y);border-left:1px solid var(--b);padding-left:8px}
.wt-caret{font-size:10px;color:var(--d);transition:transform .15s}
.wallet-trigger.open .wt-caret{transform:rotate(180deg)}
.wallet-backdrop{position:fixed;inset:0;z-index:190}
.wallet-dropdown{position:absolute;right:0;top:calc(100% + 8px);z-index:200;width:280px;background:var(--sur);border:1px solid var(--teal);border-radius:var(--rl);padding:8px;box-shadow:0 12px 32px rgba(0,0,0,.45)}
.wd-section{padding:10px 12px;display:flex;flex-direction:column;gap:4px;border-bottom:1px solid var(--b)}
.wd-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--d)}
.wd-full{font-family:var(--fm);font-size:11px;color:var(--m);word-break:break-all}
.wd-balrow{padding:10px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--b)}
.wd-balrow .wd-label{display:block;margin-bottom:2px}
.wd-bal{font-family:var(--fm);font-size:15px;font-weight:500;color:var(--y)}
.wd-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;border:none;color:var(--m);font-family:var(--fb);font-size:13px;padding:9px 12px;border-radius:var(--r);cursor:pointer;transition:background .15s,color .15s}
.wd-item:hover{background:var(--sur2);color:var(--w)}
.wd-item span{width:16px;text-align:center;color:var(--d)}
.wd-danger{color:#f87171}.wd-danger:hover{background:rgba(220,60,60,.1);color:#f87171}.wd-danger span{color:#f87171}

/* Modal */
.modal-overlay{position:fixed;inset:0;background:rgba(5,15,14,.8);backdrop-filter:blur(8px);z-index:300;display:flex;align-items:center;justify-content:center;padding:24px}
.modal-card{background:var(--sur);border:1px solid var(--teal);border-radius:var(--rl);padding:32px;max-width:460px;width:100%}
.modal-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px}
.modal-title{font-family:var(--fh);font-size:20px;font-weight:700;color:var(--w)}
.modal-sub{font-size:13px;color:var(--d);margin-top:4px}
.wallet-options{display:flex;flex-direction:column;gap:12px}
.wallet-option{background:var(--sur2);border:1px solid var(--b);border-radius:var(--r);padding:16px;display:flex;align-items:center;gap:14px;cursor:pointer;transition:border-color .15s,background .15s;text-align:left}
.wallet-option:hover{border-color:var(--teal);background:var(--tp)}
.wo-icon{font-size:20px;color:var(--tl);flex-shrink:0;width:32px;text-align:center}
.wo-title{font-size:14px;font-weight:500;color:var(--w);margin-bottom:2px}
.wo-sub{font-size:12px;color:var(--d)}
.wallet-import-form{display:flex;flex-direction:column;gap:12px}
.btn-back{background:none;border:none;color:var(--d);font-size:13px;cursor:pointer;padding:0;text-align:left;margin-bottom:4px;transition:color .15s}.btn-back:hover{color:var(--m)}
.modal-error{font-size:13px;color:#f87171}
.wallet-created{text-align:center}
.created-check{font-size:32px;color:var(--tl);margin-bottom:8px}
.created-title{font-family:var(--fh);font-size:18px;font-weight:700;color:var(--w);margin-bottom:8px}
.created-addr{font-family:var(--fm);font-size:11px;color:var(--m);margin-bottom:16px;word-break:break-all}
.created-faucet{background:var(--yb);border:1px solid rgba(254,240,138,.2);border-radius:var(--r);padding:14px;margin-bottom:16px;font-size:13px;color:var(--y)}
.faucet-btn{display:inline-block;background:var(--y);color:#0a0a0a;font-weight:600;font-size:12px;padding:6px 14px;border-radius:6px;margin-top:8px}
.created-export{background:var(--sur2);border:1px solid var(--b);border-radius:var(--r);padding:14px;text-align:left}
.export-warn{font-size:12px;color:#fbbf24;margin-bottom:8px}
.key-box{font-family:var(--fm);font-size:11px;color:var(--m);background:var(--bg);border:1px solid var(--b);border-radius:4px;padding:8px;word-break:break-all;margin-bottom:8px}
.btn-copy{background:var(--sur3);border:1px solid var(--b);color:var(--m);font-size:12px;padding:4px 12px;border-radius:4px;cursor:pointer;transition:border-color .15s}.btn-copy:hover{border-color:var(--teal)}

/* Faucet banner */
.faucet-banner{background:rgba(254,240,138,.06);border-bottom:1px solid rgba(254,240,138,.2);padding:10px 24px;display:flex;align-items:center;gap:16px;font-size:13px;color:var(--y);flex-wrap:wrap}
.faucet-link{background:var(--y);color:#0a0a0a;font-weight:600;padding:4px 12px;border-radius:6px;font-size:12px}
.faucet-addr{font-family:var(--fm);font-size:11px;color:var(--m)}

/* Main layout */
.main{flex:1;max-width:1200px;margin:0 auto;padding:40px 24px;width:100%}
.section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:32px}
.section-title{font-family:var(--fh);font-size:28px;font-weight:700;color:var(--w)}
.section-sub{font-size:14px;color:var(--m);margin-top:4px}

/* Buttons */
.btn-primary{background:var(--y);color:#0a0a0a;font-family:var(--fb);font-weight:600;font-size:14px;border:none;border-radius:var(--r);padding:10px 20px;cursor:pointer;transition:opacity .15s,transform .1s;white-space:nowrap}
.btn-primary:hover:not(:disabled){opacity:.88;transform:translateY(-1px)}.btn-primary:disabled{opacity:.4;cursor:not-allowed}
.btn-lg{padding:13px 28px;font-size:15px}
.w-full{width:100%}.mt-16{margin-top:16px}
.btn-ghost{background:none;border:1px solid var(--b);color:var(--m);font-size:13px;font-family:var(--fb);padding:7px 16px;border-radius:var(--r);cursor:pointer;transition:border-color .15s,color .15s}
.btn-ghost:hover:not(:disabled){border-color:var(--b2);color:var(--w)}.btn-ghost:disabled{opacity:.4;cursor:not-allowed}
.btn-close{background:none;border:none;color:var(--d);font-size:16px;cursor:pointer;padding:4px 8px;transition:color .15s;flex-shrink:0}.btn-close:hover{color:var(--w)}
.btn-eval{background:var(--tp);border:1px solid var(--teal);color:var(--tl);font-size:13px;font-family:var(--fb);font-weight:500;padding:7px 16px;border-radius:var(--r);cursor:pointer;transition:background .15s;margin-top:8px}
.btn-eval:hover:not(:disabled){background:var(--tg)}.btn-eval:disabled{opacity:.5;cursor:not-allowed}

/* Bounty grid */
.bounty-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-bottom:32px}
.bounty-card{background:var(--sur);border:1px solid var(--b);border-radius:var(--rl);padding:20px;cursor:pointer;transition:border-color .15s,transform .1s}
.bounty-card:hover{border-color:var(--b2);transform:translateY(-2px)}.bounty-card.selected{border-color:var(--teal);background:var(--sur2)}
.card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.bid{font-family:var(--fm);font-size:11px;color:var(--d)}
.card-title{font-family:var(--fh);font-size:16px;font-weight:600;color:var(--w);margin-bottom:6px;line-height:1.3}
.card-desc{font-size:13px;color:var(--m);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:16px}
.card-foot{display:flex;align-items:center;justify-content:space-between}
.reward-pill{background:var(--yb);border:1px solid rgba(254,240,138,.25);border-radius:20px;padding:4px 12px;font-family:var(--fm);font-size:13px;color:var(--y);font-weight:500}
.poster{font-family:var(--fm);font-size:11px;color:var(--d)}

/* Badges */
.badge{font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;text-transform:uppercase;letter-spacing:.04em}
.badge-open{background:var(--tp);color:var(--tl);border:1px solid var(--teal)}
.badge-filled{background:rgba(254,240,138,.1);color:var(--y);border:1px solid rgba(254,240,138,.3)}
.badge-cancelled{background:rgba(100,100,100,.1);color:#888;border:1px solid #333}
.badge-pending{background:rgba(100,140,140,.1);color:var(--m);border:1px solid var(--b)}
.badge-approved{background:rgba(254,240,138,.1);color:var(--y);border:1px solid rgba(254,240,138,.3)}
.badge-rejected{background:rgba(220,60,60,.1);color:#f87171;border:1px solid rgba(220,60,60,.3)}
.badge-lg{font-size:13px;padding:4px 12px}

/* Drawer */
.drawer{background:var(--sur);border:1px solid var(--teal);border-radius:var(--rl);padding:28px;margin-bottom:32px}
.drawer-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;gap:12px}
.drawer-title{font-family:var(--fh);font-size:20px;font-weight:700;color:var(--w)}
.drawer-poster{font-size:12px;color:var(--d);margin-top:4px;font-family:var(--fm)}
.drawer-row{display:flex;gap:32px;margin-bottom:20px}
.dstat{display:flex;flex-direction:column;gap:4px}
.dstat-val{font-family:var(--fh);font-size:20px;font-weight:700}
.yellow{color:var(--y)}.c-open{color:var(--tl)}.c-filled{color:var(--y)}.c-cancelled{color:#888}
.drawer-section{margin-bottom:20px}
.drawer-text{font-size:14px;color:var(--m);line-height:1.6}
.criteria-box{font-size:13px;color:var(--w);background:var(--sur2);border:1px solid var(--b);border-left:3px solid var(--teal);border-radius:var(--r);padding:14px 16px;white-space:pre-wrap;line-height:1.6}
.submit-box{background:var(--sur2);border:1px solid var(--b);border-radius:var(--r);padding:16px;margin-bottom:20px}
.submit-gated{display:flex;align-items:center;gap:12px;padding:8px 0;font-size:14px;color:var(--d)}
.input-row{display:flex;gap:10px;margin-top:8px}.input-row .input{flex:1}
.sub-list{display:flex;flex-direction:column;gap:12px}
.sub-item{background:var(--sur2);border:1px solid var(--b);border-radius:var(--r);padding:14px 16px}
.sub-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:6px}
.sub-url{font-family:var(--fm);font-size:12px;color:var(--m);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:360px}
.sub-meta{font-size:12px;color:var(--d);display:flex;gap:16px;margin-bottom:4px}
.sub-feedback{font-size:13px;color:var(--m);font-style:italic}

/* Form */
.form-card{max-width:680px;background:var(--sur);border:1px solid var(--b);border-radius:var(--rl);padding:32px}
.form-row{margin-bottom:20px}
.input,.textarea{width:100%;background:var(--sur2);border:1px solid var(--b);border-radius:var(--r);padding:10px 14px;font-family:var(--fb);font-size:14px;color:var(--w);outline:none;transition:border-color .15s;margin-top:8px}
.input:focus,.textarea:focus{border-color:var(--teal)}.textarea{resize:vertical}
.mono{font-family:var(--fm);font-size:13px}
.field-label{display:block;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--m)}
.field-hint{font-size:12px;color:var(--d);margin-top:4px;line-height:1.5}
.field-note{font-size:12px;color:var(--m);margin-top:6px;line-height:1.5}
.field-error{font-size:12px;color:#f87171;margin-top:6px;line-height:1.5}
.input-error{border-color:rgba(220,60,60,.6) !important}
.form-foot{margin-top:28px}
.result-box{margin-top:16px;padding:12px 16px;border-radius:var(--r);font-size:13px;font-family:var(--fm)}
.r-ok{background:var(--tp);border:1px solid var(--teal);color:var(--tl)}
.r-err{background:rgba(220,60,60,.08);border:1px solid rgba(220,60,60,.3);color:#f87171}

/* My submissions */
.mine-list{display:flex;flex-direction:column;gap:16px}
.mine-card{background:var(--sur);border:1px solid var(--b);border-radius:var(--rl);padding:22px}
.mine-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}
.mine-bid{font-family:var(--fm);font-size:11px;color:var(--d);display:block;margin-bottom:4px}
.mine-url{font-size:14px;color:var(--tl)}
.mine-result{display:flex;gap:20px;align-items:flex-start}
.mine-fb{flex:1}
.mine-pending{display:flex;align-items:center;gap:16px;padding-top:4px}
.score-ring{width:56px;height:56px;border-radius:50%;border:3px solid var(--teal);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.score-n{font-family:var(--fh);font-size:16px;font-weight:700;color:var(--y)}

/* Admin */
.admin-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px}
.astat{background:var(--sur);border:1px solid var(--b);border-radius:var(--r);padding:20px;text-align:center}
.astat-num{display:block;font-family:var(--fh);font-size:28px;font-weight:700;color:var(--y)}
.astat-label{font-size:13px;color:var(--d)}
.admin-table-wrap{overflow-x:auto;margin-bottom:24px}
.admin-table{width:100%;border-collapse:collapse;font-size:13px}
.admin-table th{text-align:left;padding:10px 12px;border-bottom:2px solid var(--b);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--d)}
.admin-table td{padding:12px 12px;border-bottom:1px solid var(--b);color:var(--w)}
.admin-table tr:hover td{background:var(--sur2)}
.admin-table .small{font-size:11px}
.btn-admin-edit{background:var(--tp);border:1px solid var(--teal);color:var(--tl);font-size:11px;padding:4px 10px;border-radius:4px;cursor:pointer;margin-right:6px;transition:background .15s}.btn-admin-edit:hover{background:var(--tg)}
.btn-admin-cancel{background:rgba(220,60,60,.1);border:1px solid rgba(220,60,60,.3);color:#f87171;font-size:11px;padding:4px 10px;border-radius:4px;cursor:pointer;transition:background .15s}.btn-admin-cancel:hover{background:rgba(220,60,60,.2)}
.admin-edit-panel{background:var(--sur);border:1px solid var(--teal);border-radius:var(--rl);padding:24px;margin-top:24px}
.aep-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:12px}
.aep-head h3{font-family:var(--fh);font-size:16px;font-weight:700;color:var(--w)}
.aep-foot{display:flex;gap:10px;margin-top:16px}

/* States */
.state-row{padding:60px 0;text-align:center;color:var(--d)}
.empty-state{padding:80px 0;text-align:center;color:var(--d);display:flex;flex-direction:column;align-items:center;gap:12px}
.error-state .ei{color:#f87171}
.es-detail{font-family:var(--fm);font-size:12px;color:var(--d);max-width:520px;word-break:break-word}
.ei{font-size:32px}
.pulse{animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

/* Toast */
.toast{position:fixed;bottom:28px;right:28px;padding:12px 20px;border-radius:var(--r);font-size:14px;max-width:420px;z-index:999}
.toast-ok{background:var(--sur3);border:1px solid var(--teal);color:var(--tl)}
.toast-err{background:rgba(30,10,10,.95);border:1px solid rgba(220,60,60,.5);color:#f87171}

/* Transitions */
.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
.slide-enter-active,.slide-leave-active{transition:all .25s}
.slide-enter-from,.slide-leave-to{opacity:0;transform:translateY(12px)}

/* Responsive */
@media(max-width:640px){
  .header-inner{gap:10px}.logo-tag{display:none}.nav-btn{padding:6px 8px;font-size:12px}
  .bounty-grid{grid-template-columns:1fr}.drawer-row{flex-direction:column;gap:12px}
  .admin-stats{grid-template-columns:repeat(2,1fr)}.faucet-banner{flex-direction:column;align-items:flex-start}
  .mine-result{flex-direction:column}
}
</style>