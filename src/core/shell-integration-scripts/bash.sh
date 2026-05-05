# ---------------------------------------------------------------------------------------------
#   Stoa Shell Integration for Bash
#   Ported from VS Code's shellIntegration-bash.sh (MIT License)
#   OSC 633 sequences are the terminal shell integration protocol.
# ---------------------------------------------------------------------------------------------

# Prevent the script recursing when setting up
if [[ -n "${STOA_SHELL_INTEGRATION:-}" ]]; then
	builtin return
fi

STOA_SHELL_INTEGRATION=1

# Run user's profile/rc files since --init-file replaces normal bash loading.
# Stoa always injects, so always source. For login shells (we pass --login),
# source the standard login profile chain.
if [ -r /etc/profile ]; then
	. /etc/profile
fi
if [ -r ~/.bash_profile ]; then
	. ~/.bash_profile
elif [ -r ~/.bash_login ]; then
	. ~/.bash_login
elif [ -r ~/.profile ]; then
	. ~/.profile
fi

if [ -z "$STOA_SHELL_INTEGRATION" ]; then
	builtin return
fi

# Prevent AI-executed commands from polluting shell history
if [ "${STOA_PREVENT_SHELL_HISTORY:-}" = "1" ]; then
	export HISTCONTROL="ignorespace"
	builtin unset STOA_PREVENT_SHELL_HISTORY
fi

__stoa_get_trap() {
	# 'trap -p DEBUG' outputs a shell command like `trap -- '...shellcode...' DEBUG`.
	# Splice those terms into an expression capturing them into an array to preserve quoting.
	builtin local -a terms
	builtin eval "terms=( $(trap -p "${1:-DEBUG}") )"
	builtin printf '%s' "${terms[2]:-}"
}

