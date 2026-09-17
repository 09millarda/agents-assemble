UPDATE workflows
SET definition = jsonb_set(definition, '{description}', to_jsonb(''::text), true)
WHERE NOT (definition ? 'description');
