# ---------------------------------------------------------------------------------------------
#   Stoa Shell Integration for Fish
#   Ported from VS Code's shellIntegration.fish (MIT License)
#   OSC 633 sequences are the terminal shell integration protocol.
# ---------------------------------------------------------------------------------------------

# Don't run more than once per session.
if set --query STOA_SHELL_INTEGRATION
	return 0
end

set --global STOA_SHELL_INTEGRATION 1

# Prevent AI-executed commands from polluting shell history
if test "$STOA_PREVENT_SHELL_HISTORY" = "1"
	set -g fish_private_mode 1
	set -e STOA_PREVENT_SHELL_HISTORY
end

# Tracks if the shell has been initialized
set -g __stoa_initialized 0

# Handle the shell integration nonce
if set -q STOA_NONCE
	set -g __stoa_nonce $STOA_NONCE
	set -e STOA_NONCE
end

# Helper: emit OSC 633 escape sequences
function __stoa_esc -d "Emit OSC 633 escape sequences for Stoa shell integration"
	builtin printf "\e]633;%s\a" (string join ";" -- $argv)
end

# Escape a value for use in the 'P' ("Property") or 'E' ("Command Line") sequences.
# Backslashes are doubled and semicolons are hex encoded.
function __stoa_escape_value
	echo $argv \
	| string replace --all '\\' '\\\\' \
	| string replace --all ';' '\\x3b' \
	;
end

# Sent right before executing an interactive command.
# Marks the beginning of command output.
function __stoa_cmd_executed --on-event fish_preexec
	__stoa_esc E (__stoa_escape_value "$argv") $__stoa_nonce
	__stoa_esc C

	# Creates a marker to indicate a command was run.
	set --global _stoa_has_cmd
end

# Sent right after an interactive command has finished executing.
# Marks the end of command output.
function __stoa_cmd_finished --on-event fish_postexec
	__stoa_esc D $status
end

# Sent when a command line is cleared or reset, but no command was run.
# Marks the cleared line with neither success nor failure.
function __stoa_cmd_clear --on-event fish_cancel
	if test $__stoa_initialized -eq 0
		return
	end
	__stoa_esc E "" $__stoa_nonce
	__stoa_esc C
	__stoa_esc D
end

# Preserve the user's existing prompt, to wrap in our escape sequences.
function __preserve_fish_prompt --on-event fish_prompt
	if functions --query fish_prompt
		if functions --query __stoa_fish_prompt
			# Erase the fallback so it can be set to the user's prompt
			functions --erase __stoa_fish_prompt
		end
		functions --copy fish_prompt __stoa_fish_prompt
		functions --erase __preserve_fish_prompt
		# Now __stoa_fish_prompt is guaranteed to be defined
		__init_stoa_shell_integration
	else
		if functions --query __stoa_fish_prompt
			functions --erase __preserve_fish_prompt
			__init_stoa_shell_integration
		else
			# There is no fish_prompt set, use a default
			function __stoa_fish_prompt
				echo -n (whoami) @(prompt_hostname) (prompt_pwd) '~> '
			end
		end
	end
end

# Sent whenever a new fish prompt is about to be displayed.
# Updates the current working directory.
function __stoa_update_cwd --on-event fish_prompt
	__stoa_esc P Cwd=(__stoa_escape_value "$PWD")

	# If a command marker exists, remove it.
	# Otherwise, the commandline is empty and no command was run.
	if set --query _stoa_has_cmd
		set --erase _stoa_has_cmd
	else
		__stoa_cmd_clear
	end
end

# Sent at the start of the prompt.
# Marks the beginning of the prompt (and, implicitly, a new line).
function __stoa_fish_prompt_start
	__stoa_esc A
	set -g __stoa_initialized 1
end

# Sent at the end of the prompt.
# Marks the beginning of the user's command input.
function __stoa_fish_cmd_start
	__stoa_esc B
end

function __stoa_fish_has_mode_prompt -d "Returns true if fish_mode_prompt is defined and not empty"
	functions fish_mode_prompt | string match -rvq '^ *(#|function |end$|$)'
end

# Preserve and wrap fish_mode_prompt (which appears to the left of the regular
# prompt), but only if it's not defined as an empty function.
function __init_stoa_shell_integration
	if __stoa_fish_has_mode_prompt
		functions --copy fish_mode_prompt __stoa_fish_mode_prompt

		function fish_mode_prompt
			__stoa_fish_prompt_start
			__stoa_fish_mode_prompt
		end

		function fish_prompt
			__stoa_fish_prompt
			__stoa_fish_cmd_start
		end
	else
		# No fish_mode_prompt, so put everything in fish_prompt.
		function fish_prompt
			__stoa_fish_prompt_start
			__stoa_fish_prompt
			__stoa_fish_cmd_start
		end
	end
end

# Report this shell supports rich command detection
__stoa_esc P HasRichCommandDetection=True

__preserve_fish_prompt
