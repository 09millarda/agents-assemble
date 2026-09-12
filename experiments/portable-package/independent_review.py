"""Independent disposable probes for #17; no production certification."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('subject_probe', HERE / 'probe.py')
p = importlib.util.module_from_spec(spec)
source_bytes=(HERE/'probe.py').read_bytes()
exec(compile(source_bytes,str(HERE/'probe.py'),'exec'),p.__dict__)
results = []


def record(name, fn):
    try:
        result = fn()
        results.append(dict(name=name, outcome='accepted', detail=result))
    except p.Rejected as e:
        results.append(dict(name=name, outcome='rejected', detail=str(e)))
    except Exception as e:
        results.append(dict(name=name, outcome='unexpected-exception', detail=f'{type(e).__name__}: {e}'))


m, blobs = p.fixture()
unsigned = p.envelope(m, blobs)
key = p.Ed25519PrivateKey.generate()
trust = {'issuer-a': dict(public=key.public_key().public_bytes(p.serialization.Encoding.Raw, p.serialization.PublicFormat.Raw).hex(), scope=['installation-a', 'export-a'])}
signed = p.envelope(p.sign(m, key), blobs)


def changed_manifest(change):
    changed = copy.deepcopy(m)
    change(changed)
    return p.envelope(changed, blobs)


record('pretty manifest canonical equality', lambda: p.verify(p.pack({'manifest.json': json.dumps(m, indent=2).encode()} | {'blobs/'+d:v for d,v in blobs.items()}), {})['manifest']['format'])
record('proof signature list shape', lambda: p.verify(changed_manifest(lambda x:x['proofs'].append(dict(component=m['root'],key='issuer-a',signature=[]))), {}))
record('manifest root list shape', lambda: p.verify(changed_manifest(lambda x:x.update(root=[])), {}))


def replay_proofs(first, second):
    with tempfile.TemporaryDirectory() as tmp:
        c = p.Catalog(Path(tmp)/'catalog.sqlite')
        c.accept(first, trust)
        second_v = c.accept(second, trust)
        exported = p.verify(c.export(m['root'], trust), trust)
        return dict(replayAttribution=sorted(set(second_v['attribution'].values())), exportedAttribution=sorted(set(exported['attribution'].values())), exportedProofs=len(exported['manifest']['proofs']))


record('unsigned then signed replay preserves new proofs', lambda: replay_proofs(unsigned,signed))
record('signed then unsigned replay preserves existing proofs', lambda: replay_proofs(signed,unsigned))


def unknown_proof_replay(bad_first):
    bad=p.sign(m,key)
    for proof in bad['proofs']: proof['signature']=p.base64.b64encode(bytes(64)).decode()
    poisoned=p.envelope(bad,blobs)
    with tempfile.TemporaryDirectory() as tmp:
        c=p.Catalog(Path(tmp)/'catalog.sqlite')
        c.accept(poisoned if bad_first else signed, {} if bad_first else trust)
        c.accept(signed if bad_first else poisoned, trust if bad_first else {})
        exported=p.verify(c.export(m['root'], trust),trust)
        return dict(exportedAttribution=sorted(set(exported['attribution'].values())))


record('known valid proof upgrades prior unknown invalid proof',lambda:unknown_proof_replay(True))
record('unknown invalid replay cannot poison prior verified proof',lambda:unknown_proof_replay(False))


def alternate_base64_signature():
    sm=p.sign(m,key)
    alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    alt=copy.deepcopy(sm)
    for proof in alt['proofs']:
        s=proof['signature']
        assert s.endswith('==')
        index=alphabet.index(s[-3])
        proof['signature']=s[:-3]+alphabet[index+1]+'=='
        assert p.base64.b64decode(proof['signature'],validate=True)==p.base64.b64decode(s,validate=True)
    with tempfile.TemporaryDirectory() as tmp:
        c=p.Catalog(Path(tmp)/'catalog.sqlite')
        c.accept(p.envelope(sm,blobs),trust)
        c.accept(p.envelope(alt,blobs),trust)
        exported=p.verify(c.export(m['root'],trust),trust)
        return dict(exportedAttribution=sorted(set(exported['attribution'].values())),exportedProofs=len(exported['manifest']['proofs']))


record('alternate base64 padding bits cannot erase verified evidence',alternate_base64_signature)


def evidence_export_budget():
    policies={f'issuer-{i}':trust['issuer-a'] for i in range(11)}
    with tempfile.TemporaryDirectory() as tmp:
        c=p.Catalog(Path(tmp)/'catalog.sqlite')
        for kid in policies: c.accept(p.envelope(p.sign(m,key,kid),blobs),policies)
        exported=p.verify(c.export(m['root'],policies),policies)
        return dict(exportedAttribution=sorted(set(exported['attribution'].values())),exportedProofs=len(exported['manifest']['proofs']))


record('accumulated evidence exports within reader proof budget',evidence_export_budget)




def dependency_conflict():
    def change(c, out):
        if c['kind']=='schema': c['changelog']='Changed dependency at same origin version'
        else: c['version']='2.0.0'
    changed, changed_blobs = p.repin(m,blobs,change)
    with tempfile.TemporaryDirectory() as tmp:
        c=p.Catalog(Path(tmp)/'catalog.sqlite')
        c.accept(unsigned,{})
        before=c.snapshot()
        try: c.accept(p.envelope(changed,changed_blobs),{})
        finally:
            assert c.snapshot()==before, 'dependency conflict left partial writes'


record('dependency-only identity conflict with new parent versions is atomic', dependency_conflict)


def shape_case():
    # Do not use repin after creating malformed dependencies: it is an authoring
    # helper and should not be confused with the reader under test.
    changed=copy.deepcopy(m)
    leaf=next(x for x in changed['components'] if x['descriptor']['kind']=='schema')
    leaf['descriptor']['dependencies']=[{}]
    leaf['digest']=p.sha(p.canonical(leaf['descriptor']))
    changed['components'].sort(key=lambda x:x['digest'])
    return p.verify(p.envelope(changed,blobs),{})


record('malformed dependency type at reader boundary',shape_case)


def duplicate_slots():
    def change(c,out):
        if c['kind']=='skill': c['runtimeSlots']=[dict(slot='same', capabilities=['read']),dict(slot='same',capabilities=['write'])]
    candidate, bs=p.repin(m,blobs,change)
    return p.verify(p.envelope(candidate,bs),{})['manifest']['format']


record('duplicate runtime slot with conflicting requirements',duplicate_slots)


def private_claim():
    marker='PRIVATE-REFERENCE-ONLY'
    def change(c,out):
        if c['kind']=='skill': c['derivedFrom']=[dict(origin=['private-install','private-org',marker],version='1',digest='a'*64)]
    candidate, bs=p.repin(m,blobs,change)
    bundle=p.envelope(candidate,bs)
    checked=p.verify(bundle,{})
    return dict(privateReferencePresent=marker.encode() in bundle,accepted=True,attribution=sorted(set(checked['attribution'].values())))


record('private origin-shaped provenance is not detectable by importer', private_claim)


def public_ancestry_mapping(supply_approval=True):
    leaf=next(pair for pair in m['components'] if pair['descriptor']['kind']=='schema')
    ancestry=dict(origin=leaf['descriptor']['origin'], version=leaf['descriptor']['version'], digest=leaf['digest'])
    def set_ancestor(c,out):
        if c['kind']=='skill': c['derivedFrom']=[copy.deepcopy(ancestry)]
    source,bs=p.repin(m,blobs,set_ancestor)
    stable={tuple(pair['descriptor']['origin']):['opaque-install','opaque-org',pair['descriptor']['origin'][2]] for pair in source['components']}
    ancestor_candidate,_,_=p.public_candidate(m,blobs,stable,'Approved')
    approved_schema=next(pair for pair in ancestor_candidate['components'] if pair['descriptor']['kind']=='schema')
    mapped=dict(origin=approved_schema['descriptor']['origin'],version=approved_schema['descriptor']['version'],digest=approved_schema['digest'])
    approvals={tuple(ancestry['origin'])+(ancestry['version'],ancestry['digest']):mapped} if supply_approval else {}
    candidate,objects,private_map=p.public_candidate(source,bs,stable,'Approved',approvals)
    schema=next(pair for pair in candidate['components'] if pair['descriptor']['kind']=='schema')
    skill=next(pair for pair in candidate['components'] if pair['descriptor']['kind']=='skill')
    exported=skill['descriptor']['derivedFrom']
    if exported:
        correct=(exported[0]['origin']==schema['descriptor']['origin'] and exported[0]['digest']==schema['digest'])
        return dict(publicAncestryConsistent=correct,mode='mapped',exported=exported)
    return dict(publicAncestryConsistent=ancestry['digest'] in json.dumps(private_map),mode='omitted-with-private-record')


record('private ancestry never rewrites origin with stale digest',public_ancestry_mapping)
record('private ancestry without full approved mapping rejects',lambda:public_ancestry_mapping(False))

expected_rejections={
 'pretty manifest canonical equality':'noncanonical-manifest',
 'proof signature list shape':'signature-encoding',
 'manifest root list shape':'digest-shape',
 'alternate base64 padding bits cannot erase verified evidence':'signature-noncanonical',
 'dependency-only identity conflict with new parent versions is atomic':'catalog-identity-conflict',
 'malformed dependency type at reader boundary':'malformed-shape',
 'duplicate runtime slot with conflicting requirements':'duplicate-runtime-slot',
 'private ancestry without full approved mapping rejects':'provenance-not-approved',
}
for result in results:
    name=result['name']
    if name in expected_rejections:
        passed=result['outcome']=='rejected' and result['detail']==expected_rejections[name]
    else:
        passed=result['outcome']=='accepted'
        if passed and 'exportedAttribution' in result['detail']:
            passed=result['detail']['exportedAttribution']==['verified-local-key']
        if passed and name=='accumulated evidence exports within reader proof budget':
            passed=0<result['detail']['exportedProofs']<=p.LIMITS['components']
        if passed and name=='private ancestry never rewrites origin with stale digest':
            passed=result['detail']['publicAncestryConsistent'] is True
        if passed and name=='private origin-shaped provenance is not detectable by importer':
            passed=result['detail']['privateReferencePresent'] is True and result['detail']['attribution']==['unverified']
    result['status']='passed' if passed else 'failed'
report=dict(sourceSha256=hashlib.sha256(source_bytes).hexdigest(),allPassed=all(x['status']=='passed' for x in results),cases=results)
print(json.dumps(report,indent=2))
(HERE/'evidence').mkdir(exist_ok=True)
(HERE/'evidence'/'independent-review.json').write_text(json.dumps(report,indent=2)+'\n')

assert report['allPassed'], 'Independent review found failing expectations; see evidence/independent-review.json'
