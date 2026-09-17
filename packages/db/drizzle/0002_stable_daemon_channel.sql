-- Stable per-machine daemon identity: drop the dead pairing-code path and
-- collapse duplicate daemon rows left over from the per-login era.
DELETE FROM daemons a USING daemons b
WHERE a.machine_name = b.machine_name AND a.created_at < b.created_at;
DROP TABLE IF EXISTS pairing_codes;
ALTER TABLE device_authorizations ADD COLUMN IF NOT EXISTS requested_daemon_id TEXT;
