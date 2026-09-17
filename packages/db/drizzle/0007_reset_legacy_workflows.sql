-- Workflows written before the visual graph cutover are not compatible with
-- the current definition contract. Reset them to an empty editable canvas;
-- do not silently convert their retired activities or execution actions.
UPDATE workflows
SET definition = jsonb_build_object(
  'workflowId', workflow_id,
  'name', COALESCE(NULLIF(BTRIM(definition ->> 'name'), ''), 'Untitled workflow'),
  'activities', '[]'::jsonb,
  'positions', '{}'::jsonb
)
WHERE definition ? 'loops'
   OR definition ? 'documents'
   OR NOT (definition ? 'positions');
