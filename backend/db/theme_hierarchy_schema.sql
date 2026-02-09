-- Hierarchical theme taxonomy with 4 levels
-- Level 1: Domain (e.g., "Product Capabilities", "Quality Attributes")
-- Level 2: Category (e.g., "User Experience", "Platform Services")
-- Level 3: Theme (e.g., "Authoring UX", "Integrations")
-- Level 4: Sub-theme (e.g., "Forms Experience Builder", "Marketo Connector")

CREATE TABLE IF NOT EXISTS theme_hierarchy (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,  -- URL-friendly identifier
  level INT NOT NULL CHECK (level BETWEEN 1 AND 4),
  parent_id TEXT REFERENCES theme_hierarchy(id) ON DELETE CASCADE,
  keywords TEXT[] DEFAULT '{}',
  description TEXT,
  priority INT DEFAULT 0,  -- Higher = more important
  is_active BOOLEAN DEFAULT TRUE,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(slug),
  UNIQUE(name, parent_id)
);

-- Indexes for efficient hierarchy traversal
CREATE INDEX IF NOT EXISTS idx_theme_hierarchy_level ON theme_hierarchy(level);
CREATE INDEX IF NOT EXISTS idx_theme_hierarchy_parent ON theme_hierarchy(parent_id);
CREATE INDEX IF NOT EXISTS idx_theme_hierarchy_active ON theme_hierarchy(is_active);
CREATE INDEX IF NOT EXISTS idx_theme_hierarchy_priority ON theme_hierarchy(priority DESC);
CREATE INDEX IF NOT EXISTS idx_theme_hierarchy_keywords ON theme_hierarchy USING gin(keywords);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_theme_hierarchy_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_theme_hierarchy_updated_at ON theme_hierarchy;
CREATE TRIGGER trigger_theme_hierarchy_updated_at
  BEFORE UPDATE ON theme_hierarchy
  FOR EACH ROW
  EXECUTE FUNCTION update_theme_hierarchy_updated_at();

-- Signal to hierarchical theme mapping (many-to-many)
CREATE TABLE IF NOT EXISTS signal_theme_hierarchy (
  signal_id UUID REFERENCES signals(id) ON DELETE CASCADE,
  theme_id TEXT REFERENCES theme_hierarchy(id) ON DELETE CASCADE,
  confidence FLOAT DEFAULT 0.5,
  matched_at_level INT,  -- Which level was matched
  matched_keywords TEXT[],  -- Which keywords triggered the match
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (signal_id, theme_id)
);

CREATE INDEX IF NOT EXISTS idx_signal_theme_hierarchy_signal ON signal_theme_hierarchy(signal_id);
CREATE INDEX IF NOT EXISTS idx_signal_theme_hierarchy_theme ON signal_theme_hierarchy(theme_id);
CREATE INDEX IF NOT EXISTS idx_signal_theme_hierarchy_level ON signal_theme_hierarchy(matched_at_level);

-- Recursive function to get full theme path
CREATE OR REPLACE FUNCTION get_theme_path(theme_id TEXT)
RETURNS TABLE (
  path_id TEXT,
  path_name TEXT,
  path_level INT,
  path_order INT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE theme_path AS (
    -- Base case: start with the given theme
    SELECT id, name, level, 1 as path_order
    FROM theme_hierarchy
    WHERE id = theme_id
    
    UNION ALL
    
    -- Recursive case: get parent
    SELECT th.id, th.name, th.level, tp.path_order + 1
    FROM theme_hierarchy th
    JOIN theme_path tp ON th.id = (
      SELECT parent_id FROM theme_hierarchy WHERE id = tp.id
    )
    WHERE th.id IS NOT NULL
  )
  SELECT id, name, level, path_order
  FROM theme_path
  ORDER BY level ASC;
END;
$$;

-- Function to get all descendant themes
CREATE OR REPLACE FUNCTION get_theme_descendants(root_theme_id TEXT)
RETURNS TABLE (
  descendant_id TEXT,
  descendant_name TEXT,
  descendant_level INT,
  depth INT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE descendants AS (
    -- Base case: direct children
    SELECT id, name, level, 1 as depth
    FROM theme_hierarchy
    WHERE parent_id = root_theme_id
    
    UNION ALL
    
    -- Recursive case: children of children
    SELECT th.id, th.name, th.level, d.depth + 1
    FROM theme_hierarchy th
    JOIN descendants d ON th.parent_id = d.id
  )
  SELECT id, name, level, depth
  FROM descendants
  ORDER BY level ASC, name ASC;
END;
$$;

-- Function to count signals by theme (including descendants)
CREATE OR REPLACE FUNCTION count_signals_by_theme_with_descendants(root_theme_id TEXT)
RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  signal_count BIGINT;
BEGIN
  SELECT COUNT(DISTINCT sth.signal_id) INTO signal_count
  FROM signal_theme_hierarchy sth
  WHERE sth.theme_id = root_theme_id
     OR sth.theme_id IN (SELECT descendant_id FROM get_theme_descendants(root_theme_id));
  
  RETURN signal_count;
END;
$$;

-- Insert initial hierarchy based on existing themes
-- This is seed data - will be populated by theme_dictionary.ts
