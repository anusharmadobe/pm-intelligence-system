import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { tool as searchSignals } from './tools/search_signals';
import { tool as getCustomerProfile } from './tools/get_customer_profile';
import { tool as getFeatureHealth } from './tools/get_feature_health';
import { tool as getIssueImpact } from './tools/get_issue_impact';
import { tool as findRelatedEntities } from './tools/find_related_entities';
import { tool as getHeatmap } from './tools/get_heatmap';
import { tool as getTrends } from './tools/get_trends';
import { tool as getRoadmapPriorities } from './tools/get_roadmap_priorities';
import { tool as getStrategicInsights } from './tools/get_strategic_insights';
import { tool as reviewPendingEntities } from './tools/review_pending_entities';
import { tool as confirmEntityMerge } from './tools/confirm_entity_merge';
import { tool as rejectEntityMerge } from './tools/reject_entity_merge';
import { tool as addEntityAlias } from './tools/add_entity_alias';
import { tool as listEntities } from './tools/list_entities';
import { tool as splitEntity } from './tools/split_entity';
import { tool as ingestTranscript } from './tools/ingest_transcript';
import { tool as ingestDocument } from './tools/ingest_document';
import { tool as generateArtifact } from './tools/generate_artifact';
import { tool as listOpportunities } from './tools/list_opportunities';
import { tool as generateShareableReport } from './tools/generate_shareable_report';
import { tool as browseKnowledgeGraph } from './tools/browse_knowledge_graph';
import { tool as getKnowledgeSummary } from './tools/get_knowledge_summary';
import { tool as getProvenance } from './tools/get_provenance';
import { tool as getEntityResolutionStats } from './tools/get_entity_resolution_stats';
import { tool as whatIfAnalysis } from './tools/what_if_analysis';
import { tool as exportData } from './tools/export_data';
import { tool as getSystemHealth } from './tools/get_system_health';
import { tool as runPipeline } from './tools/run_pipeline';
import { tool as getDlqStatus } from './tools/get_dlq_status';
import { tool as retryDlqItem } from './tools/retry_dlq_item';
import { tool as reviewAgentOutputs } from './tools/review_agent_outputs';
import { tool as rollbackAgent } from './tools/rollback_agent';
import { tool as listRegisteredAgents } from './tools/list_registered_agents';
import { tool as deactivateAgent } from './tools/deactivate_agent';
import { tool as configureStakeholderAccess } from './tools/configure_stakeholder_access';
import { tool as saveSessionState, loadTool as loadSessionState } from './tools/session_state';
import { tool as correctSignalExtraction } from './tools/correct_signal_extraction';
import { tool as crawlWebsite } from './tools/crawl_website';
import { tool as searchSlack } from './tools/search_slack';
import { tool as searchDocuments } from './tools/search_documents';
import { tool as searchTranscripts } from './tools/search_transcripts';
import { tool as searchWebContent } from './tools/search_web_content';

const allTools = [
  searchSignals,
  getCustomerProfile,
  getFeatureHealth,
  getIssueImpact,
  findRelatedEntities,
  getHeatmap,
  getTrends,
  getRoadmapPriorities,
  getStrategicInsights,
  reviewPendingEntities,
  confirmEntityMerge,
  rejectEntityMerge,
  addEntityAlias,
  listEntities,
  splitEntity,
  ingestTranscript,
  ingestDocument,
  generateArtifact,
  listOpportunities,
  generateShareableReport,
  browseKnowledgeGraph,
  getKnowledgeSummary,
  getProvenance,
  getEntityResolutionStats,
  whatIfAnalysis,
  exportData,
  getSystemHealth,
  runPipeline,
  getDlqStatus,
  retryDlqItem,
  reviewAgentOutputs,
  rollbackAgent,
  listRegisteredAgents,
  deactivateAgent,
  configureStakeholderAccess,
  saveSessionState,
  loadSessionState,
  correctSignalExtraction,
  crawlWebsite,
  searchSlack,
  searchDocuments,
  searchTranscripts,
  searchWebContent
];

export function registerTools(server: McpServer): void {
  allTools.forEach((tool) => {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema
      },
      tool.handler
    );
  });
}
