#Requires -Version 7.2
# Read-only documentation checks. No model, service, or product execution.
[CmdletBinding()]
param()

$PackRootPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$DocErrors = [Collections.Generic.List[string]]::new()
$DocCache = @{}
$CheckCount = 0

function Assert-Doc([bool]$Condition, [string]$Message) {
    $script:CheckCount++
    if (-not $Condition) { $script:DocErrors.Add($Message) }
}

function Read-Doc([string]$DocPath) {
    $FullDocPath = [IO.Path]::GetFullPath($DocPath)
    if (-not $script:DocCache.ContainsKey($FullDocPath)) {
        $script:DocCache[$FullDocPath] = [IO.File]::ReadAllText($FullDocPath, [Text.UTF8Encoding]::new($false, $true))
    }
    return $script:DocCache[$FullDocPath]
}

function Has-Anchor([string]$DocText, [string]$Fragment) {
    $DecodedFragment = [Uri]::UnescapeDataString($Fragment)
    if ($DocText -match ('id="' + [regex]::Escape($DecodedFragment) + '"')) { return $true }
    foreach ($HeadingMatch in [regex]::Matches($DocText, '(?m)^#{1,6}\s+(.+?)\s*\r?$')) {
        $HeadingSlug = $HeadingMatch.Groups[1].Value.ToLowerInvariant() -replace '[^\p{L}\p{N}\s_-]', '' -replace '\s', '-'
        if ($HeadingSlug -eq $DecodedFragment) { return $true }
    }
    return $false
}

function Visit-PromptModule([string]$ModuleId) {
    if ($script:VisitedIds.Contains($ModuleId)) { return }
    if ($script:VisitingIds.Contains($ModuleId)) {
        Assert-Doc $false "Dependency cycle at $ModuleId"
        return
    }
    if (-not $script:ModuleMap.ContainsKey($ModuleId)) { return }
    [void]$script:VisitingIds.Add($ModuleId)
    foreach ($DependencyId in $script:ModuleMap[$ModuleId].requires) { Visit-PromptModule $DependencyId }
    [void]$script:VisitingIds.Remove($ModuleId)
    [void]$script:VisitedIds.Add($ModuleId)
}

