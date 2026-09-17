-- Existing workflows were already runnable before lifecycle statuses existed.
UPDATE workflows
SET definition = jsonb_set(definition, '{status}', '"published"'::jsonb, true)
WHERE NOT (definition ? 'status');

UPDATE workflows
SET definition = jsonb_set(definition, '{tags}', '[]'::jsonb, true)
WHERE NOT (definition ? 'tags');
