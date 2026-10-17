// One-off: creates the database (if missing) and runs schema.sql. Usage: node src/initDb.js
import fs from 'node:fs'
import mysql from 'mysql2/promise'
import { config } from './config.js'

const { database, ...conn } = config.db
const c = await mysql.createConnection({ ...conn, multipleStatements: true })
await c.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4`)
await c.query(`USE \`${database}\``)
await c.query(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'))
await c.end()
console.log(`Database "${database}" is ready.`)
