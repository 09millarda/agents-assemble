#!/usr/bin/env python3
"""THROWAWAY trusted shim: owns delegated payload cgroup, never relaunches it.

It stays outside payload after native exit, retaining cgroup for observation.
Whole-service RuntimeMaxSec bounds shim lifetime if its controller dies.
"""
import json, os, subprocess, sys, time
from pathlib import Path

record=Path(sys.argv[1])
own=Path('/sys/fs/cgroup'+Path('/proc/self/cgroup').read_text().strip().split('::',1)[1])
payload=own/'payload'
payload.mkdir() # No adoption of an existing scope.
def enter():
    (payload/'cgroup.procs').write_text(str(os.getpid()))
child=subprocess.Popen(sys.argv[2:],preexec_fn=enter)
fd=os.open(record,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:
    json.dump({'payload':str(payload),'inode':payload.stat().st_ino,'nativePid':child.pid,
               'supervisorPid':os.getpid(),'launches':1},f)
    f.flush(); os.fsync(f.fileno())
child.wait()
while True: time.sleep(1)
