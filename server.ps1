# ==============================================================
# WinTool Server v3 — HTTP local + parsing dynamique des scripts
# ==============================================================

$PORT = 7171
$ROOT = $PSScriptRoot

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$PORT/")
try { $listener.Start() }
catch {
    Write-Host "[ERR] Port $PORT déjà utilisé ou accès refusé : $_" -ForegroundColor Red
    pause; exit 1
}

Write-Host "WinTool Server actif — http://localhost:$PORT" -ForegroundColor Cyan

# ==============================================================
# PARSER — lit un .ps1 et extrait métadonnées + config
# ==============================================================
function Parse-WinToolScript {
    param([string]$Path)

    $filename = Split-Path $Path -Leaf
    $content  = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)

    # --- Métadonnées du bloc WINTOOL:START ... WINTOOL:END ---
    $meta = @{
        file     = $filename
        id       = [System.IO.Path]::GetFileNameWithoutExtension($filename) -replace '^\d+_',''
        title    = $filename
        desc     = ""
        category = "divers"
        icon     = "⚙"
        tags     = @()
        version  = "1.0"
    }

    if ($content -match '(?s)## WINTOOL:START(.+?)## WINTOOL:END') {
        $block = $matches[1]
        foreach ($line in ($block -split "`n")) {
            if ($line -match '##\s+(\w+)\s*:\s*(.+)') {
                $key = $matches[1].Trim().ToLower()
                $val = $matches[2].Trim()
                switch ($key) {
                    "title"    { $meta.title    = $val }
                    "desc"     { $meta.desc     = $val }
                    "category" { $meta.category = $val }
                    "icon"     { $meta.icon     = $val }
                    "version"  { $meta.version  = $val }
                    "tags"     { $meta.tags     = ($val -split ',') | ForEach-Object { $_.Trim() } }
                }
            }
        }
    }

    # --- Config : parser le bloc $CONFIG = @{ ... } ---
    # Chaque ligne : CLE = valeur   # [type] Label — Description
    $configItems = @()

    if ($content -match '(?s)\$CONFIG\s*=\s*@\{(.+?)\n\}') {
        $configBlock = $matches[1]
        foreach ($line in ($configBlock -split "`n")) {
            # Ignorer les lignes commentaires purs ou vides
            if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }

            # Ligne de config : Key = Value   # [type] Label
            if ($line -match '^\s*(\w+)\s*=\s*([^\s#]+)') {
                $key      = $matches[1].Trim()
                $rawVal   = $matches[2].Trim().TrimEnd(',')

                # Type et valeur PowerShell → JSON
                $type    = "bool"
                $default = $false
                $label   = $key
                $sub     = ""
                $hidden  = $false

                switch -Regex ($rawVal) {
                    '^\$true$'  { $type = "bool";   $default = $true }
                    '^\$false$' { $type = "bool";   $default = $false }
                    '^\d+$'     { $type = "number"; $default = [int]$rawVal }
                    '^".*"$'    { $type = "string"; $default = $rawVal.Trim('"') }
                    default     { $type = "string"; $default = $rawVal }
                }

                # Lire le commentaire en fin de ligne : # [type] Label — Sous-texte
                if ($line -match '#\s*\[(\w+)\]\s*(.*)$') {
                    $annotType = $matches[1].ToLower()
                    $rest      = $matches[2].Trim()
                    if ($annotType -eq "hidden") { $hidden = $true }
                    elseif ($annotType -in @("bool","number","string")) { $type = $annotType }
                    # Découper label — sous-texte sur " — " ou " - "
                    if ($rest -match '^(.+?)\s+[-—]\s+(.+)$') {
                        $label = $matches[1].Trim()
                        $sub   = $matches[2].Trim()
                    } elseif ($rest) {
                        $label = $rest
                    }
                }

                $configItems += @{
                    key     = $key
                    label   = $label
                    sub     = $sub
                    type    = $type
                    default = $default
                    hidden  = $hidden
                }
            }
        }
    }

    $meta['config'] = $configItems
    return $meta
}

# ==============================================================
# HELPERS HTTP
# ==============================================================
function Send-Response {
    param($ctx, [string]$body, [string]$ct = "application/json", [int]$code = 200)
    try {
        $r = $ctx.Response
        $r.StatusCode    = $code
        $r.ContentType   = "$ct; charset=utf-8"
        $r.Headers.Add("Access-Control-Allow-Origin",  "*")
        $r.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $r.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
        $r.ContentLength64 = $bytes.Length
        $r.OutputStream.Write($bytes, 0, $bytes.Length)
        $r.OutputStream.Close()
    } catch {}
}

function To-Json {
    param($obj)
    return $obj | ConvertTo-Json -Depth 10 -Compress
}

