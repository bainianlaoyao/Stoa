# ---------------------------------------------------------------------------------------------
#   Stoa Shell Integration for PowerShell
#   Ported from VS Code's shellIntegration.ps1 (MIT License)
#   OSC 633 sequences are the terminal shell integration protocol.
# ---------------------------------------------------------------------------------------------

# Prevent installing more than once per session
if ((Test-Path variable:global:__StoaState) -and $null -ne $Global:__StoaState.OriginalPrompt) {
	return
}

# Disable shell integration when the language mode is restricted
if ($ExecutionContext.SessionState.LanguageMode -ne "FullLanguage") {
	return
}

$Global:__StoaState = @{
	OriginalPrompt = $function:Prompt
	LastHistoryId = -1
	IsInExecution = $false
	Nonce = $null
	IsA11yMode = $null
	IsWindows10 = $false
}

# Store the nonce in a regular variable and unset the environment variable.
$Global:__StoaState.Nonce = $env:STOA_NONCE
$env:STOA_NONCE = $null

$Global:__StoaState.IsA11yMode = $env:STOA_A11Y_MODE
$env:STOA_A11Y_MODE = $null

$osVersion = [System.Environment]::OSVersion.Version
$Global:__StoaState.IsWindows10 = $IsWindows -and $osVersion.Major -eq 10 -and $osVersion.Minor -eq 0 -and $osVersion.Build -lt 22000
Remove-Variable -Name osVersion -ErrorAction SilentlyContinue

function Global:__Stoa-Escape-Value([string]$value) {
	# Replace any non-alphanumeric characters below space, backslashes, newlines, and semicolons.
	[regex]::Replace($value, "[$([char]0x00)-$([char]0x1f)\\\n;]", { param($match)
			# Encode the (ascii) matches as `\x<hex>`
			-Join (
				[System.Text.Encoding]::UTF8.GetBytes($match.Value) | ForEach-Object { '\x{0:x2}' -f $_ }
			)
		})
}

function Global:Prompt() {
	$FakeCode = [int]!$global:?
	# NOTE: We disable strict mode for the scope of this function because it unhelpfully throws an
	# error when $LastHistoryEntry is null, and is not otherwise useful.
	Set-StrictMode -Off
	$LastHistoryEntry = Get-History -Count 1
	$Result = ""
	# Skip finishing the command if the first command has not yet started or an execution has not
	# yet begun
	if ($Global:__StoaState.LastHistoryId -ne -1 -and ($Global:__StoaState.HasPSReadLine -eq $false -or $Global:__StoaState.IsInExecution -eq $true)) {
		$Global:__StoaState.IsInExecution = $false
		if ($LastHistoryEntry.Id -eq $Global:__StoaState.LastHistoryId) {
			# Don't provide a command line or exit code if there was no history entry (eg. ctrl+c, enter on no command)
			$Result += "$([char]0x1b)]633;D`a"
		}
		else {
			# Command finished exit code
			# OSC 633 ; D [; <ExitCode>] ST
			$Result += "$([char]0x1b)]633;D;$FakeCode`a"
		}
	}
	# Prompt started
	# OSC 633 ; A ST
	$Result += "$([char]0x1b)]633;A`a"
	# Current working directory
	# OSC 633 ; <Property>=<Value> ST
	$Result += if ($pwd.Provider.Name -eq 'FileSystem') { "$([char]0x1b)]633;P;Cwd=$(__Stoa-Escape-Value $pwd.ProviderPath)`a" }

	# Before running the original prompt, put $? back to what it was:
	if ($FakeCode -ne 0) {
		Write-Error "failure" -ea ignore
	}
	# Run the original prompt
	$OriginalPrompt += $Global:__StoaState.OriginalPrompt.Invoke()
	$Result += $OriginalPrompt

	# Prompt
	# OSC 633 ; <Property>=<Value> ST
	$Result += "$([char]0x1b)]633;P;Prompt=$(__Stoa-Escape-Value $OriginalPrompt)`a"

	# Write command started
	$Result += "$([char]0x1b)]633;B`a"
	$Global:__StoaState.LastHistoryId = $LastHistoryEntry.Id
	return $Result
}

# Handle screen reader mode for PSReadLine
if ($Global:__StoaState.IsA11yMode -eq "1") {
	$hasScreenReaderParam = (Get-Module -Name PSReadLine) -and (Get-Command Set-PSReadLineOption).Parameters.ContainsKey('EnableScreenReaderMode')

	if ($hasScreenReaderParam) {
		Set-PSReadLineOption -EnableScreenReaderMode
	}
}

# Only send the command executed sequence when PSReadLine is loaded
$Global:__StoaState.HasPSReadLine = $false
if (Get-Module -Name PSReadLine) {
	$Global:__StoaState.HasPSReadLine = $true
	[Console]::Write("$([char]0x1b)]633;P;HasRichCommandDetection=True`a")

	$Global:__StoaState.OriginalPSConsoleHostReadLine = $function:PSConsoleHostReadLine
	function Global:PSConsoleHostReadLine {
		$CommandLine = $Global:__StoaState.OriginalPSConsoleHostReadLine.Invoke()
		$Global:__StoaState.IsInExecution = $true

		# Command line
		# OSC 633 ; E [; <CommandLine> [; <Nonce>]] ST
		$Result = "$([char]0x1b)]633;E;"
		$Result += $(__Stoa-Escape-Value $CommandLine)
		# Only send the nonce if the OS is not Windows 10 as it seems to echo to the terminal
		if ($Global:__StoaState.IsWindows10 -eq $false) {
			$Result += ";$($Global:__StoaState.Nonce)"
		}
		$Result += "`a"

		# Command executed
		# OSC 633 ; C ST
		$Result += "$([char]0x1b)]633;C`a"

		# Write command executed sequence directly to Console to avoid the new line from Write-Host
		[Console]::Write($Result)

		$CommandLine
	}

	# Set ContinuationPrompt property
	$Global:__StoaState.ContinuationPrompt = (Get-PSReadLineOption).ContinuationPrompt
	if ($Global:__StoaState.ContinuationPrompt) {
		[Console]::Write("$([char]0x1b)]633;P;ContinuationPrompt=$(__Stoa-Escape-Value $Global:__StoaState.ContinuationPrompt)`a")
	}

	# Prevent AI-executed commands from polluting shell history
	if ($env:STOA_PREVENT_SHELL_HISTORY -eq "1") {
		Set-PSReadLineOption -AddToHistoryHandler {
			param([string]$line)
			return $false
		}
		$env:STOA_PREVENT_SHELL_HISTORY = $null
	}
}

# Set IsWindows property
if ($PSVersionTable.PSVersion -lt "6.0") {
	[Console]::Write("$([char]0x1b)]633;P;IsWindows=$true`a")
}
else {
	[Console]::Write("$([char]0x1b)]633;P;IsWindows=$IsWindows`a")
}
