#!/usr/bin/env ts-node
/**
 * Full LLM Pipeline Orchestrator
 * Runs the complete pipeline: Ingestion -> Embeddings -> Clustering -> JIRA Generation
 */

import 'dotenv/config';
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getDbPool, closeDbPool } from '../backend/db/connection';
import { createLLMProviderFromEnv, LLMProvider } from '../backend/services/llm_service';
import { createEmbeddingProviderFromEnv, EmbeddingProvider } from '../backend/services/embedding_provider';
import { processEmbeddingQueue, getEmbeddingStats } from '../backend/services/embedding_service';
import { 
  detectAndStoreOpportunitiesWithEmbeddings,
  getOpportunitiesWithScores,
  getRoadmapSummary,
  mergeRelatedOpportunities
} from '../backend/services/opportunity_service';
import { runDeduplicationPass } from '../backend/services/deduplication_service';
import { 
  generateJiraIssuesForTopOpportunities,
  storeJiraIssueTemplate,
  exportJiraTemplatesToJson,
  JiraIssueTemplate
} from '../backend/services/jira_issue_service';
import { logger } from '../backend/utils/logger';
import { getRunMetrics } from '../backend/utils/run_metrics';

// Configuration
const OUTPUT_DIR = join(process.cwd(), 'output');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const PIPELINE_SIGNAL_SOURCE = process.env.PIPELINE_SIGNAL_SOURCE;

interface PipelineStage {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startTime?: Date;
  endTime?: Date;
  result?: any;
  error?: string;
}

interface PipelineConfig {
  skipIngestion?: boolean;
  skipEmbeddings?: boolean;
  skipClustering?: boolean;
  skipJiraGeneration?: boolean;
  embeddingBatchSize?: number;
  maxJiraIssues?: number;
  outputDir?: string;
}

const DEFAULT_CONFIG: PipelineConfig = {
  skipIngestion: false,
  skipEmbeddings: false,
  skipClustering: false,
  skipJiraGeneration: false,
  embeddingBatchSize: 10,
  maxJiraIssues: 10,
  outputDir: OUTPUT_DIR
};

class LLMPipeline {
  private stages: Map<string, PipelineStage> = new Map();
  private config: PipelineConfig;
  private llmProvider: LLMProvider | null = null;
  private embeddingProvider: EmbeddingProvider | null = null;
  private startTime: Date = new Date();
  private enableDeduplication: boolean = process.env.ENABLE_DEDUPLICATION !== 'false';

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Initialize stages
    const stageNames = [
      'initialization',
      'ingestion',
      'embeddings',
      'deduplication',
      'clustering',
      'opportunity_merge',
      'jira_generation',
      'export'
    ];
    
