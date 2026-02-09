/**
 * Helper to access Slack MCP functions from a non-extension context.
 * This relies on Cursor injecting MCP functions into the global scope.
 */
export async function getSlackMCPFunctions(): Promise<{
  listChannels: (params: any) => Promise<any>;
  getChannelHistory: (params: any) => Promise<any>;
  searchMessages: (params: any) => Promise<any>;
}> {
  if (typeof (global as any).mcp_Slack_slack_list_channels === 'function') {
    return {
      listChannels: (global as any).mcp_Slack_slack_list_channels,
      getChannelHistory: (global as any).mcp_Slack_slack_get_channel_history,
      searchMessages: (global as any).mcp_Slack_slack_search_messages
    };
  }

  if ((global as any).mcp?.Slack) {
    return {
      listChannels: (global as any).mcp.Slack.slack_list_channels,
      getChannelHistory: (global as any).mcp.Slack.slack_get_channel_history,
      searchMessages: (global as any).mcp.Slack.slack_search_messages
    };
  }

  throw new Error(
    'Slack MCP functions not available. ' +
    'Run this inside Cursor IDE with Slack MCP enabled.'
  );
}
