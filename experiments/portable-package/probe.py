"""THROWAWAY #17 experiment. Python parser fixture, not the production TS SDK.
Run: python3 experiments/portable-package/probe.py
Only the explicitly named probe schema is interpreted. No package code is run.
"""
import base64
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import struct
import sys
import tempfile
import time
import zipfile
import zlib
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives import serialization

LIMITS = dict(archive=4*1024*1024, entries=64, entry=512*1024,
              manifest=256*1024, components=32, depth=32, nodes=20000, string=65536)
HEX = re.compile(r"[0-9a-f]{64}\Z")
TOKEN = re.compile(r"[a-zA-Z0-9_.-]{1,80}\Z")
PATH = re.compile(r"[a-z0-9_.-]+(?:/[a-z0-9_.-]+)*\Z")
DOMAIN = b"agents-assemble/package-component/v1\x00"
HERE = Path(__file__).resolve().parent

class Rejected(Exception): pass
def need(condition, reason):
    if not condition: raise Rejected(reason)
def sha(b): return hashlib.sha256(b).hexdigest()
def exact(o, keys): need(type(o) is dict and set(o) == set(keys.split()), 'fields')
def token(s): need(type(s) is str and bool(TOKEN.fullmatch(s)), 'token')
def digest(s): need(type(s) is str and bool(HEX.fullmatch(s)), 'digest-shape')
def canonical(o):
    """JCS-compatible restricted metadata domain: ASCII keys, safe integers, Unicode values."""
    count = 0
    def walk(x, depth):
        nonlocal count
        count += 1
        need(count <= LIMITS['nodes'] and depth <= LIMITS['depth'], 'json-budget')
        if x is None or type(x) is bool: return
        if type(x) is int:
            need(abs(x) <= 9007199254740991, 'number-domain'); return
        if type(x) is str:
            need(len(x.encode('utf-8', errors='surrogatepass')) <= LIMITS['string'], 'string-budget')
            need(not any(0xD800 <= ord(c) <= 0xDFFF for c in x), 'unicode'); return
        if type(x) is list:
            for v in x: walk(v, depth+1)
            return
        need(type(x) is dict, 'number-or-json-domain')
        for k,v in x.items():
            need(type(k) is str and k.isascii(), 'metadata-key-domain')
            walk(k, depth+1); walk(v, depth+1)
    walk(o, 0)
    return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(',',':'), allow_nan=False).encode('utf-8')

def parse_json(b):
    # Preflight structural nesting before the recursive standard-library decoder.
    level = 0; quoted = False; escaped = False
    for c in b:
        if quoted:
            if escaped: escaped = False
            elif c == 92: escaped = True
            elif c == 34: quoted = False
        elif c == 34: quoted = True
        elif c in (91,123):
            level += 1; need(level <= LIMITS['depth'], 'json-depth')
        elif c in (93,125): level -= 1
    def pairs(p):
        d = {}
        for k,v in p:
            need(k not in d, 'duplicate-json-key'); d[k] = v
        return d
    try:
        o = json.loads(b.decode('utf-8'), object_pairs_hook=pairs,
                       parse_constant=lambda _: (_ for _ in ()).throw(Rejected('json-constant')))
        canonical(o)
        return o
    except (ValueError, UnicodeError, RecursionError) as e: raise Rejected('json-syntax') from e

def pack(entries, reverse=False, year=2026, compression=zipfile.ZIP_STORED):
    out = io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        for name,data in sorted(entries.items(), reverse=reverse):
            i=zipfile.ZipInfo(name, (year,1,1,0,0,0)); i.compress_type=compression
            i.create_system=3; i.external_attr=(stat.S_IFREG|0o644)<<16
            z.writestr(i,data)
    return out.getvalue()

def unpack(b):
    """Strict stored-only ZIP profile; examine local and central records before reads.
    No extraction, links, compression, descriptors, comments, extras, prefixes, gaps,
    ZIP64, encrypted/multidisk entries or trailing bytes. CRC and SHA are distinct.
    """
    need(22 <= len(b) <= LIMITS['archive'], 'archive-budget')
    try:
        e=struct.unpack_from('<4s4H2IH',b,len(b)-22)
        need(e[0]==b'PK\x05\x06' and e[1:3]==(0,0) and e[3]==e[4] and e[7]==0, 'zip-end')
        count,size,start=e[4:7]
        need(1 <= count <= LIMITS['entries'], 'entry-count')
        need(start+size == len(b)-22, 'zip-directory')
        pos=start; local_end=0; entries={}; total=0
        for _ in range(count):
            h=struct.unpack_from('<4s6H3I5H2I',b,pos)
            need(h[0]==b'PK\x01\x02', 'zip-central')
            _,made,version,flags,method,mtime,mdate,crc,csize,usize,nlen,xlen,clen,disk,internal,external,offset=h
            need(version==20 and flags==0 and method==0 and xlen==clen==disk==internal==0, 'zip-profile')
            need(made==788 and external==((stat.S_IFREG|0o644)<<16), 'zip-file-type')
            need(csize==usize and usize<=LIMITS['entry'] and 1 <= nlen <= 80, 'entry-budget')
            name=b[pos+46:pos+46+nlen].decode('ascii')
            need(name=='manifest.json' or bool(re.fullmatch(r'blobs/[0-9a-f]{64}',name)), 'archive-path')
            need(name not in entries, 'duplicate-entry')
            need(offset==local_end, 'zip-overlap-or-gap')
            l=struct.unpack_from('<4s5H3I2H',b,offset)
            need(l==(b'PK\x03\x04',version,flags,method,mtime,mdate,crc,csize,usize,nlen,0), 'zip-local-mismatch')
            need(b[offset+30:offset+30+nlen]==name.encode(), 'zip-name-mismatch')
            end=offset+30+nlen+usize
            need(end<=start, 'zip-entry-bounds')
            payload=b[offset+30+nlen:end]
            need((zlib.crc32(payload)&0xffffffff)==crc, 'crc')
            total+=usize; need(total<=LIMITS['archive'], 'expanded-budget')
            entries[name]=payload; local_end=end; pos+=46+nlen
        need(pos==start+size and local_end==start, 'zip-layout')
        need('manifest.json' in entries and len(entries['manifest.json'])<=LIMITS['manifest'], 'manifest-budget')
        return entries
    except (struct.error,UnicodeError) as e: raise Rejected('zip-malformed') from e

