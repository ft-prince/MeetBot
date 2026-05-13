#!/usr/bin/env node
// Cross-platform migration runner. Works identically on macOS, Linux, Windows.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set in environment or .env file.');
    process.exit(1);
  }

  const schemaPath = path.resolve(__dirname, '..', 'src', 'db', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.error('Schema file not found:', schemaPath);
    process.exit(1);
  }
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    console.log('Connected — applying schema…');
    await client.query(sql);
    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main();
