"use strict";
/**
 * Helper to access Cursor's MCP Slack functions
 * These functions are available when Slack MCP is enabled in Cursor
 */
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
exports.getSlackMCPFunctions = getSlackMCPFunctions;
const vscode = __importStar(require("vscode"));
/**
 * Gets Slack MCP functions from Cursor's MCP system
 * Tries multiple access patterns to find the MCP functions
 */
async function getSlackMCPFunctions() {
    // Method 1: Check if MCP functions are available as global functions
    // In Cursor, MCP functions might be injected into the extension context
    if (typeof global.mcp_Slack_slack_list_channels === 'function') {
        return {
            listChannels: global.mcp_Slack_slack_list_channels,
            getChannelHistory: global.mcp_Slack_slack_get_channel_history,
            searchMessages: global.mcp_Slack_slack_search_messages
        };
    }
    // Method 2: Via vscode.mcp API
    if (vscode.mcp) {
        const mcp = vscode.mcp;
        if (mcp.Slack) {
            return {
                listChannels: mcp.Slack.slack_list_channels,
                getChannelHistory: mcp.Slack.slack_get_channel_history,
                searchMessages: mcp.Slack.slack_search_messages
            };
        }
        // Try to get Slack server from MCP
        const servers = mcp.getServers?.() || [];
        const slackServer = servers.find((s) => s.name === 'slack' || s.id === 'slack' || s.name?.toLowerCase().includes('slack'));
        if (slackServer) {
            return {
                listChannels: slackServer.list_channels || slackServer.slack_list_channels,
                getChannelHistory: slackServer.get_channel_history || slackServer.slack_get_channel_history,
                searchMessages: slackServer.search_messages || slackServer.slack_search_messages
            };
        }
    }
    // Method 3: Via Cursor-specific API
    if (vscode.cursor?.mcp?.Slack) {
        return {
            listChannels: vscode.cursor.mcp.Slack.slack_list_channels,
            getChannelHistory: vscode.cursor.mcp.Slack.slack_get_channel_history,
            searchMessages: vscode.cursor.mcp.Slack.slack_search_messages
        };
    }
    // Method 4: Try executing MCP command via vscode.commands
    // Some MCP implementations expose commands
    try {
        // This is a fallback - actual implementation depends on Cursor's MCP architecture
        throw new Error('MCP functions not found via standard methods');
    }
    catch (error) {
        // Continue to throw
    }
    throw new Error('Slack MCP functions not available. ' +
        'Ensure Slack MCP is enabled in Cursor Settings → MCP → Slack. ' +
        'The extension needs access to Cursor\'s MCP Slack functions.');
}