try {
    $ManifestDoc = (Read-Doc (Join-Path $PackRootPath 'manifest.json')) | ConvertFrom-Json -Depth 50 -ErrorAction Stop
    $FixtureDoc = (Read-Doc (Join-Path $PackRootPath 'contracts/examples.json')) | ConvertFrom-Json -Depth 50 -ErrorAction Stop
    $CaseDoc = (Read-Doc (Join-Path $PackRootPath 'review/cases.json')) | ConvertFrom-Json -Depth 50 -ErrorAction Stop
    Assert-Doc ($ManifestDoc.runtimeStatus -eq 'partially_integrated') 'Manifest must distinguish foundation integration from the complete product Agent.'
    Assert-Doc ($CaseDoc.execution -eq 'not_run_against_model') 'Cases must not claim model execution.'
    Assert-Doc ($ManifestDoc.version -eq $FixtureDoc.formatVersion -and $ManifestDoc.version -eq $CaseDoc.formatVersion) 'Document versions disagree.'
    Assert-Doc (@($ManifestDoc.outputModeRequirements.structured) -contains 'outputContract') 'Structured mode must require an output contract regardless of recipe.'

    $ModuleMap = @{}
    $ModulePaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($PromptModule in $ManifestDoc.modules) {
        Assert-Doc (-not $ModuleMap.ContainsKey($PromptModule.id)) "Duplicate module ID: $($PromptModule.id)"
        $ModuleMap[$PromptModule.id] = $PromptModule
        Assert-Doc ($ModulePaths.Add($PromptModule.path)) "Duplicate module path: $($PromptModule.path)"
        Assert-Doc ($PromptModule.version -eq $ManifestDoc.version) "Module version mismatch: $($PromptModule.id)"
        $PromptPath = [IO.Path]::GetFullPath((Join-Path $PackRootPath $PromptModule.path))
        Assert-Doc ($PromptPath.StartsWith($PackRootPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) "Module path escapes pack: $($PromptModule.path)"
        Assert-Doc ([IO.File]::Exists($PromptPath)) "Missing module: $($PromptModule.path)"
        if (-not [IO.File]::Exists($PromptPath)) { continue }
        $PromptDoc = Read-Doc $PromptPath
        $BeginCount = [regex]::Matches($PromptDoc, [regex]::Escape($ManifestDoc.promptBoundary.begin)).Count
        $EndCount = [regex]::Matches($PromptDoc, [regex]::Escape($ManifestDoc.promptBoundary.end)).Count
        Assert-Doc ($BeginCount -eq 1 -and $EndCount -eq 1) "Prompt markers must be unique: $($PromptModule.id)"
        $BodyMatch = [regex]::Match($PromptDoc, '(?s)<!-- prompt:begin -->(.*?)<!-- prompt:end -->')
        Assert-Doc ($BodyMatch.Success -and $BodyMatch.Groups[1].Value.Trim().Length -gt 0) "Missing prompt body: $($PromptModule.id)"
        Assert-Doc ($PromptDoc.Contains('- ID：`' + $PromptModule.id + '`')) "Module ID metadata mismatch: $($PromptModule.id)"
        Assert-Doc ($PromptDoc.Contains('- 版本：`' + $ManifestDoc.version + '`')) "Module version metadata mismatch: $($PromptModule.id)"
        Assert-Doc ($PromptDoc.Contains('## 維護與靜態例子')) "Missing maintenance/examples: $($PromptModule.id)"
        Assert-Doc (-not ($BodyMatch.Groups[1].Value -match '\{\{[^}]+\}\}')) "Unresolved placeholder in prompt body: $($PromptModule.id)"
    }

    foreach ($PromptModule in $ManifestDoc.modules) {
        foreach ($DependencyId in $PromptModule.requires) {
            Assert-Doc ($ModuleMap.ContainsKey($DependencyId)) "Unknown dependency $DependencyId in $($PromptModule.id)"
        }
    }
    $VisitingIds = [Collections.Generic.HashSet[string]]::new()
    $VisitedIds = [Collections.Generic.HashSet[string]]::new()
    foreach ($ModuleId in $ModuleMap.Keys) { Visit-PromptModule $ModuleId }

    $RecipeMap = @{}
    $UsedModules = [Collections.Generic.HashSet[string]]::new()
    foreach ($Recipe in $ManifestDoc.recipes) {
        Assert-Doc (-not $RecipeMap.ContainsKey($Recipe.id)) "Duplicate recipe: $($Recipe.id)"
        $RecipeMap[$Recipe.id] = $Recipe
        $RecipeModules = @($ManifestDoc.baseModules) + @($ManifestDoc.domain.requiredModules) + @($Recipe.additionalModules) | Select-Object -Unique
        Assert-Doc ($RecipeModules -contains 'core.conversation') "Recipe lacks conversation core: $($Recipe.id)"
        Assert-Doc ($RecipeModules -contains 'domain.childcare-hk.safety') "Recipe lacks domain safety: $($Recipe.id)"
        foreach ($ModuleId in $RecipeModules) {
            Assert-Doc ($ModuleMap.ContainsKey($ModuleId)) "Unknown recipe module: $ModuleId"
            [void]$UsedModules.Add($ModuleId)
            if (-not $ModuleMap.ContainsKey($ModuleId)) { continue }
            foreach ($DependencyId in $ModuleMap[$ModuleId].requires) {
                Assert-Doc ($RecipeModules -contains $DependencyId) "Recipe $($Recipe.id) misses dependency $DependencyId"
            }
        }
        Assert-Doc (@($Recipe.requiredInputs).Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($Recipe.missingCapability)) "Recipe contract incomplete: $($Recipe.id)"
        foreach ($OutputMode in $Recipe.outputModes) {
            Assert-Doc ($OutputMode -in @('text', 'tool_cycle', 'structured')) "Unknown output mode: $OutputMode"
        }
    }
    foreach ($ModuleId in $ModuleMap.Keys) { Assert-Doc ($UsedModules.Contains($ModuleId)) "Unused module: $ModuleId" }

    $FixtureIds = [Collections.Generic.HashSet[string]]::new()
    $ResultFields = @('contractVersion', 'decision', 'replyText', 'candidates', 'actionRequests', 'questions', 'sourceRefs', 'limitations')
    foreach ($Fixture in $FixtureDoc.fixtures) {
        Assert-Doc ($FixtureIds.Add($Fixture.id)) "Duplicate fixture: $($Fixture.id)"
        Assert-Doc ($Fixture.synthetic -eq $true) "Fixture not marked synthetic: $($Fixture.id)"
        Assert-Doc ($RecipeMap.ContainsKey($Fixture.recipeId)) "Unknown fixture recipe: $($Fixture.id)"
        Assert-Doc ($Fixture.input.run.mode -in @('interactive', 'background')) "Invalid run mode: $($Fixture.id)"
        Assert-Doc (@($Fixture.expected.requiredBehaviors).Count -gt 0 -and @($Fixture.expected.forbiddenBehaviors).Count -gt 0) "Fixture expectations incomplete: $($Fixture.id)"
        if ($RecipeMap.ContainsKey($Fixture.recipeId)) {
            Assert-Doc ($Fixture.expected.mode -in $RecipeMap[$Fixture.recipeId].outputModes) "Fixture mode not allowed by recipe: $($Fixture.id)"
            foreach ($RequiredContext in $RecipeMap[$Fixture.recipeId].requiredInputs) {
                Assert-Doc ($RequiredContext -in @($Fixture.input.PSObject.Properties.Name)) "Fixture context missing $RequiredContext in $($Fixture.id)"
            }
        }
        if ($Fixture.expected.mode -eq 'structured') {
            $ExpectedResult = $Fixture.expected.result
            $ActualFields = @($ExpectedResult.PSObject.Properties.Name)
            Assert-Doc (@(Compare-Object $ResultFields $ActualFields).Count -eq 0) "Structured fields disagree: $($Fixture.id)"
            Assert-Doc ($ExpectedResult.contractVersion -eq $ManifestDoc.version) "Result version mismatch: $($Fixture.id)"
            Assert-Doc ($ExpectedResult.decision -in @('reply','clarify','propose','no_action','blocked','reconcile')) "Unknown result decision: $($Fixture.id)"
            if ($Fixture.input.run.mode -eq 'interactive') {
                Assert-Doc (-not [string]::IsNullOrWhiteSpace($ExpectedResult.replyText)) "Interactive final result lacks human text: $($Fixture.id)"
            }
            foreach ($ArrayField in @('candidates','actionRequests','questions','sourceRefs','limitations')) {
                Assert-Doc ($ExpectedResult.$ArrayField -is [array]) "Expected array $ArrayField in $($Fixture.id)"
            }
            foreach ($SourceRef in $ExpectedResult.sourceRefs) {
                Assert-Doc ($SourceRef -in @($Fixture.input.evidence.ref)) "Unknown authored sourceRef $SourceRef in $($Fixture.id)"
            }
        } else {
            Assert-Doc (-not [string]::IsNullOrWhiteSpace($Fixture.expected.text)) "Text fixture is empty: $($Fixture.id)"
        }
    }

    $CaseIds = [Collections.Generic.HashSet[string]]::new()
    $CoveredAxes = [Collections.Generic.HashSet[string]]::new()
    foreach ($ReviewCase in $CaseDoc.cases) {
        Assert-Doc ($CaseIds.Add($ReviewCase.id)) "Duplicate case: $($ReviewCase.id)"
        Assert-Doc ($ReviewCase.synthetic -eq $true) "Case not marked synthetic: $($ReviewCase.id)"
        Assert-Doc ($RecipeMap.ContainsKey($ReviewCase.recipeId)) "Unknown case recipe: $($ReviewCase.id)"
        Assert-Doc (@($ReviewCase.expected).Count -gt 0 -and @($ReviewCase.forbidden).Count -gt 0) "Case lacks expectations: $($ReviewCase.id)"
        foreach ($Axis in $ReviewCase.axes) { [void]$CoveredAxes.Add($Axis) }
        foreach ($Requirement in $ReviewCase.requirements) {
            $RefParts = $Requirement.Split('#', 2)
            $AuthorityRelative = $CaseDoc.authorityFiles.($RefParts[0])
            Assert-Doc (-not [string]::IsNullOrWhiteSpace($AuthorityRelative)) "Unknown authority: $Requirement"
            if ([string]::IsNullOrWhiteSpace($AuthorityRelative)) { continue }
            $AuthorityPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $AuthorityRelative))
            Assert-Doc ([IO.File]::Exists($AuthorityPath)) "Missing authority file: $Requirement"
            if ([IO.File]::Exists($AuthorityPath)) {
                Assert-Doc (Has-Anchor (Read-Doc $AuthorityPath) $RefParts[1]) "Missing authority anchor: $Requirement"
            }
        }
    }
    foreach ($Axis in $CaseDoc.requiredAxes) { Assert-Doc ($CoveredAxes.Contains($Axis)) "Uncovered review axis: $Axis" }

    $PackFiles = @(Get-ChildItem -LiteralPath $PackRootPath -Recurse -File -ErrorAction Stop | Sort-Object FullName)
    foreach ($MarkdownFile in ($PackFiles | Where-Object Extension -eq '.md')) {
        $MarkdownText = Read-Doc $MarkdownFile.FullName
        $UnregisteredBody = $MarkdownText.Contains('<!-- prompt:begin -->') -and $MarkdownText.Contains('## Agent 指令')
        if ($UnregisteredBody) {
            $RegisteredPath = [IO.Path]::GetRelativePath($PackRootPath, $MarkdownFile.FullName).Replace('\','/')
            Assert-Doc ($ModulePaths.Contains($RegisteredPath)) "Unregistered prompt module: $RegisteredPath"
        }
        foreach ($DocLink in [regex]::Matches($MarkdownText, '\[[^\]]*\]\((?<target>[^)\r\n]+)\)')) {
            $LinkTarget = $DocLink.Groups['target'].Value.Trim('<', '>')
            if ($LinkTarget -match '^[a-zA-Z][a-zA-Z0-9+.-]*:') { continue }
            $LinkParts = $LinkTarget.Split('#', 2)
            $LinkedPath = if ($LinkParts[0]) { [IO.Path]::GetFullPath((Join-Path $MarkdownFile.DirectoryName $LinkParts[0])) } else { $MarkdownFile.FullName }
            Assert-Doc ([IO.File]::Exists($LinkedPath)) "Broken local link in $($MarkdownFile.Name): $LinkTarget"
            if ([IO.File]::Exists($LinkedPath) -and $LinkParts.Count -eq 2 -and $LinkParts[1]) {
                Assert-Doc (Has-Anchor (Read-Doc $LinkedPath) $LinkParts[1]) "Broken fragment in $($MarkdownFile.Name): $LinkTarget"
            }
        }
    }

    $HashLines = foreach ($PackFile in $PackFiles) {
        $RelativePackPath = [IO.Path]::GetRelativePath($PackRootPath, $PackFile.FullName).Replace('\','/')
        $CanonicalText = (Read-Doc $PackFile.FullName).Replace("`r`n", "`n")
        $FileHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($CanonicalText))).ToLowerInvariant()
        $RelativePackPath + ':' + $FileHash
    }
    $CombinedHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes(($HashLines -join "`n")))).ToLowerInvariant()
    $DocReport = [ordered]@{
        evidenceId = 'EV-DOC-P01'
        generatedAt = [DateTimeOffset]::Now.ToString('o')
        powershellVersion = $PSVersionTable.PSVersion.ToString()
        scope = 'Static documentation structure and authored fixtures only; no model or product execution.'
        packVersion = $ManifestDoc.version
        modules = @($ManifestDoc.modules).Count
        recipes = @($ManifestDoc.recipes).Count
        syntheticFixtures = @($FixtureDoc.fixtures).Count
        syntheticCases = @($CaseDoc.cases).Count
        packFiles = $PackFiles.Count
        assertions = $CheckCount
        coveredAxes = @($CoveredAxes | Sort-Object)
        packSha256 = $CombinedHash
        packHashNormalization = 'UTF-8 text with LF newlines; sorted relative paths and per-file SHA256 hashes.'
        passed = ($DocErrors.Count -eq 0)
        errors = @($DocErrors)
        notRun = @('Gemini/model evaluation', 'Product integration', 'External delivery', 'Android/device testing', 'High-cost regression')
    }
    $DocReport | ConvertTo-Json -Depth 8
    if ($DocErrors.Count -gt 0) { exit 1 }
} catch {
    [ordered]@{ evidenceId='EV-DOC-P01'; passed=$false; errors=@($_.Exception.Message); assertions=$CheckCount } | ConvertTo-Json -Depth 4
    exit 1
}
