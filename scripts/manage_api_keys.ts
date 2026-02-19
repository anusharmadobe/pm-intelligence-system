#!/usr/bin/env ts-node

/**
 * API Key Management CLI
 *
 * Usage:
 *   npm run api-key:create -- --name "My App" --scopes "read:signals,write:signals"
 *   npm run api-key:list
 *   npm run api-key:revoke -- --id <key-id>
 *   npm run api-key:stats -- --id <key-id>
 */

import { apiKeyService, ApiKey } from '../backend/services/api_key_service';
import { logger } from '../backend/utils/logger';

const args = process.argv.slice(2);

function parseArgs(): { command: string; options: Record<string, any> } {
  const command = args[0];
  const options: Record<string, any> = {};

  for (let i = 1; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];
    options[key] = value;
  }

  return { command, options };
}

function printUsage() {
  console.log(`
API Key Management CLI

Commands:
  create         Create a new API key
  list           List all API keys
  get            Get details of a specific API key
  revoke         Revoke an API key
  stats          Get usage statistics for an API key
  help           Show this help message

Create Options:
  --name <name>              Required: Name for the API key
  --scopes <scopes>          Required: Comma-separated list of scopes (e.g., "read:signals,write:signals,admin")
  --created-by <user>        Optional: Creator username
  --expires-days <days>      Optional: Number of days until expiration

List Options:
  --include-inactive         Optional: Include inactive keys in the list

Get/Revoke/Stats Options:
  --id <uuid>                Required: API key ID

Examples:
  npm run api-key:create -- --name "Production App" --scopes "read:signals,write:signals" --created-by "admin"
  npm run api-key:create -- --name "Admin Key" --scopes "admin" --expires-days 90
  npm run api-key:list
  npm run api-key:list -- --include-inactive
  npm run api-key:get -- --id "123e4567-e89b-12d3-a456-426614174000"
  npm run api-key:revoke -- --id "123e4567-e89b-12d3-a456-426614174000"
  npm run api-key:stats -- --id "123e4567-e89b-12d3-a456-426614174000"
`);
}

async function createApiKey(options: Record<string, any>) {
  if (!options.name || !options.scopes) {
    console.error('Error: --name and --scopes are required');
    printUsage();
    process.exit(1);
  }

  const scopes = options.scopes.split(',').map((s: string) => s.trim());
  let expires_at: Date | undefined;

  if (options['expires-days']) {
    const days = parseInt(options['expires-days']);
    expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + days);
  }

  try {
    const result = await apiKeyService.createApiKey({
      name: options.name,
      scopes,
      created_by: options['created-by'],
      expires_at
    });

    console.log('\n✅ API Key Created Successfully!\n');
    console.log('🔑 API Key (SAVE THIS - IT WILL NOT BE SHOWN AGAIN):');
    console.log(`   ${result.api_key}\n`);
    console.log('📋 Key Details:');
    console.log(`   ID:         ${result.id}`);
    console.log(`   Name:       ${result.name}`);
    console.log(`   Prefix:     ${result.key_prefix}`);
    console.log(`   Scopes:     ${result.scopes.join(', ')}`);
    console.log(`   Created By: ${result.created_by || 'N/A'}`);
    console.log(`   Expires:    ${result.expires_at ? new Date(result.expires_at).toISOString() : 'Never'}`);
    console.log(`   Created At: ${new Date(result.created_at).toISOString()}\n`);

    console.log('💡 Usage:');
    console.log(`   curl -H "Authorization: ApiKey ${result.api_key}" http://localhost:3000/api/signals\n`);
  } catch (error: any) {
    console.error('❌ Error creating API key:', error.message);
    process.exit(1);
  }
}

async function listApiKeys(options: Record<string, any>) {
  try {
    const includeInactive = options['include-inactive'] === 'true' || options['include-inactive'] === '';
    const keys = await apiKeyService.listApiKeys(includeInactive);

    console.log(`\n📋 API Keys (${keys.length} total):\n`);

    if (keys.length === 0) {
      console.log('No API keys found.');
      return;
    }

    for (const key of keys) {
      const status = key.is_active ? '✅ Active' : '❌ Inactive';
      const expiry = key.expires_at
        ? new Date(key.expires_at) < new Date()
          ? '⚠️  Expired'
          : `Expires ${new Date(key.expires_at).toISOString().split('T')[0]}`
        : 'Never expires';

      console.log(`${status} ${key.name}`);
      console.log(`   ID:         ${key.id}`);
      console.log(`   Prefix:     ${key.key_prefix}`);
      console.log(`   Scopes:     ${key.scopes.join(', ')}`);
      console.log(`   Created:    ${new Date(key.created_at).toISOString().split('T')[0]}`);
      console.log(`   Last Used:  ${key.last_used_at ? new Date(key.last_used_at).toISOString() : 'Never'}`);
      console.log(`   Expiration: ${expiry}`);
      console.log('');
    }
  } catch (error: any) {
    console.error('❌ Error listing API keys:', error.message);
    process.exit(1);
  }
}