__stoa_escape_value_fast() {
	builtin local LC_ALL=C out
	out=${1//\\/\\\\}
	out=${out//;/\\x3b}
	builtin printf '%s\n' "${out}"
}

# The property (P) and command (E) codes embed values which require escaping.
# Backslashes are doubled. Non-alphanumeric characters are converted to escaped hex.
__stoa_escape_value() {
	# If the input is too large, switch to the faster function
	if [ "${#1}" -ge 2000 ]; then
		__stoa_escape_value_fast "$1"
		builtin return
	fi

	# Process text byte by byte, not by codepoint.
	builtin local -r LC_ALL=C
	builtin local -r str="${1}"
	builtin local -i i
	builtin local -i val
	builtin local byte
	builtin local token
	builtin local out=''

	for (( i=0; i < "${#str}"; ++i )); do
		# Escape backslashes, semi-colons specially, then special ASCII chars below space (0x20).
		byte="${str:$i:1}"
		builtin printf -v val '%d' "'$byte"
		if  (( val < 31 )); then
			builtin printf -v token '\\x%02x' "'$byte"
		elif (( val == 92 )); then # \
			token="\\\\"
		elif (( val == 59 )); then # ;
			token="\\x3b"
		else
			token="$byte"
		fi

		out+="$token"
	done

	builtin printf '%s\n' "$out"
}

# Send the IsWindows property if the environment looks like Windows
__stoa_regex_environment="^CYGWIN*|MINGW*|MSYS*"
if [[ "$(uname -s)" =~ $__stoa_regex_environment ]]; then
	builtin printf '\e]633;P;IsWindows=True\a'
	__stoa_is_windows=1
else
	__stoa_is_windows=0
fi

builtin unset __stoa_regex_environment

# Allow verifying $BASH_COMMAND doesn't have aliases resolved via history when the right HISTCONTROL
# configuration is used
__stoa_regex_histcontrol=".*(erasedups|ignoreboth|ignoredups|ignorespace).*"
if [[ "${HISTCONTROL:-}" =~ $__stoa_regex_histcontrol ]]; then
	__stoa_history_verify=0
else
	__stoa_history_verify=1
fi

builtin unset __stoa_regex_histcontrol

__stoa_initialized=0
__stoa_original_PS1="$PS1"
__stoa_original_PS2="$PS2"
__stoa_custom_PS1=""
__stoa_custom_PS2=""
__stoa_in_command_execution="1"
__stoa_current_command=""

# It's fine this is in the global scope as getting at it requires access to the shell environment
__stoa_nonce="${STOA_NONCE:-}"
unset STOA_NONCE

# Report continuation prompt
builtin printf "\e]633;P;ContinuationPrompt=$(echo "$PS2" | sed 's/\x1b/\\\\x1b/g')\a"

# Report this shell supports rich command detection
builtin printf '\e]633;P;HasRichCommandDetection=True\a'

__stoa_report_prompt() {
	# Expand the original PS1 similarly to how bash would normally
	# See https://stackoverflow.com/a/37137981 for technique
	if ((BASH_VERSINFO[0] >= 5 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4))); then
		__stoa_prompt=${__stoa_original_PS1@P}
	else
		__stoa_prompt=${__stoa_original_PS1}
	fi

	__stoa_prompt="$(builtin printf "%s" "${__stoa_prompt//[$'\001'$'\002']}")"
	builtin printf "\e]633;P;Prompt=%s\a" "$(__stoa_escape_value "${__stoa_prompt}")"
}

__stoa_prompt_start() {
	builtin printf '\e]633;A\a'
}

__stoa_prompt_end() {
	builtin printf '\e]633;B\a'
}

__stoa_update_cwd() {
	if [ "$__stoa_is_windows" = "1" ]; then
		__stoa_cwd="$(cygpath -m "$PWD")"
	else
		__stoa_cwd="$PWD"
	fi
	builtin printf '\e]633;P;Cwd=%s\a' "$(__stoa_escape_value "$__stoa_cwd")"
}

__stoa_command_output_start() {
	if [[ -z "${__stoa_first_prompt-}" ]]; then
		builtin return
	fi
	builtin printf '\e]633;E;%s;%s\a' "$(__stoa_escape_value "${__stoa_current_command}")" "$__stoa_nonce"
	builtin printf '\e]633;C\a'
}

__stoa_continuation_start() {
	builtin printf '\e]633;F\a'
}

__stoa_continuation_end() {
	builtin printf '\e]633;G\a'
}

__stoa_command_complete() {
	if [[ -z "${__stoa_first_prompt-}" ]]; then
		__stoa_update_cwd
		builtin return
	fi
	if [ "$__stoa_current_command" = "" ]; then
		builtin printf '\e]633;D\a'
	else
		builtin printf '\e]633;D;%s\a' "$__stoa_status"
	fi
	__stoa_update_cwd
}

__stoa_update_prompt() {
	# in command execution
	if [ "$__stoa_in_command_execution" = "1" ]; then
		# Wrap the prompt if it is not yet wrapped, if the PS1 changed this this was last set it
		# means the user re-exported the PS1 so we should re-wrap it
		if [[ "$__stoa_custom_PS1" == "" || "$__stoa_custom_PS1" != "$PS1" ]]; then
			__stoa_original_PS1=$PS1
			__stoa_custom_PS1="\[$(__stoa_prompt_start)\]$__stoa_original_PS1\[$(__stoa_prompt_end)\]"
			PS1="$__stoa_custom_PS1"
		fi
		if [[ "$__stoa_custom_PS2" == "" || "$__stoa_custom_PS2" != "$PS2" ]]; then
			__stoa_original_PS2=$PS2
			__stoa_custom_PS2="\[$(__stoa_continuation_start)\]$__stoa_original_PS2\[$(__stoa_continuation_end)\]"
			PS2="$__stoa_custom_PS2"
		fi
		__stoa_in_command_execution="0"
	fi
}

__stoa_precmd() {
	__stoa_command_complete "$__stoa_status"
	__stoa_current_command=""
	__stoa_report_prompt
	__stoa_first_prompt=1
	__stoa_update_prompt
}

__stoa_preexec() {
	__stoa_initialized=1
	if [[ ! $BASH_COMMAND == __stoa_prompt* ]]; then
		# Use history if it's available to verify the command as BASH_COMMAND comes in with aliases
		# resolved
		if [ "$__stoa_history_verify" = "1" ]; then
			__stoa_current_command="$(builtin history 1 | sed 's/ *[0-9]* *//')"
		else
			__stoa_current_command=$BASH_COMMAND
		fi
	else
		__stoa_current_command=""
	fi
	__stoa_command_output_start
}

# Debug trapping/preexec inspired by starship (ISC)
if [[ -n "${bash_preexec_imported:-}" ]]; then
	__stoa_preexec_only() {
		if [ "$__stoa_in_command_execution" = "0" ]; then
			__stoa_in_command_execution="1"
			__stoa_preexec
		fi
	}
	precmd_functions+=(__stoa_prompt_cmd)
	preexec_functions+=(__stoa_preexec_only)
else
	__stoa_dbg_trap="$(__stoa_get_trap DEBUG)"

	if [[ -z "$__stoa_dbg_trap" ]]; then
		__stoa_preexec_only() {
			if [ "$__stoa_in_command_execution" = "0" ]; then
				__stoa_in_command_execution="1"
				__stoa_preexec
			fi
		}
		trap '__stoa_preexec_only "$_"' DEBUG
	elif [[ "$__stoa_dbg_trap" != '__stoa_preexec "$_"' && "$__stoa_dbg_trap" != '__stoa_preexec_all "$_"' ]]; then
		__stoa_preexec_all() {
			if [ "$__stoa_in_command_execution" = "0" ]; then
				__stoa_in_command_execution="1"
				__stoa_preexec
				builtin eval "${__stoa_dbg_trap}"
			fi
		}
		trap '__stoa_preexec_all "$_"' DEBUG
	fi
fi

__stoa_update_prompt

__stoa_restore_exit_code() {
	return "$1"
}

__stoa_prompt_cmd_original() {
	__stoa_status="$?"
	builtin local cmd
	__stoa_restore_exit_code "${__stoa_status}"
	# Evaluate the original PROMPT_COMMAND similarly to how bash would normally
	# See https://unix.stackexchange.com/a/672843 for technique
	for cmd in "${__stoa_original_prompt_command[@]}"; do
		eval "${cmd:-}"
	done
	__stoa_precmd
}

__stoa_prompt_cmd() {
	__stoa_status="$?"
	__stoa_precmd
}

# PROMPT_COMMAND arrays and strings seem to be handled the same (handling only the first entry of
# the array?)
__stoa_original_prompt_command=${PROMPT_COMMAND:-}

if [[ -z "${bash_preexec_imported:-}" ]]; then
	if [[ -n "${__stoa_original_prompt_command:-}" && "${__stoa_original_prompt_command:-}" != "__stoa_prompt_cmd" ]]; then
		PROMPT_COMMAND=__stoa_prompt_cmd_original
	else
		PROMPT_COMMAND=__stoa_prompt_cmd
	fi
fi
