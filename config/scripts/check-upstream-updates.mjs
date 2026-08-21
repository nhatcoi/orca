import { execSync } from 'node:child_process'

function run(cmd, suppressError = true) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch (err) {
    if (!suppressError) {
      throw err
    }
    return ''
  }
}

// 1. Detect remote (prioritize 'upstream' if available, otherwise 'origin')
const remotes = run('git remote').split('\n').filter(Boolean)
const remote = remotes.includes('upstream')
  ? 'upstream'
  : remotes.includes('origin')
    ? 'origin'
    : null

if (!remote) {
  console.error('❌ Không tìm thấy Git remote nào (origin hoặc upstream).')
  process.exit(1)
}

const targetBranch = 'main'
const remoteBranch = `${remote}/${targetBranch}`

console.log(`📡 Đang kiểm tra cập nhật từ remote \x1b[36m${remoteBranch}\x1b[0m...`)

try {
  run(`git fetch ${remote} ${targetBranch} --quiet`, false)
} catch {
  console.warn(
    `⚠️  Không thể fetch từ ${remoteBranch}. Đang phân tích dựa trên dữ liệu cache local...`
  )
}

// 2. Determine base and diff commits
const baseCommit = run(`git merge-base HEAD ${remoteBranch}`)
if (!baseCommit) {
  console.error(`❌ Không tìm thấy merge-base chung giữa HEAD và ${remoteBranch}.`)
  process.exit(1)
}

const incomingCommitsRaw = run(`git log ${baseCommit}..${remoteBranch} --oneline`)
const localCommitsRaw = run(`git log ${baseCommit}..HEAD --oneline`)

const incomingCommits = incomingCommitsRaw ? incomingCommitsRaw.split('\n').filter(Boolean) : []
const localCommits = localCommitsRaw ? localCommitsRaw.split('\n').filter(Boolean) : []

if (incomingCommits.length === 0) {
  console.log(
    `\n✅ \x1b[32mRepo của bạn đang ở phiên bản mới nhất so với ${remoteBranch} (Không có commit mới nào).\x1b[0m`
  )
  if (localCommits.length > 0) {
    console.log(
      `ℹ️  Nhánh hiện tại của bạn đang có ${localCommits.length} commit riêng chưa có trên ${remoteBranch}:`
    )
    localCommits.forEach((c) => console.log(`   \x1b[33m• ${c}\x1b[0m`))
  }
  process.exit(0)
}

// 3. Categorize incoming commits
const categories = {
  features: [],
  fixes: [],
  perfRefactor: [],
  deps: [],
  others: []
}

for (const commit of incomingCommits) {
  const message = commit.substring(commit.indexOf(' ') + 1).toLowerCase()
  if (message.startsWith('feat:') || message.startsWith('feat(') || message.includes('feature')) {
    categories.features.push(commit)
  } else if (message.startsWith('fix:') || message.startsWith('fix(') || message.includes('bug')) {
    categories.fixes.push(commit)
  } else if (
    message.startsWith('perf:') ||
    message.startsWith('perf(') ||
    message.startsWith('refactor:') ||
    message.startsWith('refactor(')
  ) {
    categories.perfRefactor.push(commit)
  } else if (message.includes('deps') || message.includes('bump') || message.startsWith('build:')) {
    categories.deps.push(commit)
  } else {
    categories.others.push(commit)
  }
}

console.log(`\n==================================================`)
console.log(`📦 \x1b[1mTìm thấy ${incomingCommits.length} commit mới từ ${remoteBranch}\x1b[0m`)
console.log(`==================================================\n`)

if (categories.features.length > 0) {
  console.log(`\x1b[32m\x1b[1m🚀 TÍNH NĂNG MỚI (${categories.features.length}):\x1b[0m`)
  categories.features.forEach((c) => console.log(`  • ${c}`))
  console.log()
}

