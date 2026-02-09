/**
 * Helper to access Cursor's MCP Slack functions
 * These functions are available when Slack MCP is enabled in Cursor
 */

import * as vscode from 'vscode';

/**
 * Gets Slack MCP functions from Cursor's MCP system
 * Tries multiple access patterns to find the MCP functions
 */
export async function getSlackMCPFunctions(): Promise<{
  listChannels: (params: any) => Promise<any>;
  getChannelHistory: (params: any) => Promise<any>;
  searchMessages: (params: any) => Promise<any>;
}> {
  // Method 1: Check if MCP functions are available as global functions
  // In Cursor, MCP functions might be injected into the extension context
  if (typeof (global as any).mcp_Slack_slack_list_channels === 'function') {
    return {
      listChannels: (global as any).mcp_Slack_slack_list_channels,
      getChannelHistory: (global as any).mcp_Slack_slack_get_channel_history,
      searchMessages: (global as any).mcp_Slack_slack_search_messages
    };
  }

  // Method 2: Via vscode.mcp API
  if ((vscode as any).mcp) {
    const mcp = (vscode as any).mcp;
    if (mcp.Slack) {
      return {
        listChannels: mcp.Slack.slack_list_channels,
        getChannelHistory: mcp.Slack.slack_get_channel_history,
        searchMessages: mcp.Slack.slack_search_messages
      };
    }
    
    // Try to get Slack server from MCP
    const servers = mcp.getServers?.() || [];
    const slackServer = servers.find((s: any) => 
      s.name === 'slack' || s.id === 'slack' || s.name?.toLowerCase().includes('slack')
    );
    
    if (slackServer) {
      return {
        listChannels: slackServer.list_channels || slackServer.slack_list_channels,
        getChannelHistory: slackServer.get_channel_history || slackServer.slack_get_channel_history,
        searchMessages: slackServer.search_messages || slackServer.slack_search_messages
      };
    }
  }

  // Method 3: Via Cursor-specific API
  if ((vscode as any).cursor?.mcp?.Slack) {
    return {
      listChannels: (vscode as any).cursor.mcp.Slack.slack_list_channels,
      getChannelHistory: (vscode as any).cursor.mcp.Slack.slack_get_channel_history,
      searchMessages: (vscode as any).cursor.mcp.Slack.slack_search_messages
    };
  }

  // Method 4: Try executing MCP command via vscode.commands
  // Some MCP implementations expose commands
  try {
    // This is a fallback - actual implementation depends on Cursor's MCP architecture
    throw new Error('MCP functions not found via standard methods');
  } catch (error) {
    // Continue to throw
  }

  throw new Error(
    'Slack MCP functions not available. ' +
    'Ensure Slack MCP is enabled in Cursor Settings → MCP → Slack. ' +
    'The extension needs access to Cursor\'s MCP Slack functions.'
  );
}
