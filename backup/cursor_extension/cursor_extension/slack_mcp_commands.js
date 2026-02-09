"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSlackMCPCommands = registerSlackMCPCommands;
const vscode = __importStar(require("vscode"));
const api_client_1 = require("./api_client");
const mcp_helper_1 = require("./mcp_helper");
/**
 * Slack MCP Commands for Cursor Extension
 * These commands use Cursor's built-in Slack MCP to ingest messages
 */
/**
 * Note: Slack MCP functions are available via Cursor's MCP API
 * These functions will be called directly using the MCP function names
 * The actual implementation uses the MCP functions available in Cursor's context
 */
/**
 * Registers Slack MCP commands
 */
function registerSlackMCPCommands(context) {
    // Command: Ingest Slack Channel
    const ingestChannelCommand = vscode.commands.registerCommand('pm-intelligence.ingestSlackChannel', async () => {
        try {
            // Get channel name
            const channelName = await vscode.window.showInputBox({
                prompt: 'Slack channel name (e.g., support, product, or #support)',
                placeHolder: 'support'
            });
            if (!channelName)
                return;
            // Get limit
            const limitStr = await vscode.window.showInputBox({
                prompt: 'Number of messages to ingest [1000]',
                placeHolder: '1000'
            });
            const limit = parseInt(limitStr || '1000') || 1000;
            // Show progress
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Ingesting Slack messages from #${channelName}`,
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: 'Listing Slack channels...' });
                // Use Cursor's MCP Slack functions
                console.log('Starting Slack channel ingestion', { channelName, limit });
                progress.report({ increment: 10, message: 'Connecting to Slack MCP...' });
                // Get Slack MCP functions
                const slackMCP = await (0, mcp_helper_1.getSlackMCPFunctions)();
                console.log('Slack MCP functions accessed', {
                    hasListChannels: !!slackMCP.listChannels,
                    hasGetHistory: !!slackMCP.getChannelHistory
                });
                progress.report({ increment: 20, message: 'Listing channels...' });
                // List channels
                const channelsResponse = await slackMCP.listChannels({
                    limit: 200,
                    exclude_archived: true
                });
                if (!channelsResponse || !channelsResponse.channels) {
                    console.error('Invalid channels response', { response: channelsResponse });
                    throw new Error('Could not retrieve Slack channels. Check Slack MCP configuration.');
                }
                const channels = channelsResponse.channels || channelsResponse;
                console.log('Retrieved Slack channels', { channelCount: Array.isArray(channels) ? channels.length : 0 });
                const channel = channels.find((c) => c.name === channelName.replace('#', '') ||
                    c.id === channelName);
                if (!channel) {
                    const availableChannels = channels.map((c) => c.name).slice(0, 10).join(', ');
                    console.warn('Channel not found', { channelName, availableChannels });
                    throw new Error(`Channel '${channelName}' not found. Available channels: ${availableChannels}`);
                }
                console.log('Found target channel', {
                    channelName: channel.name,
                    channelId: channel.id
                });
                progress.report({ increment: 30, message: `Fetching messages from #${channel.name}...` });
                // Get channel history
                progress.report({ increment: 40, message: `Fetching messages from #${channel.name}...` });
                console.log('Fetching channel history', {
                    channelId: channel.id,
                    channelName: channel.name,
                    limit
                });
                const history = await slackMCP.getChannelHistory({
                    channel_id: channel.id,
                    limit: limit
                });
                if (!history || (!history.messages && !Array.isArray(history))) {
                    console.error('Invalid history response', {
                        history,
                        channelId: channel.id
                    });
                    throw new Error('Could not fetch channel history. Check Slack MCP permissions.');
                }
                const messages = history.messages || history;
                console.log('Retrieved channel messages', {
                    channelName: channel.name,
                    messageCount: Array.isArray(messages) ? messages.length : 0
                });
                progress.report({ increment: 50, message: 'Ingesting signals...' });
                let ingestedCount = 0;
                let skippedCount = 0;
                for (const message of messages) {
                    // Skip bot messages and system messages
                    if (message.subtype || message.bot_id) {
                        skippedCount++;
                        continue;
                    }
                    const signal = {
                        source: 'slack',
                        id: message.ts || message.event_ts || Date.now().toString(),
                        type: 'message',
                        text: message.text || '',
                        metadata: {
                            channel: channel.name,
                            channel_id: channel.id,
                            user: message.user,
                            timestamp: message.ts,
                            thread_ts: message.thread_ts
                        }
                    };
                    try {
                        await api_client_1.apiClient.ingestSignal(signal);
                        ingestedCount++;
                        console.log('Message ingested', {
                            messageTs: message.ts,
                            channel: channel.name
                        });
                    }
                    catch (error) {
                        console.warn('Failed to ingest message', {
                            error: error.message,
                            messageTs: message.ts
                        });
                    }
                }
                progress.report({ increment: 100, message: 'Complete' });
                console.log('Slack channel ingestion complete', {
                    channelName: channel.name,
                    ingestedCount,
                    skippedCount,
                    totalMessages: history.messages?.length || 0
                });
                vscode.window.showInformationMessage(`✅ Ingested ${ingestedCount} signals from #${channel.name} (${skippedCount} skipped)`);
            });
        }
        catch (error) {
            const errorMessage = error?.message || String(error);
            vscode.window.showErrorMessage(`Failed to ingest Slack channel: ${errorMessage}`);
            console.error('Ingest Slack channel error:', error);
        }
    });
    // Command: Ingest Slack Mentions
    const ingestMentionsCommand = vscode.commands.registerCommand('pm-intelligence.ingestSlackMentions', async () => {
        try {
            const limitStr = await vscode.window.showInputBox({
                prompt: 'Number of mentions to ingest [50]',
                placeHolder: '50'
            });
            const limit = parseInt(limitStr || '50') || 50;
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Ingesting Slack mentions',
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: 'Searching mentions...' });
                const searchResults = await global.mcp_Slack_slack_search_messages?.({
                    query: 'on:me',
                    count: limit
                }) || await vscode.mcp?.Slack?.slack_search_messages?.({
                    query: 'on:me',
                    count: limit
                });
                if (!searchResults) {
                    throw new Error('Could not search Slack messages. Ensure Slack MCP is enabled.');
                }
                progress.report({ increment: 50, message: 'Ingesting signals...' });
                let ingestedCount = 0;
                const messages = searchResults.messages || searchResults.results || [];
                for (const message of messages) {
                    const signal = {
                        source: 'slack',
                        id: message.ts || message.timestamp || Date.now().toString(),
                        type: 'mention',
                        text: message.text || message.content || '',
                        metadata: {
                            channel: message.channel?.name || message.channel_name,
                            channel_id: message.channel?.id || message.channel_id,
                            user: message.user,
                            timestamp: message.ts || message.timestamp
                        }
                    };
                    try {
                        await api_client_1.apiClient.ingestSignal(signal);
                        ingestedCount++;
                    }
                    catch (error) {
                        const errorMessage = error?.message || String(error);
                        console.warn(`Failed to ingest mention:`, errorMessage);
                    }
                }
                progress.report({ increment: 100 });
                vscode.window.showInformationMessage(`✅ Ingested ${ingestedCount} signals from Slack mentions`);
            });
        }
        catch (error) {
            const errorMessage = error?.message || String(error);
            vscode.window.showErrorMessage(`Failed to ingest Slack mentions: ${errorMessage}`);
            console.error('Ingest Slack mentions error:', error);
        }
    });
    // Command: List Slack Channels
    const listChannelsCommand = vscode.commands.registerCommand('pm-intelligence.listSlackChannels', async () => {
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Fetching Slack channels',
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: 'Connecting to Slack...' });
                const channelsResponse = await global.mcp_Slack_slack_list_channels?.({
                    limit: 200,
                    exclude_archived: true
                }) || await vscode.mcp?.Slack?.slack_list_channels?.({
                    limit: 200,
                    exclude_archived: true
                });
                if (!channelsResponse || !channelsResponse.channels) {
                    throw new Error('Could not access Slack channels. Ensure Slack MCP is enabled in Cursor.');
                }
                const channels = channelsResponse.channels;
                const channelNames = channels.map((c) => `#${c.name}`).join(', ');
                progress.report({ increment: 100 });
                // Show in a document
                const doc = await vscode.workspace.openTextDocument({
                    content: `# Slack Channels (${channels.length} total)\n\n${channelNames}\n\n## Channel Details\n\n${channels.map((c) => `- **#${c.name}** (ID: ${c.id})`).join('\n')}`,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(doc);
                vscode.window.showInformationMessage(`Found ${channels.length} Slack channels`);
            });
        }
        catch (error) {
            const errorMessage = error?.message || String(error);
            vscode.window.showErrorMessage(`Failed to list channels: ${errorMessage}`);
            console.error('List Slack channels error:', error);
        }
    });
    context.subscriptions.push(ingestChannelCommand, ingestMentionsCommand, listChannelsCommand);
}