if (categories.fixes.length > 0) {
  console.log(`\x1b[33m\x1b[1m🐛 SỬA LỖI (${categories.fixes.length}):\x1b[0m`)
  categories.fixes.slice(0, 15).forEach((c) => console.log(`  • ${c}`))
  if (categories.fixes.length > 15) {
    console.log(`  ... và ${categories.fixes.length - 15} commit fix khác.`)
  }
  console.log()
}

if (categories.perfRefactor.length > 0) {
  console.log(`\x1b[34m\x1b[1m⚡ TỐI ƯU & REFACTOR (${categories.perfRefactor.length}):\x1b[0m`)
  categories.perfRefactor.slice(0, 10).forEach((c) => console.log(`  • ${c}`))
  if (categories.perfRefactor.length > 10) {
    console.log(`  ... và ${categories.perfRefactor.length - 10} commit tối ưu khác.`)
  }
  console.log()
}

if (
  categories.others.length > 0 &&
  categories.features.length === 0 &&
  categories.fixes.length === 0
) {
  console.log(`\x1b[37m\x1b[1m📝 CÁC THAY ĐỔI KHÁC (${categories.others.length}):\x1b[0m`)
  categories.others.slice(0, 10).forEach((c) => console.log(`  • ${c}`))
  console.log()
}

// 4. File-level impact & conflict risk analysis
const upstreamFiles = run(`git diff --name-only ${baseCommit}..${remoteBranch}`)
  .split('\n')
  .filter(Boolean)
const localUncommittedFiles = run('git status --porcelain')
  .split('\n')
  .map((l) => l.trim().slice(3))
  .filter(Boolean)
const localCommittedFiles = run(`git diff --name-only ${baseCommit}..HEAD`)
  .split('\n')
  .filter(Boolean)

const allLocalChangedFiles = new Set([...localUncommittedFiles, ...localCommittedFiles])
const conflictRiskFiles = upstreamFiles.filter((f) => allLocalChangedFiles.has(f))

console.log(`--------------------------------------------------`)
console.log(`🔍 \x1b[1mPHÂN TÍCH TÁC ĐỘNG TỚI MÃ NGUỒN CỦA BẠN:\x1b[0m\n`)

const hasDepChanges =
  upstreamFiles.includes('package.json') || upstreamFiles.includes('pnpm-lock.yaml')
if (hasDepChanges) {
  console.log(
    `⚠️  \x1b[33m\x1b[1mCÓ THAY ĐỔI DEPENDENCY\x1b[0m: 'package.json' hoặc 'pnpm-lock.yaml' đã thay đổi.`
  )
  console.log(`   -> Cần chạy \x1b[36mpnpm install\x1b[0m sau khi update.`)
}

if (conflictRiskFiles.length > 0) {
  console.log(
    `\n🚨 \x1b[31m\x1b[1mCẢNH BÁO NGUY CƠ CONFLICT (${conflictRiskFiles.length} files cả 2 bên cùng sửa):\x1b[0m`
  )
  conflictRiskFiles.forEach((file) => console.log(`  ❗ \x1b[31m${file}\x1b[0m`))
} else {
  console.log(
    `✨ \x1b[32mAN TOÀN\x1b[0m: Không có xung đột file trực tiếp với các chỉnh sửa local của bạn.`
  )
}

console.log(`--------------------------------------------------`)
console.log(`💡 \x1b[1mGỢI Ý CÁC BƯỚC ĐỒNG BỘ:\x1b[0m`)
console.log(`  1. Lưu tạm thay đổi dở dang (nếu có):  \x1b[36mgit stash\x1b[0m`)
console.log(
  `  2. Cập nhật nhánh chính:               \x1b[36mgit pull ${remote} ${targetBranch}\x1b[0m`
)
console.log(`  3. Phục hồi thay đổi (nếu có stash):    \x1b[36mgit stash pop\x1b[0m`)
if (hasDepChanges) {
  console.log(`  4. Cài đặt lại thư viện mới:           \x1b[36mpnpm install\x1b[0m`)
}
console.log(`  5. Build lại app để áp dụng:           \x1b[36mpnpm run build:unpack\x1b[0m\n`)
