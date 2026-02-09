#!/usr/bin/env ts-node

import { getStrategicInsights } from '../backend/services/slack_insight_service';

const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : 10;
const LOOKBACK_DAYS = process.env.LOOKBACK_DAYS ? parseInt(process.env.LOOKBACK_DAYS, 10) : 180;

async function run() {
  const results = await getStrategicInsights({ limit: LIMIT, lookbackDays: LOOKBACK_DAYS });
  console.log(JSON.stringify(results, null, 2));
}

run()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Failed to fetch insights:', error.message);
    process.exit(1);
  });
