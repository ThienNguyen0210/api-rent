// Operator tool for transfers that could not be matched to a user (missing/garbled transfer content)
// or were below the minimum. Run from the server folder:
//   node scripts/deposits-admin.js list
//   node scripts/deposits-admin.js assign <sepayId> <userId>
import { pool } from '../src/db.js'
import { listUnassigned, assignDeposit } from '../src/services/depositService.js'

const [cmd, sepayId, userId] = process.argv.slice(2)
try {
  if (cmd === 'list') {
    const rows = await listUnassigned()
    if (rows.length) console.table(rows)
    else console.log('Nothing to review.')
  } else if (cmd === 'assign' && sepayId && userId) {
    console.log('Credited:', await assignDeposit(Number(sepayId), Number(userId)))
  } else {
    console.log('Usage:\n  node scripts/deposits-admin.js list\n  node scripts/deposits-admin.js assign <sepayId> <userId>')
    process.exitCode = 1
  }
} catch (e) {
  console.error(e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
