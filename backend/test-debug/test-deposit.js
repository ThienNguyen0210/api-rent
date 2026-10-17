// Run from the backend folder:  node test-deposit.js
// Replays transaction 87855822 through the real deposit code and prints the REAL error, if any.
// Safe to run more than once: deposits.sepay_id is UNIQUE, so it can never credit twice.
import { processSepayWebhook } from './services/depositService.js'
import { pool } from './db.js'

try {
  const r = await processSepayWebhook({
    id: '87855822',
    transferType: 'in',
    transferAmount: 2000,
    accountNumber: process.env.DEPOSIT_ACCOUNT_NUMBER || '8848562226',
    code: null,
    content: 'NAP74TL3HVW FT26280595767664',
    description: 'NAP74TL3HVW FT26280595767664',
    referenceCode: '3a0f9aca-b0fd-4041-921c-996539896580',
  })
  console.log('RESULT:', r)
} catch (e) {
  console.error('ERROR:', e)
}
await pool.end()
