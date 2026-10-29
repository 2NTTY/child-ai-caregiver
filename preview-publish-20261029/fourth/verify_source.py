#!/usr/bin/env python3
"""Read-only fixed-product input check. Does not install, compile, export or authorize publication."""
import argparse, hashlib, json, pathlib, runpy
HERE = pathlib.Path(__file__).resolve().parent

def verify(source):
    pins = json.loads((HERE / 'PRODUCT_INPUTS.json').read_text())
    helper=HERE.parent/'orchestrator/build_inputs.py'
    if not helper.is_file():raise ValueError('Required shared build-input verifier missing')
    recipe=json.loads((HERE/'recipe.json').read_text())
    if hashlib.sha256(helper.read_bytes()).hexdigest()!=recipe['sharedBuildInputVerifier']['sha256']:raise ValueError('Shared build-input verifier pin drift')
    build=runpy.run_path(str(helper))['verify'](source,'fourth')
    if build['originalProductCommit']!=pins['commit'] or build['originalProductTree']!=pins['tree']:
        raise ValueError('Fourth original product provenance mismatch')
    for row in pins['files']:
        actual=build['files'].get(row['path'])
        if not actual or actual['bytes']!=row['bytes'] or actual['sha256']!=row['sha256']:
            raise ValueError('Fourth reviewed candidate input drift: '+row['path'])
    return {'productCommit':pins['commit'],'productTree':pins['tree'],'originalIdentityRole':'FIXED_INPUT_PROVENANCE_NOT_REMOTE_GIT_HEAD','buildCommit':build['buildCommit'],'buildTree':build['buildTree'],'buildInputManifestSha256':build['manifestSha256'],'projectedNamespaceGate':'VERIFIED_BY_SHARED_BUILD_INPUTS_HELPER','verifiedInputs':len(pins['files']),'productOverlay':[],'candidateChanges':recipe['productSourceDelta']}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--source', type=pathlib.Path, required=True)
    args = parser.parse_args(); print(json.dumps(verify(args.source.resolve()), sort_keys=True))