def identity(c): return '/'.join(c['origin']+[c['version']])

def validate_component(c, blobs):
    exact(c, 'origin version kind schema entrypoint files dependencies runtimeSlots permissions terms derivedFrom changelog')
    need(type(c['origin']) is list and len(c['origin'])==3, 'origin')
    for x in c['origin']+[c['version']]: token(x)
    need(c['kind'] in ['playbook','skill','schema'], 'kind')
    need(c['schema']=='aa-probe/1', 'unsupported-schema')
    need(type(c['files']) is list and 1<=len(c['files'])<=32, 'file-count')
    names=[]
    for f in c['files']:
        exact(f,'path size digest'); p=f['path']; digest(f['digest'])
        need(type(p) is str and len(p)<=160 and PATH.fullmatch(p) and all(x not in ['.','..'] for x in p.split('/')), 'logical-path')
        need(p not in names, 'logical-path-duplicate'); names.append(p)
        need(type(f['size']) is int and 0<=f['size']<=LIMITS['entry'], 'file-size')
        need(f['digest'] in blobs and len(blobs[f['digest']])==f['size'], 'missing-or-sized-blob')
    need(names==sorted(names) and c['entrypoint'] in names, 'file-order-or-entrypoint')
    need(type(c['dependencies']) is list and c['dependencies']==sorted(set(c['dependencies'])), 'dependency-order')
    for d in c['dependencies']: digest(d)
    need(type(c['runtimeSlots']) is list and type(c['permissions']) is list, 'requirements')
    slots=set()
    for r in c['runtimeSlots']:
        exact(r,'slot capabilities'); token(r['slot'])
        need(r['slot'] not in slots, 'duplicate-runtime-slot');slots.add(r['slot'])
        need(type(r['capabilities']) is list and all(type(x) is str and TOKEN.fullmatch(x) for x in r['capabilities']), 'capabilities')
    for p in c['permissions']: token(p)
    t=c['terms']; exact(t,'license noticePaths permission')
    token(t['license'])
    need(type(t['noticePaths']) is list and len(t['noticePaths'])>0 and all(x in names for x in t['noticePaths']), 'notices')
    exact(t['permission'],'status record scope')
    need(t['permission']['status']=='allowed' and t['permission']['scope']=='redistribute' and type(t['permission']['record']) is str and t['permission']['record'], 'permission-record')
    # This is a synthetic allowlist, NOT license/legal verification.
    need(t['license']=='Apache-2.0', 'synthetic-license-policy')
    need(type(c['derivedFrom']) is list and type(c['changelog']) is str, 'provenance')
    for p in c['derivedFrom']:
        exact(p,'origin version digest')
        need(type(p['origin']) is list and len(p['origin'])==3, 'derived-origin')
        for x in p['origin']+[p['version']]: token(x)
        digest(p['digest'])
    files={f['path']:blobs[f['digest']] for f in c['files']}
    if c['kind']=='playbook':
        d=parse_json(files[c['entrypoint']])
        exact(d,'schema steps dependencies runtimeSlots permissions')
        need(d['schema']=='aa-probe/1' and d['dependencies']==c['dependencies'] and d['runtimeSlots']==c['runtimeSlots'] and d['permissions']==c['permissions'], 'definition-binding')
        need(type(d['steps']) is list and 1<=len(d['steps'])<=100, 'definition-steps')
        for step in d['steps']:
            exact(step,'kind component')
            need(step['kind']=='read-skill' and step['component'] in c['dependencies'], 'definition-reference')
    elif c['kind']=='schema':
        d=parse_json(files[c['entrypoint']]); exact(d,'type')
        need(d['type']=='object', 'unsupported-schema-keyword')

def closure_check(root, components):
    seen=set(); active=set()
    def visit(d):
        need(d in components, 'missing-dependency')
        need(d not in active, 'cyclic-closure')
        if d in seen: return
        active.add(d)
        for child in components[d]['dependencies']: visit(child)
        active.remove(d); seen.add(d)
    visit(root); need(seen==set(components), 'extraneous-component')

def verify(b, trust):
    try: return verify_inner(b,trust)
    except (TypeError,KeyError,AttributeError,OverflowError,IndexError) as e:
        raise Rejected('malformed-shape') from e