# ==============================================================
# BOUCLE PRINCIPALE
# ==============================================================
while ($listener.IsListening) {
    try {
        $ctx    = $listener.GetContext()
        $req    = $ctx.Request
        $method = $req.HttpMethod
        $path   = $req.Url.AbsolutePath

        # OPTIONS preflight
        if ($method -eq "OPTIONS") { Send-Response $ctx "{}"; continue }

        # GET /ping
        if ($method -eq "GET" -and $path -eq "/ping") {
            Send-Response $ctx '{"ok":true,"version":"3.0"}'
            continue
        }

        # GET /scripts — scanner et parser tous les .ps1
        if ($method -eq "GET" -and $path -eq "/scripts") {
            $scriptsDir = Join-Path $ROOT "scripts"
            $result     = @()
            if (Test-Path $scriptsDir) {
                Get-ChildItem $scriptsDir -Filter "*.ps1" | Sort-Object Name | ForEach-Object {
                    try {
                        $parsed  = Parse-WinToolScript $_.FullName
                        $result += $parsed
                    } catch {
                        Write-Host "[WARN] Parse error $($_.Name) : $_" -ForegroundColor Yellow
                    }
                }
            }
            Send-Response $ctx (To-Json $result)
            continue
        }

        # GET / ou /index.html
        if ($method -eq "GET" -and ($path -eq "/" -or $path -eq "/index.html")) {
            $htmlPath = Join-Path $ROOT "WinTool.html"
            if (Test-Path $htmlPath) {
                $html = [System.IO.File]::ReadAllText($htmlPath, [System.Text.Encoding]::UTF8)
                Send-Response $ctx $html "text/html"
            } else {
                Send-Response $ctx "<h1>WinTool.html introuvable</h1>" "text/html" 404
            }
            continue
        }

        # POST /run
        if ($method -eq "POST" -and $path -eq "/run") {
            try {
                $reader  = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
                $json    = $reader.ReadToEnd(); $reader.Close()
                $data    = $json | ConvertFrom-Json

                $scriptFile = $data.script
                $config     = $data.config
                $silent     = [bool]$data.silent

                # Validation
                if (!$scriptFile -or $scriptFile -match '[\\/:*?"<>|]' -or $scriptFile -notmatch '\.ps1$') {
                    Send-Response $ctx '{"ok":false,"error":"Nom de script invalide"}' "application/json" 400
                    continue
                }

                $scriptPath = Join-Path "$ROOT\scripts" $scriptFile
                if (!(Test-Path $scriptPath)) {
                    Send-Response $ctx "{`"ok`":false,`"error`":`"Script introuvable : $scriptFile`"}"
                    continue
                }

                # Reconstruire le bloc $CONFIG avec les valeurs de l'interface
                $originalContent = [System.IO.File]::ReadAllText($scriptPath, [System.Text.Encoding]::UTF8)
                $newConfigBlock  = '$CONFIG = @{' + "`n"
                foreach ($prop in $config.PSObject.Properties) {
                    $k = $prop.Name; $v = $prop.Value
                    $psVal = switch ($v.GetType().Name) {
                        "Boolean" { if ($v) { '$true' } else { '$false' } }
                        "Int64"   { "$v" }
                        "Int32"   { "$v" }
                        "Double"  { "$v" }
                        default   { "`"$v`"" }
                    }
                    $newConfigBlock += "    $k = $psVal`n"
                }
                $newConfigBlock += '}'

                $modifiedContent = $originalContent -replace '(?s)\$CONFIG\s*=\s*@\{[^#\r\n]*(?:\r?\n(?!^[}\$]).*)*\r?\n\}', $newConfigBlock

                $tempScript = Join-Path $env:TEMP "wintool_$(Get-Random).ps1"
                [System.IO.File]::WriteAllText($tempScript, $modifiedContent, [System.Text.Encoding]::UTF8)

                if ($silent) {
                    $wrapper = Join-Path $env:TEMP "wintool_wrap_$(Get-Random).ps1"
                    "Start-Process PowerShell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$tempScript`"' -Verb RunAs -Wait" |
                        Out-File $wrapper -Encoding UTF8
                    Start-Process PowerShell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$wrapper`"" -WindowStyle Hidden
                } else {
                    Start-Process PowerShell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$tempScript`"" -Verb RunAs
                }

                Send-Response $ctx '{"ok":true}'

            } catch {
                $err = $_.Exception.Message -replace '"',"'"
                Send-Response $ctx "{`"ok`":false,`"error`":`"$err`"}"
            }
            continue
        }

        Send-Response $ctx '{"error":"Not found"}' "application/json" 404

    } catch {
        $msg = $_.Exception.Message
        if ($msg -notmatch "Thread was being aborted|listener") {
            Write-Host "[ERR] $msg" -ForegroundColor Red
        }
    }
}
