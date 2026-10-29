#!/usr/bin/env python3
"""Orchestrator interface; preserves partials and never overwrites output/proof."""
import argparse
from pathlib import Path
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from prepare import normalize, require

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--raw', type=Path, required=True)
parser.add_argument('--out', type=Path, required=True)
parser.add_argument('--proof', type=Path, required=True)
args = parser.parse_args()
require(not args.out.exists() and not args.proof.exists(), 'Fresh out/proof required')
staging = args.out.parent / (args.out.name + '.normalizing')
require(not staging.exists(), 'Fresh attempt staging required; no automatic retry')
normalize(args.source, args.raw, staging)
args.out.parent.mkdir(parents=True, exist_ok=True)
args.proof.parent.mkdir(parents=True, exist_ok=True)
(staging / 'overlay').rename(args.out)
(staging / 'manifest.json').rename(args.proof)
staging.rmdir()
