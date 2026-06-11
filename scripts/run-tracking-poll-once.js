#!/usr/bin/env node
/** Run one telematics poll cycle (same as server background job). */
import 'dotenv/config';
import { runTrackingProviderPoll, getTrackingPollStatus } from '../src/lib/trackingProviderPoll.js';
import { getPool } from '../src/db.js';

const stats = await runTrackingProviderPoll();
console.log('Poll result:', JSON.stringify(stats, null, 2));
console.log('Status:', JSON.stringify(getTrackingPollStatus(), null, 2));
const pool = await getPool();
await pool.close();