    stageNames.forEach(name => {
      this.stages.set(name, { name, status: 'pending' });
    });
  }

  private updateStage(name: string, updates: Partial<PipelineStage>) {
    const stage = this.stages.get(name);
    if (stage) {
      Object.assign(stage, updates);
    }
  }

  private printBanner() {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 PM INTELLIGENCE - FULL LLM PIPELINE');
    console.log('='.repeat(70));
    console.log(`Started at: ${this.startTime.toISOString()}`);
    console.log(`Output directory: ${this.config.outputDir}`);
    console.log('='.repeat(70) + '\n');
  }

  private printStageHeader(stageName: string) {
    console.log('\n' + '-'.repeat(60));
    console.log(`📍 Stage: ${stageName.toUpperCase()}`);
    console.log('-'.repeat(60));
  }

  private printSummary() {
    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - this.startTime.getTime()) / 1000);
    
    console.log('\n' + '='.repeat(70));
    console.log('📊 PIPELINE SUMMARY');
    console.log('='.repeat(70));
    
    for (const [name, stage] of this.stages) {
      const icon = stage.status === 'completed' ? '✓' 
        : stage.status === 'failed' ? '✗' 
        : stage.status === 'skipped' ? '⊘' 
        : '?';
      const duration = stage.startTime && stage.endTime 
        ? `(${Math.round((stage.endTime.getTime() - stage.startTime.getTime()) / 1000)}s)`
        : '';
      console.log(`   ${icon} ${name}: ${stage.status} ${duration}`);
    }
    
    console.log(`\nTotal duration: ${duration}s`);
    console.log('='.repeat(70) + '\n');
  }

  async initialize(): Promise<void> {
    this.updateStage('initialization', { status: 'running', startTime: new Date() });
    this.printStageHeader('Initialization');
    
    try {
      // Ensure output directory exists
      if (!existsSync(this.config.outputDir!)) {
        mkdirSync(this.config.outputDir!, { recursive: true });
        console.log(`   ✓ Created output directory: ${this.config.outputDir}`);
      }
      
      // Initialize LLM provider
      console.log('   Initializing Azure OpenAI LLM provider...');
      this.llmProvider = createLLMProviderFromEnv();
      console.log('   ✓ LLM provider ready');
      
      // Initialize embedding provider
      console.log('   Initializing embedding provider...');
      this.embeddingProvider = createEmbeddingProviderFromEnv();
      if (!this.embeddingProvider) {
        console.log('   ⚠ Embedding provider not configured - embeddings will be skipped');
        this.config.skipEmbeddings = true;
      } else {
        console.log('   ✓ Embedding provider ready');
      }
      
      // Test database connection
      console.log('   Testing database connection...');
      const pool = getDbPool();
      await pool.query('SELECT 1');
      console.log('   ✓ Database connection OK');
      
      this.updateStage('initialization', { status: 'completed', endTime: new Date() });
    } catch (error: any) {
      this.updateStage('initialization', { 
        status: 'failed', 
        endTime: new Date(),
        error: error.message 
      });
      throw error;
    }
  }

  async runIngestion(): Promise<void> {
    if (this.config.skipIngestion) {
      this.updateStage('ingestion', { status: 'skipped' });
      console.log('\n   ⊘ Skipping ingestion stage');
      return;
    }
    
    this.updateStage('ingestion', { status: 'running', startTime: new Date() });
    this.printStageHeader('Data Ingestion');
    
    try {
      console.log('   Running LLM-enabled ingestion script...');
      
      // Run the ingestion script as a subprocess
      const result = await this.runScript('scripts/ingest_raw_slack_to_signals.ts');
      
      // Get signal counts
      const pool = getDbPool();
      const signalCount = await pool.query('SELECT COUNT(*) as count FROM signals');
      const extractionCount = await pool.query('SELECT COUNT(*) as count FROM signal_extractions');
      const queueCount = await pool.query('SELECT COUNT(*) as count FROM embedding_queue WHERE status = $1', ['pending']);
      
      const stats = {
        totalSignals: parseInt(signalCount.rows[0].count),
        llmExtractions: parseInt(extractionCount.rows[0].count),
        pendingEmbeddings: parseInt(queueCount.rows[0].count)
      };
      
      console.log(`   ✓ Ingested ${stats.totalSignals} signals`);
      console.log(`   ✓ LLM extractions: ${stats.llmExtractions}`);
      console.log(`   ✓ Queued for embedding: ${stats.pendingEmbeddings}`);
      
      this.updateStage('ingestion', { 
        status: 'completed', 
        endTime: new Date(),
        result: stats
      });
    } catch (error: any) {
      this.updateStage('ingestion', { 
        status: 'failed', 
        endTime: new Date(),
        error: error.message 
      });
      throw error;
    }
  }

  async runEmbeddings(): Promise<void> {
    if (this.config.skipEmbeddings || !this.embeddingProvider) {
      this.updateStage('embeddings', { status: 'skipped' });
      console.log('\n   ⊘ Skipping embeddings stage');
      return;
    }
    
    this.updateStage('embeddings', { status: 'running', startTime: new Date() });
    this.printStageHeader('Embedding Generation');
    
    try {
      const initialStats = await getEmbeddingStats();
      console.log(`   Initial queue: ${initialStats.pendingQueue} pending`);
      
      let totalProcessed = 0;
      let totalFailed = 0;
      let batchCount = 0;
      const maxBatches = parseInt(process.env.EMBEDDING_MAX_BATCHES || '0', 10);
      
      while (maxBatches === 0 || batchCount < maxBatches) {
        const result = await processEmbeddingQueue(
          this.llmProvider!,
          this.embeddingProvider!,
          { batchSize: this.config.embeddingBatchSize }
        );
        
        if (result.processed === 0 && result.failed === 0) break;
        
        totalProcessed += result.processed;
        totalFailed += result.failed;
        batchCount++;
        
        if (batchCount % 5 === 0) {
          console.log(`   Batch ${batchCount}: ${totalProcessed} processed, ${totalFailed} failed`);
        }
        
        // Small delay
        await new Promise(r => setTimeout(r, 300));
      }
      
      const finalStats = await getEmbeddingStats();
      
      const stats = {
        processed: totalProcessed,
        failed: totalFailed,
        coverage: finalStats.coveragePercent
      };
      
      console.log(`   ✓ Processed ${totalProcessed} embeddings`);
      console.log(`   ✓ Coverage: ${finalStats.coveragePercent}%`);
      
      this.updateStage('embeddings', { 
        status: 'completed', 
        endTime: new Date(),
        result: stats
      });
    } catch (error: any) {
      this.updateStage('embeddings', { 
        status: 'failed', 
        endTime: new Date(),
        error: error.message 
      });
      // Don't throw - continue with pipeline
      console.log(`   ⚠ Embedding processing failed: ${error.message}`);
    }
  }

  async runDeduplication(): Promise<void> {
    if (!this.enableDeduplication) {
      this.updateStage('deduplication', { status: 'skipped' });
      console.log('\n   ⊘ Skipping deduplication stage');
      return;
    }

    this.updateStage('deduplication', { status: 'running', startTime: new Date() });
    this.printStageHeader('Signal Deduplication');

    try {
      const result = await runDeduplicationPass();
      console.log(`   ✓ Merged ${result.merged} duplicate signals`);
      console.log(`   ✓ Remaining unique signals: ${result.remaining}`);
      this.updateStage('deduplication', {
        status: 'completed',
        endTime: new Date(),
        result
      });
    } catch (error: any) {
      this.updateStage('deduplication', {
        status: 'failed',
        endTime: new Date(),
        error: error.message
      });
      console.log(`   ⚠ Deduplication failed: ${error.message}`);
    }
  }

  async runClustering(): Promise<void> {
    if (this.config.skipClustering) {
      this.updateStage('clustering', { status: 'skipped' });
      console.log('\n   ⊘ Skipping clustering stage');
      return;
    }
    
    this.updateStage('clustering', { status: 'running', startTime: new Date() });
    this.printStageHeader('Opportunity Clustering');
    
    try {
      console.log('   Running embedding-based clustering...');
      
      const result = await detectAndStoreOpportunitiesWithEmbeddings({
        similarityThreshold: 0.7,
        minClusterSize: 2,
        useHybrid: true,
        signalSource: PIPELINE_SIGNAL_SOURCE
      });
      
      // Get opportunity scores
      const scoredOpportunities = await getOpportunitiesWithScores({}, {
        signalSource: PIPELINE_SIGNAL_SOURCE,
        requireExclusiveSource: Boolean(PIPELINE_SIGNAL_SOURCE)
      });
      
      const stats = {
        newOpportunities: result.newOpportunities.length,
        signalsProcessed: result.signalsProcessed,
        totalOpportunities: scoredOpportunities.length,
        avgScore: scoredOpportunities.length > 0
          ? Math.round(scoredOpportunities.reduce((a, o) => a + o.roadmapScore.overallScore, 0) / scoredOpportunities.length)
          : 0
      };
      
      console.log(`   ✓ Created ${stats.newOpportunities} new opportunities`);
      console.log(`   ✓ Total opportunities: ${stats.totalOpportunities}`);
      console.log(`   ✓ Average roadmap score: ${stats.avgScore}`);

      // Validation logging
      const pool = getDbPool();
      const scoreValues = scoredOpportunities.map(o => o.roadmapScore.overallScore);
      const scoreStats = scoreValues.length > 0
        ? {
            min: Math.min(...scoreValues),
            max: Math.max(...scoreValues),
            avg: Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length)
          }
        : { min: 0, max: 0, avg: 0 };

      const customerCoverageQuery = PIPELINE_SIGNAL_SOURCE
        ? `
          SELECT COUNT(DISTINCT se.entity_id) as count
          FROM opportunity_signals os
          JOIN signal_entities se ON se.signal_id = os.signal_id
          JOIN signals s ON s.id = os.signal_id
          WHERE se.entity_type = 'customer' AND s.source = $1
        `
        : `
          SELECT COUNT(DISTINCT se.entity_id) as count
          FROM opportunity_signals os
          JOIN signal_entities se ON se.signal_id = os.signal_id
          WHERE se.entity_type = 'customer'
        `;
      const themeCoverageQuery = PIPELINE_SIGNAL_SOURCE
        ? `
          SELECT COUNT(DISTINCT sth.theme_id) as count
          FROM opportunity_signals os
          JOIN signal_theme_hierarchy sth ON sth.signal_id = os.signal_id
          JOIN signals s ON s.id = os.signal_id
          WHERE s.source = $1
        `
        : `
          SELECT COUNT(DISTINCT sth.theme_id) as count
          FROM opportunity_signals os
          JOIN signal_theme_hierarchy sth ON sth.signal_id = os.signal_id
        `;

      const customerCoverageResult = await pool.query(
        customerCoverageQuery,
        PIPELINE_SIGNAL_SOURCE ? [PIPELINE_SIGNAL_SOURCE] : []
      );
      const themeCoverageResult = await pool.query(
        themeCoverageQuery,
        PIPELINE_SIGNAL_SOURCE ? [PIPELINE_SIGNAL_SOURCE] : []
      );

      console.log(`   ✓ Score distribution: min=${scoreStats.min}, avg=${scoreStats.avg}, max=${scoreStats.max}`);
      console.log(`   ✓ Customer coverage: ${customerCoverageResult.rows[0]?.count || 0}`);
      console.log(`   ✓ Theme diversity: ${themeCoverageResult.rows[0]?.count || 0}`);
      
      this.updateStage('clustering', { 
        status: 'completed', 
        endTime: new Date(),
        result: stats
      });
    } catch (error: any) {
      this.updateStage('clustering', { 
        status: 'failed', 
        endTime: new Date(),
        error: error.message 
      });
      console.log(`   ⚠ Clustering failed: ${error.message}`);
    }
  }

  async runOpportunityMerge(): Promise<void> {
    this.updateStage('opportunity_merge', { status: 'running', startTime: new Date() });
    this.printStageHeader('Opportunity Merge');
    try {
      const merged = await mergeRelatedOpportunities(0.5);
      console.log(`   ✓ Merged ${merged} overlapping opportunities`);
      this.updateStage('opportunity_merge', {
        status: 'completed',
        endTime: new Date(),
        result: { merged }
      });
    } catch (error: any) {
      this.updateStage('opportunity_merge', {
        status: 'failed',
        endTime: new Date(),
        error: error.message
      });
      console.log(`   ⚠ Opportunity merge failed: ${error.message}`);
    }
  }

  async runJiraGeneration(): Promise<JiraIssueTemplate[]> {
    if (this.config.skipJiraGeneration) {
      this.updateStage('jira_generation', { status: 'skipped' });
      console.log('\n   ⊘ Skipping JIRA generation stage');
      return [];
    }
    
    this.updateStage('jira_generation', { status: 'running', startTime: new Date() });
    this.printStageHeader('JIRA Issue Generation');
    
    try {
      console.log(`   Generating JIRA issues for top ${this.config.maxJiraIssues} opportunities...`);
      
      const issues = await generateJiraIssuesForTopOpportunities(
        this.config.maxJiraIssues,
        {},
        {
          signalSource: PIPELINE_SIGNAL_SOURCE,
          requireExclusiveSource: Boolean(PIPELINE_SIGNAL_SOURCE)
        }
      );
      
      // Store templates
      for (const issue of issues) {
        await storeJiraIssueTemplate(issue);
      }
      
      console.log(`   ✓ Generated ${issues.length} JIRA issue templates`);
      
      // Show summary
      if (issues.length > 0) {
        console.log('\n   📋 Generated Issues:');
        issues.slice(0, 5).forEach((issue, i) => {
          console.log(`      ${i + 1}. [${issue.issueType}] ${issue.summary.substring(0, 60)}...`);
          console.log(`         Priority: ${issue.priority} | Impact: ${issue.customerImpact}`);
        });
        if (issues.length > 5) {
          console.log(`      ... and ${issues.length - 5} more`);
        }
      }
      
      this.updateStage('jira_generation', { 
        status: 'completed', 
        endTime: new Date(),
        result: { count: issues.length }
      });
      
      return issues;
    } catch (error: any) {
      this.updateStage('jira_generation', { 
        status: 'failed', 
        endTime: new Date(),
        error: error.message 
      });
      console.log(`   ⚠ JIRA generation failed: ${error.message}`);
      return [];
    }
  }

  async runExport(jiraIssues: JiraIssueTemplate[]): Promise<void> {
    this.updateStage('export', { status: 'running', startTime: new Date() });
    this.printStageHeader('Export Results');
    
    try {
      const pool = getDbPool();
      
      // Export JIRA issues
      if (jiraIssues.length > 0) {
        const jiraPath = join(this.config.outputDir!, `jira_issues_${TIMESTAMP}.json`);
        writeFileSync(jiraPath, exportJiraTemplatesToJson(jiraIssues));
        console.log(`   ✓ Exported JIRA issues to: ${jiraPath}`);
      }
      
      // Export roadmap summary
      const summary = await getRoadmapSummary({}, {
        signalSource: PIPELINE_SIGNAL_SOURCE,
        requireExclusiveSource: Boolean(PIPELINE_SIGNAL_SOURCE)
      });
      const summaryPath = join(this.config.outputDir!, `roadmap_summary_${TIMESTAMP}.json`);
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
      console.log(`   ✓ Exported roadmap summary to: ${summaryPath}`);
      
      // Export opportunities
      const oppsResult = PIPELINE_SIGNAL_SOURCE
        ? await pool.query(
            `
              SELECT o.*, COUNT(os.signal_id) as signal_count
              FROM opportunities o
              JOIN opportunity_signals os ON o.id = os.opportunity_id
              JOIN signals s ON s.id = os.signal_id
              GROUP BY o.id
              HAVING SUM(CASE WHEN s.source = $1 THEN 1 ELSE 0 END) = COUNT(*)
              ORDER BY o.created_at DESC
            `,
            [PIPELINE_SIGNAL_SOURCE]
          )
        : await pool.query(`
            SELECT o.*, COUNT(os.signal_id) as signal_count
            FROM opportunities o
            LEFT JOIN opportunity_signals os ON o.id = os.opportunity_id
            GROUP BY o.id
            ORDER BY o.created_at DESC
          `);
      const oppsPath = join(this.config.outputDir!, `opportunities_${TIMESTAMP}.json`);
      writeFileSync(oppsPath, JSON.stringify(oppsResult.rows, null, 2));
      console.log(`   ✓ Exported ${oppsResult.rows.length} opportunities to: ${oppsPath}`);
      
      // Export signal extractions sample
      const extractionsResult = PIPELINE_SIGNAL_SOURCE
        ? await pool.query(
            `
              SELECT se.*, s.content as signal_content
              FROM signal_extractions se
              JOIN signals s ON s.id = se.signal_id
              WHERE s.source = $1
              ORDER BY se.created_at DESC
              LIMIT 50
            `,
            [PIPELINE_SIGNAL_SOURCE]
          )
        : await pool.query(`
            SELECT se.*, s.content as signal_content
            FROM signal_extractions se
            JOIN signals s ON s.id = se.signal_id
            ORDER BY se.created_at DESC
            LIMIT 50
          `);
      const extractionsPath = join(this.config.outputDir!, `llm_extractions_sample_${TIMESTAMP}.json`);
      writeFileSync(extractionsPath, JSON.stringify(extractionsResult.rows, null, 2));
      console.log(`   ✓ Exported ${extractionsResult.rows.length} LLM extraction samples`);
      
      // Generate pipeline report
      const report = this.generatePipelineReport(jiraIssues, summary);
      const reportPath = join(this.config.outputDir!, `pipeline_report_${TIMESTAMP}.md`);
      writeFileSync(reportPath, report);
      console.log(`   ✓ Generated pipeline report: ${reportPath}`);
      getRunMetrics().exportToFile(join(this.config.outputDir!, 'run_metrics.json'));
      
      this.updateStage('export', { 
        status: 'completed', 
        endTime: new Date(),
        result: { 
          jiraIssues: jiraIssues.length,
          opportunities: oppsResult.rows.length 
        }
      });
    } catch (error: any) {
      this.updateStage('export', { 
        status: 'failed', 
        endTime: new Date(),
        error: error.message 
      });
      throw error;
    }
  }

  async writeReadinessSummary(): Promise<void> {
    const pool = getDbPool();
    const stageList = Array.from(this.stages.values());
    const failedStages = stageList.filter((stage) => stage.status === 'failed').map((stage) => stage.name);
    const completedStages = stageList.filter((stage) => stage.status === 'completed').map((stage) => stage.name);
    const outputDir = this.config.outputDir!;

    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM signals) AS signals,
        (SELECT COUNT(*)::int FROM signal_extractions) AS extractions,
        (SELECT COUNT(*)::int FROM entity_registry) AS entities,
        (SELECT COUNT(*)::int FROM opportunities) AS opportunities,
        (SELECT COUNT(*)::int FROM jira_issue_templates) AS jira_templates,
        (SELECT COUNT(*)::int FROM failed_signal_attempts WHERE status = 'pending') AS remaining_failed,
        (SELECT COUNT(*)::int FROM failed_signal_attempts) AS total_failed,
        (SELECT COUNT(*)::int FROM failed_signal_attempts WHERE status = 'recovered') AS replay_recovered
    `);
    const row = counts.rows[0];
    const providerSummary = {
      llm_provider: process.env.LLM_PROVIDER || 'mock',
      embedding_provider: process.env.EMBEDDING_PROVIDER || 'mock',
      zero_mock: (process.env.LLM_PROVIDER || '').toLowerCase() !== 'mock' &&
        (process.env.EMBEDDING_PROVIDER || '').toLowerCase() !== 'mock'
    };

    const files = existsSync(outputDir)
      ? readdirSync(outputDir).map((file) => {
          const filePath = join(outputDir, file);
          return { file, size_bytes: statSync(filePath).size };
        })
      : [];
    const allStagesHealthy = failedStages.length === 0;
    const pass =
      allStagesHealthy &&
      row.signals > 0 &&
      row.extractions > 0 &&
      row.opportunities > 0 &&
      row.jira_templates > 0 &&
      providerSummary.zero_mock;
    const status = pass ? 'PASS' : allStagesHealthy ? 'PARTIAL' : 'FAIL';

    const readiness = {
      status,
      started_at: this.startTime.toISOString(),
      completed_at: new Date().toISOString(),
      total_duration_seconds: Math.round((Date.now() - this.startTime.getTime()) / 1000),
      stages: stageList.map((stage) => ({
        name: stage.name,
        status: stage.status,
        error: stage.error || null
      })),
      stage_summary: {
        completed: completedStages,
        failed: failedStages
      },
      counts: row,
      provider_summary: providerSummary,
      run_metrics: getRunMetrics().snapshot(),
      artifacts: files
    };

    writeFileSync(join(outputDir, 'READINESS_SUMMARY.json'), JSON.stringify(readiness, null, 2));
    const markdown = [
      `# Readiness Summary`,
      ``,
      `Status: **${status}**`,
      ``,
      `## Stage Health`,
      ...stageList.map((stage) => `- ${stage.name}: ${stage.status}${stage.error ? ` (${stage.error})` : ''}`),
      ``,
      `## Counts`,
      `- Signals: ${row.signals}`,
      `- Extractions: ${row.extractions}`,
      `- Entities: ${row.entities}`,
      `- Opportunities: ${row.opportunities}`,
      `- JIRA templates: ${row.jira_templates}`,
      `- Failed total: ${row.total_failed}`,
      `- Failed remaining: ${row.remaining_failed}`,
      `- Replay recovered: ${row.replay_recovered}`,
      ``,
      `## Provider Check`,
      `- LLM provider: ${providerSummary.llm_provider}`,
      `- Embedding provider: ${providerSummary.embedding_provider}`,
      `- Zero mock: ${providerSummary.zero_mock ? 'yes' : 'no'}`,
      ``,
      `## Artifacts`,
      ...files.map((entry) => `- ${entry.file} (${entry.size_bytes} bytes)`)
    ].join('\n');
    writeFileSync(join(outputDir, 'READINESS_SUMMARY.md'), markdown);
  }

  private generatePipelineReport(jiraIssues: JiraIssueTemplate[], summary: any): string {
    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - this.startTime.getTime()) / 1000);
    
    let report = `# PM Intelligence Pipeline Report
Generated: ${endTime.toISOString()}
Duration: ${duration} seconds

## Pipeline Stages

| Stage | Status | Duration |
|-------|--------|----------|
`;
    
    for (const [name, stage] of this.stages) {
      const stageDuration = stage.startTime && stage.endTime 
        ? `${Math.round((stage.endTime.getTime() - stage.startTime.getTime()) / 1000)}s`
        : 'N/A';
      report += `| ${name} | ${stage.status} | ${stageDuration} |\n`;
    }
    
    report += `
## Roadmap Summary

- **Total Opportunities**: ${summary.totalOpportunities}
- **Average Impact Score**: ${summary.averageScores?.impact || 'N/A'}
- **Average Confidence Score**: ${summary.averageScores?.confidence || 'N/A'}

### Impact Distribution
- High: ${summary.byImpact?.high || 0}
- Medium: ${summary.byImpact?.medium || 0}
- Low: ${summary.byImpact?.low || 0}

## Generated JIRA Issues

Total: ${jiraIssues.length}

`;
    
    jiraIssues.forEach((issue, i) => {
      report += `### ${i + 1}. ${issue.summary}

- **Type**: ${issue.issueType}
- **Priority**: ${issue.priority}
- **Impact**: ${issue.customerImpact}
- **Complexity**: ${issue.estimatedComplexity}
- **Affected Customers**: ${issue.affectedCustomers.join(', ') || 'Various'}

**Acceptance Criteria:**
${issue.acceptanceCriteria.map(ac => `- ${ac}`).join('\n')}

---

`;
    });
    
    return report;
  }

  private runScript(scriptPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('npx', ['ts-node', '--transpile-only', scriptPath], {
        cwd: process.cwd(),
        stdio: ['inherit', 'pipe', 'pipe'],
        env: process.env
      });
      
      let output = '';
      let errorOutput = '';
      
      child.stdout?.on('data', (data) => {
        const text = data.toString();
        output += text;
        process.stdout.write(text);
      });
      
      child.stderr?.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        process.stderr.write(text);
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Script failed with code ${code}: ${errorOutput}`));
        }
      });
      
      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  async run(): Promise<void> {
    this.printBanner();
    
    try {
      await this.initialize();
      await this.runIngestion();
      await this.runEmbeddings();
      await this.runDeduplication();
      await this.runClustering();
      await this.runOpportunityMerge();
      const jiraIssues = await this.runJiraGeneration();
      await this.runExport(jiraIssues);
      await this.writeReadinessSummary();
      
      this.printSummary();
      
      console.log('✅ Pipeline completed successfully!\n');
      console.log(`📁 Results saved to: ${this.config.outputDir}\n`);
      
    } catch (error: any) {
      this.printSummary();
      console.error(`\n❌ Pipeline failed: ${error.message}\n`);
      throw error;
    } finally {
      await closeDbPool();
    }
  }
}

// Parse command line arguments
function parseArgs(): Partial<PipelineConfig> {
  const args = process.argv.slice(2);
  const config: Partial<PipelineConfig> = {};
  
  args.forEach(arg => {
    if (arg === '--skip-ingestion') config.skipIngestion = true;
    if (arg === '--skip-embeddings') config.skipEmbeddings = true;
    if (arg === '--skip-clustering') config.skipClustering = true;
    if (arg === '--skip-jira') config.skipJiraGeneration = true;
    if (arg.startsWith('--max-jira=')) {
      config.maxJiraIssues = parseInt(arg.split('=')[1], 10);
    }
    if (arg.startsWith('--output=')) {
      config.outputDir = arg.split('=')[1];
    }
  });
  
  return config;
}

// Main execution
async function main() {
  const config = parseArgs();
  const pipeline = new LLMPipeline(config);
  await pipeline.run();
}

main().catch(err => {
  console.error('Pipeline error:', err);
  process.exit(1);
});
