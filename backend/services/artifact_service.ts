import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import { getDbPool } from '../db/connection';
import { getJudgmentById } from './judgment_service';
import { draftArtifact, LLMProvider } from './llm_service';

export interface Artifact {
  id: string;
  judgment_id: string;
  artifact_type: string;
  content: string;
  created_at: Date;
}

/**
 * Creates an artifact from a judgment.
 * Artifacts require a judgment_id (data contract).
 * Assumptions are clearly labeled in the artifact.
 * Uses Cursor's built-in LLM via llmProvider.
 */
export async function createArtifact(
  judgmentId: string,
  artifactType: 'PRD' | 'RFC',
  userId: string,
  llmProvider: LLMProvider
): Promise<Artifact> {
  if (!userId) {
    throw new Error("Human required - artifacts require human-in-the-loop");
  }

  if (!llmProvider) {
    throw new Error("LLM provider required - uses Cursor's built-in LLM");
  }

  // Verify judgment exists
  const judgment = await getJudgmentById(judgmentId);
  if (!judgment) {
    throw new Error(`Judgment ${judgmentId} not found`);
  }

  // LLM drafts artifact (ARTIFACT_DRAFT) - uses Cursor's built-in LLM
  const draftContent = await draftArtifact(judgment, artifactType, llmProvider);

  // Create artifact
  const artifact: Artifact = {
    id: randomUUID(),
    judgment_id: judgmentId,
    artifact_type: artifactType,
    content: draftContent,
    created_at: new Date()
  };

  await storeArtifact(artifact);

  return artifact;
}

/**
 * Creates an artifact from extension-provided content.
 * Extension supplies finalized artifact content via API.
 */
export async function createArtifactFromData(data: {
  judgmentId: string;
  artifactType: string;
  content: string;
}): Promise<Artifact> {
  if (!data.judgmentId || !data.artifactType || !data.content) {
    throw new Error('Missing required fields: judgmentId, artifactType, content');
  }

  // Verify judgment exists
  const judgment = await getJudgmentById(data.judgmentId);
  if (!judgment) {
    throw new Error(`Judgment ${data.judgmentId} not found`);
  }

  const artifact: Artifact = {
    id: randomUUID(),
    judgment_id: data.judgmentId,
    artifact_type: data.artifactType,
    content: data.content,
    created_at: new Date()
  };

  await storeArtifact(artifact);

  return artifact;
}

/**
 * Stores an artifact in the database.
 */
async function storeArtifact(artifact: Artifact): Promise<void> {
  const pool = getDbPool();
  
  await pool.query(
    `INSERT INTO artifacts (id, judgment_id, artifact_type, content, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      artifact.id,
      artifact.judgment_id,
      artifact.artifact_type,
      artifact.content,
      artifact.created_at
    ]
  );
}

/**
 * Retrieves all artifacts for a judgment.
 */
export async function getArtifactsForJudgment(judgmentId: string): Promise<Artifact[]> {
  const pool = getDbPool();
  const result = await pool.query(
    'SELECT * FROM artifacts WHERE judgment_id = $1 ORDER BY created_at DESC',
    [judgmentId]
  );
  return result.rows.map(row => ({
    ...row,
    created_at: new Date(row.created_at)
  }));
}

/**
 * Retrieves an artifact by ID.
 */
export async function getArtifactById(artifactId: string): Promise<Artifact | null> {
  const pool = getDbPool();
  const result = await pool.query('SELECT * FROM artifacts WHERE id = $1', [artifactId]);
  
  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    ...row,
    created_at: new Date(row.created_at)
  };
}

/**
 * Retrieves all artifacts.
 */
export async function getAllArtifacts(): Promise<Artifact[]> {
  const pool = getDbPool();
  const result = await pool.query('SELECT * FROM artifacts ORDER BY created_at DESC');
  return result.rows.map(row => ({
    ...row,
    created_at: new Date(row.created_at)
  }));
}
