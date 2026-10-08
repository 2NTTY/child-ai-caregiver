import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";

/** Verify that a local secret/journal is accessible only to this account and OS administrators. */
export async function assertPrivatePath(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error("private_path_invalid");
  if (process.platform !== "win32") {
    if (info.mode & 0o077) throw new Error("private_path_permissions");
    return;
  }
  const script = `$ErrorActionPreference='Stop'
$acl=Get-Acl -LiteralPath $env:YUBAN_PRIVATE_PATH_CHECK
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed=@($sid,'S-1-5-18','S-1-5-32-544')
$owner=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
if($owner -notin $allowed){exit 2}
foreach($rule in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){
  if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed){exit 3}
}
exit 0`;
  await new Promise<void>((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script],
      { env: { ...process.env, PSModulePath: "", YUBAN_PRIVATE_PATH_CHECK: path }, windowsHide: true, timeout: 10000, maxBuffer: 2048 },
      error => error ? reject(new Error("private_path_permissions")) : resolve());
  });
}
