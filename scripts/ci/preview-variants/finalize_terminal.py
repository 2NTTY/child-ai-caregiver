"""Read-only outer finalizer. Invoked only after the workflow's pinned guard.
Always-run is best effort: cancellation/service termination may prevent this code
from starting. No valid terminal receipt means no completed verification.
"""
from pathlib import Path
import argparse,json,subprocess,os
from assemble import verify_payload
from terminal_receipt import *
def main():
    p=argparse.ArgumentParser();p.add_argument('--area',type=Path,required=True);p.add_argument('--checkout',type=Path,required=True);p.add_argument('--variant',required=True);p.add_argument('--sha',required=True);p.add_argument('--control',required=True);p.add_argument('--outcomes',required=True);a=p.parse_args();here=Path(__file__).resolve().parent
    outcomes=json.loads(a.outcomes);result=base_receipt(a.variant,a.sha,a.control,outcomes)
    try:
        verify_payload(here,a.control)
        checkout=subprocess.check_output(['git','-C',str(a.checkout),'rev-parse','HEAD'],env={'PATH':'/usr/bin:/bin','LC_ALL':'C'},text=True,stderr=subprocess.DEVNULL,timeout=10).strip()
        result=collect(a.area,here,a.variant,a.sha,checkout,a.control,outcomes)
    except BaseException:result['reason']='finalizer_validation_failed'
    encoded=bounded_emit(result);print('HF_TERMINAL_V1 '+encoded)
    return terminal_exit_code(encoded)
if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception:
        print('HF_TERMINAL_V1 '+bounded_emit({'schema':SCHEMA,'status':'INCOMPLETE','evidenceComplete':False,'reason':'finalizer_input_failed','stages':[],'compiler':None}));raise SystemExit(1)