def verify_inner(b, trust):
    entries=unpack(b); raw=entries.pop('manifest.json');m=parse_json(raw)
    need(raw==canonical(m), 'noncanonical-manifest')
    exact(m,'format root components closureDigest proofs')
    need(m['format']=='aa-package/1', 'unsupported-format')
    need(type(m['components']) is list and 1<=len(m['components'])<=LIMITS['components'], 'components-budget')
    blobs={k[6:]:v for k,v in entries.items()}
    for d,v in blobs.items(): need(sha(v)==d, 'blob-digest')
    components={}; identities={}; used=set()
    for pair in m['components']:
        exact(pair,'digest descriptor'); d=pair['digest']; c=pair['descriptor']; digest(d)
        need(d not in components and sha(canonical(c))==d, 'component-digest')
        validate_component(c,blobs); key=identity(c)
        need(key not in identities, 'envelope-identity-conflict')
        identities[key]=d; components[d]=c
        used.update(f['digest'] for f in c['files'])
    need(list(components)==sorted(components), 'component-order')
    need(used==set(blobs), 'extra-blob')
    digest(m['root']); closure_check(m['root'],components)
    need(m['closureDigest']==sha(canonical(dict(root=m['root'],components=sorted(components)))), 'closure-digest')
    need(type(m['proofs']) is list and len(m['proofs'])<=LIMITS['components'], 'proof-budget')
    attribution={d:'unverified' for d in components}; proof_seen=set()
    for p in m['proofs']:
        exact(p,'component key signature'); digest(p['component']); token(p['key'])
        need(p['component'] in components and (p['component'],p['key']) not in proof_seen, 'proof-target')
        proof_seen.add((p['component'],p['key']))
        try: sig=base64.b64decode(p['signature'],validate=True)
        except (ValueError,TypeError) as e: raise Rejected('signature-encoding') from e
        need(len(sig)==64,'signature-size')
        need(base64.b64encode(sig).decode()==p['signature'],'signature-noncanonical')
        if p['key'] not in trust: continue
        policy=trust[p['key']]; c=components[p['component']]
        need(c['origin'][:2]==policy['scope'], 'issuer-scope')
        try: Ed25519PublicKey.from_public_bytes(bytes.fromhex(policy['public'])).verify(sig,DOMAIN+bytes.fromhex(p['component']))
        except Exception as e: raise Rejected('signature-invalid') from e
        attribution[p['component']]='verified-local-key'
    return dict(manifest=m,components=components,blobs=blobs,attribution=attribution,transportDigest=sha(b))

class Catalog:
    def __init__(self,path):
        self.db=sqlite3.connect(path)
        self.db.executescript('CREATE TABLE IF NOT EXISTS blobs(digest TEXT PRIMARY KEY, data BLOB); CREATE TABLE IF NOT EXISTS components(identity TEXT PRIMARY KEY,digest TEXT, descriptor BLOB); CREATE TABLE IF NOT EXISTS imports(root TEXT PRIMARY KEY, manifest BLOB); CREATE TABLE IF NOT EXISTS evidence(digest TEXT PRIMARY KEY, root TEXT, manifest BLOB);')
    def snapshot(self):
        return {t:[list(r) for r in self.db.execute(f'SELECT * FROM {t} ORDER BY 1')] for t in ['blobs','components','imports','evidence']}
    def accept(self,b,trust,crash=None):
        v=verify(b,trust)
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            for d,c in v['components'].items():
                row=self.db.execute('SELECT digest FROM components WHERE identity=?',(identity(c),)).fetchone()
                need(row is None or row[0]==d, 'catalog-identity-conflict')
            for d,blob in v['blobs'].items(): self.db.execute('INSERT OR IGNORE INTO blobs VALUES (?,?)',(d,blob))
            if crash=='after-blobs': os._exit(73)
            for d,c in v['components'].items(): self.db.execute('INSERT OR IGNORE INTO components VALUES (?,?,?)',(identity(c),d,canonical(c)))
            self.db.execute('INSERT OR IGNORE INTO imports VALUES (?,?)',(v['manifest']['root'],canonical(v['manifest'])))
            raw=canonical(v['manifest'])
            self.db.execute('INSERT OR IGNORE INTO evidence VALUES (?,?,?)',(sha(raw),v['manifest']['root'],raw))
            if crash=='before-commit': os._exit(74)
        if crash=='after-commit': os._exit(75)
        return v
    def export(self,root,trust=None):
        trust=trust or {}
        row=self.db.execute('SELECT manifest FROM imports WHERE root=?',(root,)).fetchone()
        need(row is not None,'not-imported'); m=parse_json(row[0]); collected={}
        components={p['digest']:p['descriptor'] for p in m['components']}
        for raw, in self.db.execute('SELECT manifest FROM evidence WHERE root=?',(root,)):
            for p in parse_json(raw)['proofs']:
                key=(p['component'],p['key'])
                if p['key'] in trust:
                    policy=trust[p['key']]
                    if components[p['component']]['origin'][:2]!=policy['scope']: continue
                    try:Ed25519PublicKey.from_public_bytes(bytes.fromhex(policy['public'])).verify(base64.b64decode(p['signature']),DOMAIN+bytes.fromhex(p['component']))
                    except Exception:continue
                collected.setdefault(key,{})[p['signature']]=p
        # Conflicting unverified claims cannot displace a later locally verified proof.
        # Original evidence is retained locally; ambiguous unknown-key proofs are omitted.
        chosen={}
        for k,proofs in sorted(collected.items(),key=lambda item:(item[0][1] not in trust,item[0])):
            if len(proofs)==1: chosen.setdefault(k[0],next(iter(proofs.values())))
        m['proofs']=[chosen[d] for d in sorted(chosen)]
        e={'manifest.json':canonical(m)}
        for pair in m['components']:
            for f in pair['descriptor']['files']:
                e['blobs/'+f['digest']]=self.db.execute('SELECT data FROM blobs WHERE digest=?',(f['digest'],)).fetchone()[0]
        return pack(e,reverse=True,year=2025)

