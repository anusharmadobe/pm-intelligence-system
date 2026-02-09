
CREATE TABLE signals (
  id UUID PRIMARY KEY,
  source TEXT,
  source_ref TEXT,
  signal_type TEXT,
  content TEXT,
  normalized_content TEXT,
  severity INT,
  confidence FLOAT,
  metadata JSONB,
  created_at TIMESTAMP
);

CREATE TABLE opportunities (
  id UUID PRIMARY KEY,
  title TEXT,
  description TEXT,
  status TEXT,
  created_at TIMESTAMP
);

CREATE TABLE opportunity_signals (
  opportunity_id UUID,
  signal_id UUID,
  PRIMARY KEY (opportunity_id, signal_id)
);

CREATE TABLE judgments (
  id UUID PRIMARY KEY,
  opportunity_id UUID,
  summary TEXT,
  assumptions JSONB,
  missing_evidence JSONB,
  confidence_level TEXT,
  created_at TIMESTAMP
);

CREATE TABLE artifacts (
  id UUID PRIMARY KEY,
  judgment_id UUID,
  artifact_type TEXT,
  content TEXT,
  created_at TIMESTAMP
);
