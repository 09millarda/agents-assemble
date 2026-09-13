"""Deterministic ZIP, independent of file timestamps. No cloud actions."""
import hashlib
import json
from pathlib import Path
import zipfile

directory = Path('dist')
with zipfile.ZipFile(directory / 'function.zip', 'w') as archive:
    info = zipfile.ZipInfo('index.mjs', date_time=(2026, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED
    info.external_attr = 0o100644 << 16
    info.create_system = 3
    archive.writestr(info, (directory / 'index.mjs').read_bytes())
data = (directory / 'function.zip').read_bytes()
manifest = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
(directory / 'artifact.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest))