def component(kind,package,files,deps=(),origin='export-a',version='1.0.0',derived=()):
    inventory=sorted([dict(path=p,size=len(b),digest=sha(b)) for p,b in files.items()],key=lambda f:f['path'])
    c=dict(origin=['installation-a',origin,package],version=version,kind=kind,schema='aa-probe/1',entrypoint={'skill':'skill.md','playbook':'definition.json','schema':'schema.json'}[kind],files=inventory,dependencies=sorted(deps),runtimeSlots=[],permissions=[],terms=dict(license='Apache-2.0',noticePaths=['notice.txt'],permission=dict(status='allowed',record='synthetic-owner-review-1',scope='redistribute')),derivedFrom=list(derived),changelog='Synthetic public fixture')
    return c,{sha(b):b for b in files.values()}

def fixture():
    notice=b'SYNTHETIC permission fixture. No third-party distribution grant is asserted.\n'
    schema,sb=component('schema','input-schema',{'schema.json':b'{"type":"object"}','notice.txt':notice})
    sd=sha(canonical(schema))
    skill,kb=component('skill','review-skill',{'skill.md':b'# Review\nRead the selected diff.\n','notice.txt':notice},[sd])
    kd=sha(canonical(skill))
    runtime=[dict(slot='coding',capabilities=['native-account','structured-output'])]
    permissions=['workspace-read']
    definition=dict(schema='aa-probe/1',steps=[dict(kind='read-skill',component=kd)],dependencies=[kd],runtimeSlots=runtime,permissions=permissions)
    root,rb=component('playbook','feature',{'definition.json':canonical(definition),'notice.txt':notice},[kd])
    root['runtimeSlots']=runtime; root['permissions']=permissions
    rd=sha(canonical(root))
    components={sd:schema,kd:skill,rd:root}
    m=dict(format='aa-package/1',root=rd,components=[dict(digest=d,descriptor=c) for d,c in sorted(components.items())],closureDigest=sha(canonical(dict(root=rd,components=sorted(components)))),proofs=[])
    return m,sb|kb|rb

def envelope(m,blobs): return pack({'manifest.json':canonical(m)}|{'blobs/'+d:b for d,b in blobs.items()})
def sign(m,key,keyid='issuer-a'):
    m=copy.deepcopy(m)
    m['proofs']=[dict(component=p['digest'],key=keyid,signature=base64.b64encode(key.sign(DOMAIN+bytes.fromhex(p['digest']))).decode()) for p in m['components']]
    return m
def repin(m,blobs,mutate):
    """Rebuild leaf-to-root after a fixture edit, including exact definition pins."""
    old={p['digest']:copy.deepcopy(p['descriptor']) for p in m['components']}; new={}; mapped={}; out=dict(blobs)
    def change(d):
        if d in mapped:return mapped[d]
        c=old[d]; deps={x:change(x) for x in c['dependencies']}
        c['dependencies']=sorted(deps.values())
        if c['kind']=='playbook':
            f=next(f for f in c['files'] if f['path']==c['entrypoint'])
            doc=parse_json(out[f['digest']]);doc['dependencies']=c['dependencies']
            for s in doc['steps']: s['component']=deps[s['component']]
            b=canonical(doc); f.update(digest=sha(b),size=len(b)); out[sha(b)]=b
        mutate(c,out)
        nd=sha(canonical(c));mapped[d]=nd;new[nd]=c;return nd
    root=change(m['root']); used={f['digest'] for c in new.values() for f in c['files']}
    return dict(format='aa-package/1',root=root,components=[dict(digest=d,descriptor=c) for d,c in sorted(new.items())],closureDigest=sha(canonical(dict(root=root,components=sorted(new)))),proofs=[]),{d:out[d] for d in used}

def public_candidate(source, blobs, stable_origins, selected_changelog, approved_ancestors=None):
    """Owner fixture: mapping is trusted local state, never a caller-supplied alias.
    Full source fields/prose must be explicitly reviewed. This is not secret scanning.
    """
    private_map={};approved_ancestors=approved_ancestors or {}
    def select(c,out):
        old=list(c['origin']);new=stable_origins[tuple(old)]
        private_map['/'.join(new)]=old
        c['origin']=list(new);c['changelog']=selected_changelog
        for index,ancestor in enumerate(c['derivedFrom']):
            key=tuple(ancestor['origin'])+(ancestor['version'],ancestor['digest'])
            need(key in approved_ancestors,'provenance-not-approved')
            private_map['ancestry:'+str(key)]=copy.deepcopy(ancestor)
            c['derivedFrom'][index]=copy.deepcopy(approved_ancestors[key])
    candidate,objects=repin(source,blobs,select)
    verify(envelope(candidate,objects),{})
    return candidate,objects,private_map