async function getApiKey(options: Record<string, any>) {
  if (!options.id) {
    console.error('Error: --id is required');
    printUsage();
    process.exit(1);
  }

  try {
    const key = await apiKeyService.getApiKeyById(options.id);

    if (!key) {
      console.error(`❌ API key not found: ${options.id}`);
      process.exit(1);
    }

    console.log('\n📋 API Key Details:\n');
    console.log(`   ID:         ${key.id}`);
    console.log(`   Name:       ${key.name}`);
    console.log(`   Prefix:     ${key.key_prefix}`);
    console.log(`   Scopes:     ${key.scopes.join(', ')}`);
    console.log(`   Status:     ${key.is_active ? '✅ Active' : '❌ Inactive'}`);
    console.log(`   Created By: ${key.created_by || 'N/A'}`);
    console.log(`   Created:    ${new Date(key.created_at).toISOString()}`);
    console.log(`   Last Used:  ${key.last_used_at ? new Date(key.last_used_at).toISOString() : 'Never'}`);
    console.log(`   Expires:    ${key.expires_at ? new Date(key.expires_at).toISOString() : 'Never'}\n`);

    // Get stats if available
    try {
      const stats = await apiKeyService.getApiKeyStats(key.id);
      if (stats) {
        console.log('📊 Usage Statistics:\n');
        console.log(`   Last 24h:   ${stats.requests_24h} requests (${stats.errors_24h} errors)`);
        console.log(`   Last 7d:    ${stats.requests_7d} requests`);
        console.log(`   Avg Resp:   ${Math.round(stats.avg_response_ms_24h)}ms (24h)\n`);
      }
    } catch {
      // Stats might not be available
    }
  } catch (error: any) {
    console.error('❌ Error getting API key:', error.message);
    process.exit(1);
  }
}

async function revokeApiKey(options: Record<string, any>) {
  if (!options.id) {
    console.error('Error: --id is required');
    printUsage();
    process.exit(1);
  }

  try {
    const success = await apiKeyService.revokeApiKey(options.id, 'cli-admin');

    if (success) {
      console.log(`✅ API key revoked successfully: ${options.id}`);
    } else {
      console.error(`❌ API key not found or already revoked: ${options.id}`);
      process.exit(1);
    }
  } catch (error: any) {
    console.error('❌ Error revoking API key:', error.message);
    process.exit(1);
  }
}

async function getApiKeyStats(options: Record<string, any>) {
  if (!options.id) {
    console.error('Error: --id is required');
    printUsage();
    process.exit(1);
  }

  try {
    const stats = await apiKeyService.getApiKeyStats(options.id);

    if (!stats) {
      console.error(`❌ API key not found or no statistics available: ${options.id}`);
      process.exit(1);
    }

    console.log('\n📊 API Key Usage Statistics:\n');
    console.log(`   Last 24 hours:    ${stats.requests_24h} requests`);
    console.log(`   Last 7 days:      ${stats.requests_7d} requests`);
    console.log(`   Errors (24h):     ${stats.errors_24h}`);
    console.log(`   Avg Response:     ${Math.round(stats.avg_response_ms_24h)}ms\n`);
  } catch (error: any) {
    console.error('❌ Error getting API key stats:', error.message);
    process.exit(1);
  }
}

async function main() {
  const { command, options } = parseArgs();

  if (!command || command === 'help') {
    printUsage();
    process.exit(0);
  }

  switch (command) {
    case 'create':
      await createApiKey(options);
      break;
    case 'list':
      await listApiKeys(options);
      break;
    case 'get':
      await getApiKey(options);
      break;
    case 'revoke':
      await revokeApiKey(options);
      break;
    case 'stats':
      await getApiKeyStats(options);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