def json_snapshot(c):
    def cv(v):
        if isinstance(v,bytes): return dict(hex=v.hex(),utf8=v.decode('utf8',errors='replace'))
        if isinstance(v,list):return [cv(x) for x in v]
        if isinstance(v,dict):return {k:cv(x) for k,x in v.items()}
        return v
    return cv(c.snapshot())

def run():
    import subprocess
    results=[]; timings=[]
    m,blobs=fixture(); unsigned=envelope(m,blobs)
    key=Ed25519PrivateKey.generate(); pub=key.public_key().public_bytes(serialization.Encoding.Raw,serialization.PublicFormat.Raw).hex()
    trust={'issuer-a':dict(public=pub,scope=['installation-a','export-a'])}
    signed_m=sign(m,key); good=envelope(signed_m,blobs)
    def case(name,fn,expected=None):
        start=time.perf_counter()
        try:
            value=fn(); need(expected is None,'expected-rejection-not-raised')
            results.append(dict(name=name,status='passed',outcome='accepted',evidence=value))
        except Rejected as e:
            if expected is None or str(e)!=expected: raise
            results.append(dict(name=name,status='passed',outcome='rejected',reason=str(e)))
        timings.append((time.perf_counter()-start)*1000)
    case('unsigned integrity is not publisher trust',lambda:verify(unsigned,trust)['attribution'])
    need(set(verify(unsigned,trust)['attribution'].values())=={'unverified'},'unsigned-trust')
    case('pinned Ed25519 verifies each component',lambda:verify(good,trust)['attribution'])
    need(set(verify(good,trust)['attribution'].values())=={'verified-local-key'},'signature-trust')
    case('unknown key remains unverified offline',lambda:verify(good,{})['attribution'])
    need(set(verify(good,{})['attribution'].values())=={'unverified'},'unknown-key-trust')
    wrong={'issuer-a':dict(public=pub,scope=['other','organization'])}
    case('trusted key outside allowed origin',lambda:verify(good,wrong),'issuer-scope')
    bad=copy.deepcopy(signed_m);bad['proofs'][0]['signature']=base64.b64encode(bytes(64)).decode()
    case('invalid known-key signature',lambda:verify(envelope(bad,blobs),trust),'signature-invalid')
    with tempfile.TemporaryDirectory() as tmp:
        cat=Catalog(Path(tmp)/'proofs.sqlite')
        cat.accept(unsigned,{})
        cat.accept(good,trust)
        exported=cat.export(m['root'],trust)
        need(set(verify(exported,trust)['attribution'].values())=={'verified-local-key'},'proof-upgrade-loss')
        cat.accept(unsigned,{})
        need(set(verify(cat.export(m['root'],trust),trust)['attribution'].values())=={'verified-local-key'},'proof-erasure')
        cat.accept(envelope(bad,blobs),{})
        need(set(verify(cat.export(m['root'],trust),trust)['attribution'].values())=={'verified-local-key'},'unknown-proof-poisoning')
        need(set(verify(cat.export(m['root'],{}),{})['attribution'].values())=={'unverified'},'stale-trust')
        results.append(dict(name='unsigned upgrade, unsigned replay, unknown conflicting evidence and current-policy reevaluation',status='passed',outcome='accepted',evidence=json_snapshot(cat)))
        poisoned=Catalog(Path(tmp)/'poisoned.sqlite');poisoned.accept(envelope(bad,blobs),{})
        poisoned.accept(good,trust)
        need(set(verify(poisoned.export(m['root'],trust),trust)['attribution'].values())=={'verified-local-key'},'unknown-first-poisoning')
        results.append(dict(name='formerly unknown invalid proof cannot block later verified attribution',status='passed',outcome='accepted',evidence=json_snapshot(poisoned)))
    with tempfile.TemporaryDirectory(prefix='aa-offline-') as tmp:
        tmp=Path(tmp); a=Catalog(tmp/'a.sqlite');b=Catalog(tmp/'b.sqlite')
        # Disallow actual network operations while exporting/importing the catalogs.
        import socket
        original=socket.socket
        def denied(*a,**k): raise AssertionError('network forbidden during offline roundtrip')
        socket.socket=denied
        try:
            a.accept(good,trust); exported=a.export(m['root'],trust); v=b.accept(exported,trust)
            need(a.snapshot()==b.snapshot(),'offline-state-preservation')
            need(sha(good)!=sha(exported) and v['manifest']['closureDigest']==m['closureDigest'],'transport-v-content')
            results.append(dict(name='two isolated durable catalogs; origin network disabled; bytes and metadata preserved',status='passed',outcome='accepted',evidence=dict(a=json_snapshot(a),b=json_snapshot(b),transportDigests=[sha(good),sha(exported)],closureDigest=m['closureDigest'],executePermission=False)))
            before=b.snapshot(); b.accept(exported,{});need(before==b.snapshot(),'replay-mutated-content')
            results.append(dict(name='idempotent import replay',status='passed',outcome='accepted'))
            dependency=next(p for p in m['components'] if p['descriptor']['kind']=='schema')
            matching=b.db.execute('SELECT identity,digest FROM components WHERE digest=?',(dependency['digest'],)).fetchall()
            need(len(matching)==1 and matching[0][0]==identity(dependency['descriptor']),'dependency-advisory-index')
            results.append(dict(name='transitive component remains addressable for local advisory matching',status='passed',outcome='accepted',evidence=dict(matches=matching,executionPolicyApplied=False)))
        finally:socket.socket=original
        def changed(c,out):c['changelog']='Changed content at same identity/version'
        cm,cb=repin(m,blobs,changed)
        case('changed same-origin version conflicts for offline alternate transport',lambda:b.accept(envelope(cm,cb),{}),'catalog-identity-conflict')
        need(b.snapshot()==before,'conflict-atomicity')
        # Actual process death inside SQLite transaction; separate fresh catalog per boundary.
        bundle=tmp/'fixture.zip';bundle.write_bytes(unsigned)
        for point,code in [('after-blobs',73),('before-commit',74),('after-commit',75)]:
            db=tmp/(point+'.sqlite')
            p=subprocess.run([sys.executable,str(Path(__file__).resolve()),'crash',str(db),str(bundle),point],capture_output=True)
            need(p.returncode==code,'crash-child-failed')
            recovered=Catalog(db);snap=json_snapshot(recovered)
            need(bool(snap['imports'])==(point=='after-commit'),'atomic-import')
            if point!='after-commit':need(all(not rows for rows in snap.values()),'partial-registration')
            recovered.accept(unsigned,{});need(len(recovered.snapshot()['imports'])==1,'crash-retry')
            results.append(dict(name='process crash '+point,status='passed',outcome='recovered',evidence=dict(exitCode=code,afterRestart=snap,afterRetry=json_snapshot(recovered))))
    def verify_m(edit):
        bad=copy.deepcopy(m);edit(bad);return verify(envelope(bad,blobs),{})
    case('unknown envelope format',lambda:verify_m(lambda x:x.update(format='aa-package/2')),'unsupported-format')
    case('unknown behavioral envelope field',lambda:verify_m(lambda x:x.update(installHook='run me')),'fields')
    case('changed closure digest',lambda:verify_m(lambda x:x.update(closureDigest='0'*64)),'closure-digest')
    case('missing root',lambda:verify_m(lambda x:x.update(root='0'*64)),'missing-dependency')
    case('changed component descriptor without new digest',lambda:verify_m(lambda x:x['components'][0]['descriptor'].update(changelog='tampered')),'component-digest')
    e=unpack(unsigned);e['manifest.json']=json.dumps(m,indent=2).encode()
    case('noncanonical manifest whitespace',lambda:verify(pack(e),{}),'noncanonical-manifest')
    case('malformed component value',lambda:verify_m(lambda x:x.update(components=[None])),'fields')
    case('too many components',lambda:verify_m(lambda x:x.update(components=x['components']*11)),'components-budget')
    case('malformed proof shape',lambda:verify_m(lambda x:x.update(proofs=[dict(component=m['root'],key='k',signature=[])])),'signature-encoding')
    for name,edit,reason in [
        ('unsupported component schema',lambda c,o:c.update(schema='unknown/2'),'unsupported-schema'),
        ('concrete environment binding',lambda c,o:c.update(environmentBinding='secret-provider-path'),'fields'),
        ('unsafe logical path',lambda c,o:c['files'][0].update(path='../escape'),'logical-path'),
        ('permission denied',lambda c,o:c['terms']['permission'].update(status='denied'),'permission-record'),
        ('permission missing',lambda c,o:c['terms'].pop('permission'),'fields'),
        ('unapproved software terms',lambda c,o:c['terms'].update(license='Proprietary'),'synthetic-license-policy'),
        ('notice missing',lambda c,o:c['terms'].update(noticePaths=['missing.txt']),'notices'),
        ('private provenance field',lambda c,o:c['derivedFrom'].append(dict(privateProject='do-not-publish')),'fields'),
        ('unknown runtime behavior',lambda c,o:c['runtimeSlots'].append(dict(slot='x',capabilities=[],secret='x')),'fields')]:
        x,y=repin(m,blobs,edit);case(name,lambda x=x,y=y:verify(envelope(x,y),{}),reason)
    # Graph algorithm is probed separately: cryptographic cyclic fixed points cannot be manufactured honestly.
    case('closure cycle (algorithm-only fixture)',lambda:closure_check('a',{'a':dict(dependencies=['b']),'b':dict(dependencies=['a'])}),'cyclic-closure')
    case('closure missing pin (algorithm-only fixture)',lambda:closure_check('a',{'a':dict(dependencies=['b'])}),'missing-dependency')
    extra=copy.deepcopy(m); extra['components']=extra['components'][:-1]
    case('missing packaged component',lambda:verify(envelope(extra,blobs),{}),'extra-blob')
    entries=unpack(unsigned)
    case('archive truncated',lambda:verify(unsigned[:-1],{}),'zip-end')
    case('archive trailing bytes',lambda:verify(unsigned+b'x',{}),'zip-end')
    case('archive oversized',lambda:verify(bytes(LIMITS['archive']+1),{}),'archive-budget')
    case('compressed archive including expansion bomb',lambda:verify(pack({'manifest.json':b'0'*600000},compression=zipfile.ZIP_DEFLATED),{}),'zip-profile')
    case('too many entries',lambda:verify(pack({f'blobs/{i:064x}':b'' for i in range(65)}),{}),'entry-count')
    case('oversized stored entry',lambda:verify(pack({'manifest.json':bytes(LIMITS['entry']+1)}),{}),'entry-budget')
    case('oversized manifest',lambda:verify(pack({'manifest.json':b' '* (LIMITS['manifest']+1)}),{}),'manifest-budget')
    for path in ['../escape','/absolute','C:/file','blobs/../escape','blobs/UPPER','blobs\\evil']:
        case('unsafe archive path '+path,lambda path=path:verify(pack({'manifest.json':b'{}',path:b'x'}),{}),'archive-path')
    duplicate=io.BytesIO()
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        with zipfile.ZipFile(duplicate,'w') as z:
            for _ in range(2):
                i=zipfile.ZipInfo('manifest.json');i.create_system=3;i.external_attr=(stat.S_IFREG|0o644)<<16;z.writestr(i,b'{}')
    case('duplicate archive entry',lambda:verify(duplicate.getvalue(),{}),'duplicate-entry')
    def central_edit(offset,fmt,value):
        b=bytearray(unsigned);start=struct.unpack_from('<I',b,len(b)-6)[0];struct.pack_into(fmt,b,start+offset,value);return bytes(b)
    case('symbolic link entry',lambda:verify(central_edit(38,'I',(stat.S_IFLNK|0o777)<<16),{}),'zip-file-type')
    case('encrypted flag',lambda:verify(central_edit(8,'H',1),{}),'zip-profile')
    case('data descriptor flag',lambda:verify(central_edit(8,'H',8),{}),'zip-profile')
    case('central/local size mismatch',lambda:verify(central_edit(16,'I',1),{}),'zip-local-mismatch')
    broken=bytearray(unsigned);broken[30]=ord('x')
    case('central/local name mismatch',lambda:verify(bytes(broken),{}),'zip-name-mismatch')
    badentries=dict(entries);blobname=next(k for k in badentries if k.startswith('blobs/'));badentries[blobname]+=b'x'
    case('content digest mismatch with valid CRC',lambda:verify(pack(badentries),{}),'blob-digest')
    for name,raw,reason in [
        ('duplicate JSON keys',b'{"format":1,"format":2}','duplicate-json-key'),
        ('excessive JSON depth',b'['*33+b'0'+b']'*33,'json-depth'),
        ('NaN',b'{"n":NaN}','json-constant'),
        ('unsafe integer',b'{"n":9007199254740992}','number-domain'),
        ('float metadata',b'{"n":1.5}','number-or-json-domain'),
        ('lone surrogate',b'{"s":"\\ud800"}','unicode'),
        ('oversized string',json.dumps('x'*65537).encode(),'string-budget'),
        ('non-ASCII key',b'{"\\u00e9":1}','metadata-key-domain'),
        ('too many JSON nodes',b'['+b'0,'*19999+b'0]','json-budget')]:
        case(name,lambda raw=raw:verify(pack({'manifest.json':raw}),{}),reason)
    # Real private-origin descriptors are transformed; closure pins and exact definition refs follow.
    private_marker='PRIVATE-SOURCE-ONLY'
    def privatize(c,out):
        c['origin'][1]=private_marker;c['changelog']='Private project changelog'
    pm,pb=repin(m,blobs,privatize)
    stable={tuple(p['descriptor']['origin']):['installation-a','export-a',p['descriptor']['origin'][2]] for p in pm['components']}
    public,public_blobs,private_map=public_candidate(pm,pb,stable,'Approved public changelog')
    again,again_blobs,again_map=public_candidate(pm,pb,stable,'Approved public changelog')
    need(public==again and public_blobs==again_blobs and private_map==again_map,'unstable-export-origin')
    need(private_marker.encode() in envelope(pm,pb) and private_marker.encode() not in envelope(public,public_blobs),'private-leak')
    need(pm['root']!=public['root'] and pm['closureDigest']!=public['closureDigest'],'private-redaction-identity')
    results.append(dict(name='public export remaps private origins and transitive pins with stable repeated identity',status='passed',outcome='new-candidate',evidence=dict(privateSource=pm,publicCandidate=public,localOnlyMapping=private_map)))
    private_root=next(p['descriptor'] for p in pm['components'] if p['digest']==pm['root'])
    old_ancestor=dict(origin=private_root['origin'],version=private_root['version'],digest=pm['root'])
    def ancestry(c,out):
        if c['kind']=='playbook':c['version']='2.0.0';c['derivedFrom']=[copy.deepcopy(old_ancestor)]
    with_ancestor,ancestor_blobs=repin(pm,pb,ancestry)
    case('private ancestry without exact approved mapping',lambda:public_candidate(with_ancestor,ancestor_blobs,stable,'Approved public changelog'),'provenance-not-approved')
    public_root=next(p['descriptor'] for p in public['components'] if p['digest']==public['root'])
    approved={tuple(old_ancestor['origin'])+(old_ancestor['version'],old_ancestor['digest']):dict(origin=public_root['origin'],version=public_root['version'],digest=public['root'])}
    ac,ao,am=public_candidate(with_ancestor,ancestor_blobs,stable,'Approved public changelog',approved)
    actual=next(p['descriptor'] for p in ac['components'] if p['digest']==ac['root'])['derivedFrom'][0]
    need(actual==next(iter(approved.values())) and actual['digest']!=old_ancestor['digest'],'ancestor-full-tuple')
    need(private_marker.encode() not in envelope(ac,ao),'ancestor-private-leak')
    results.append(dict(name='private ancestry maps complete approved public origin version and changed digest',status='passed',outcome='new-candidate',evidence=dict(publicAncestor=actual,publicCandidate=ac,localOnlyMapping=am)))
    with tempfile.TemporaryDirectory() as tmp:
        c=Catalog(Path(tmp)/'c.sqlite');c.accept(envelope(public,public_blobs),{})
        altered,ab,am=public_candidate(pm,pb,stable,'Changed public changelog')
        case('another export cannot reset same-origin version conflict',lambda:c.accept(envelope(altered,ab),{}),'catalog-identity-conflict')
        snap=c.snapshot()
        try: need(altered['closureDigest']==public['closureDigest'],'approval-candidate-mismatch')
        except Rejected as ex:
            results.append(dict(name='old exact candidate approval rejects changed export',status='passed',outcome='rejected',reason=str(ex)))
        else: raise AssertionError('approval mismatch not detected')
        need(c.snapshot()==snap,'approval-side-effect')
    def redact(c,out):
        if c['kind']=='skill':
            f=next(f for f in c['files'] if f['path']=='skill.md');raw=b'# Review\nApproved redacted instructions.\n';f.update(digest=sha(raw),size=len(raw));out[sha(raw)]=raw
    red,redblobs=repin(m,blobs,redact); verify(envelope(red,redblobs),{})
    need(red['root']!=m['root'] and red['closureDigest']!=m['closureDigest'],'redaction-repin')
    results.append(dict(name='redacted content repins dependency and root; old approval does not match',status='passed',outcome='new-candidate',evidence=dict(old=m,new=red,privateMappingExported=False)))
    def inert(c,out):
        if c['kind']=='skill':
            raw=b'#!/bin/sh\ntouch SHOULD_NOT_EXIST\n';d=sha(raw);out[d]=raw
            c['files'].append(dict(path='install.sh',size=len(raw),digest=d));c['files'].sort(key=lambda f:f['path'])
    inert_m,inert_blobs=repin(m,blobs,inert)
    with tempfile.TemporaryDirectory() as tmp:
        import subprocess
        original_run=subprocess.run; original_popen=subprocess.Popen
        def forbidden(*a,**k): raise AssertionError('package code invoked during import')
        subprocess.run=forbidden;subprocess.Popen=forbidden
        try:
            c=Catalog(Path(tmp)/'inert.sqlite');c.accept(envelope(inert_m,inert_blobs),{})
            need(not Path('SHOULD_NOT_EXIST').exists(),'executed-resource')
        finally:subprocess.run=original_run;subprocess.Popen=original_popen
    results.append(dict(name='shell resource stays inert with subprocess dispatch disabled',status='passed',outcome='accepted',evidence=dict(executionGranted=False,resourceRetained=True)))
    # Explicit exact boundary checks; timings are local observations, not product capacity.
    case('maximum metadata safe integer',lambda:parse_json(b'{"n":9007199254740991}'))
    case('maximum string length',lambda:dict(length=len(parse_json(json.dumps('x'*65536).encode()))))
    case('maximum stored payload boundary',lambda:dict(size=len(unpack(pack({'manifest.json':b'{}','blobs/'+('0'*64):bytes(LIMITS['entry'])}))['blobs/'+('0'*64)])))
    case('maximum ZIP entry count boundary',lambda:dict(count=len(unpack(pack({'manifest.json':b'{}'}|{f'blobs/{i:064x}':b'' for i in range(63)})))))
    report=dict(question='Can disconnected Catalogs preserve exact dependency identity without importing authority?',limits=LIMITS,runtime=dict(python=sys.version,sqlite=sqlite3.sqlite_version),scenarios=results,count=len(results),timingMs=dict(max=max(timings),total=sum(timings)),limitations=['aa-probe/1 reduced schema only; no full ADR0002 interpreter or schema conformance','permission allowlist and local issuer scope are synthetic policy fixtures','SQLite atomicity is actual, not production PostgreSQL or object storage conformance','cycle checks separately modeled because hashed cyclic descriptors cannot be honestly constructed','redaction fixture tests explicit selection and repinning, not confidential prose detection','no production trust rotation/revocation, moderation or Execution integration'])
    evidence=HERE/'evidence';evidence.mkdir(exist_ok=True)
    (evidence/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    (evidence/'fixture.zip').write_bytes(good)
    (evidence/'trust.json').write_text(json.dumps(trust,indent=2)+'\n')
    (evidence/'source.sha256').write_text(sha(Path(__file__).read_bytes())+'  probe.py\n')
    print(json.dumps(dict(scenarios=len(results),allPassed=True,timingMs=report['timingMs'])))

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='crash':Catalog(sys.argv[2]).accept(Path(sys.argv[3]).read_bytes(),{},sys.argv[4])
    else:run()
