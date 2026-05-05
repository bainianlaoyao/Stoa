# ---------------------------------------------------------------------------------------------
#   Stoa Shell Integration for Zsh
#   Ported from VS Code's shellIntegration-rc.zsh (MIT License)
#   OSC 633 sequences are the terminal shell integration protocol.
# ---------------------------------------------------------------------------------------------
builtin autoload -Uz add-zsh-hook

# Prevent the script recursing when setting up
if [ -n "$STOA_SHELL_INTEGRATION" ]; then
	ZDOTDIR="${USER_ZDOTDIR:-$HOME}"
	builtin return
fi

# This variable allows the shell to both detect that Stoa's shell integration is enabled as well
# as disable it by unsetting the variable.
STOA_SHELL_INTEGRATION=1

# Default USER_ZDOTDIR to $HOME if not set externally (standard zsh default)
USER_ZDOTDIR="${USER_ZDOTDIR:-$HOME}"

# By default, zsh will set the $HISTFILE to the $ZDOTDIR location automatically.
# Fix this by setting $HISTFILE back to the default location before ~/.zshrc is called.
HISTFILE="${USER_ZDOTDIR}/.zsh_history"

# Source the user's real .zshrc from their original ZDOTDIR
if [[ $options[norcs] = off && -f "${USER_ZDOTDIR}/.zshrc" ]]; then
	__stoa_injected_zdotdir="$ZDOTDIR"
	ZDOTDIR="${USER_ZDOTDIR}"
	. "${USER_ZDOTDIR}/.zshrc"
fi

# Shell integration was disabled by the shell, exit without warning assuming either the shell has
# explicitly disabled shell integration as it's incompatible or it implements the protocol.
if [ -z "$STOA_SHELL_INTEGRATION" ]; then
	builtin return
fi

# Prevent AI-executed commands from polluting shell history
if [ "${STOA_PREVENT_SHELL_HISTORY:-}" = "1" ]; then
	builtin setopt HIST_IGNORE_SPACE
	builtin unset STOA_PREVENT_SHELL_HISTORY
fi

# The property (P) and command (E) codes embed values which require escaping.
# Backslashes are doubled. Non-alphanumeric characters are converted to escaped hex.
__stoa_escape_value() {
	builtin emulate -L zsh

	# Process text byte by byte, not by codepoint.
	builtin local LC_ALL=C str="$1" i byte token out='' val

	for (( i = 0; i < ${#str}; ++i )); do
		# Escape backslashes, semi-colons specially, then special ASCII chars below space (0x20).
		byte="${str:$i:1}"
		val=$(printf "%d" "'$byte")
		if (( val < 31 )); then
			token=$(printf "\\\\x%02x" "'$byte")
		elif [ "$byte" = "\\" ]; then
			token="\\\\"
		elif [ "$byte" = ";" ]; then
			token="\\x3b"
		else
			token="$byte"
		fi

		out+="$token"
	done

	builtin print -r -- "$out"
}

__stoa_in_command_execution="1"
__stoa_current_command=""

# It's fine this is in the global scope as getting at it requires access to the shell environment
__stoa_nonce="${STOA_NONCE:-}"
unset STOA_NONCE

builtin printf "\e]633;P;ContinuationPrompt=%s\a" "$(echo "$PS2" | sed 's/\x1b/\\\\x1b/g')"

# Report this shell supports rich command detection
builtin printf '\e]633;P;HasRichCommandDetection=True\a'

__stoa_prompt_start() {
	builtin printf '\e]633;A\a'
}

__stoa_prompt_end() {
	builtin printf '\e]633;B\a'
}

__stoa_update_cwd() {
	builtin printf '\e]633;P;Cwd=%s\a' "$(__stoa_escape_value "${PWD}")"
}

__stoa_command_output_start() {
	builtin printf '\e]633;E;%s;%s\a' "$(__stoa_escape_value "${__stoa_current_command}")" "$__stoa_nonce"
	builtin printf '\e]633;C\a'
}

__stoa_continuation_start() {
	builtin printf '\e]633;F\a'
}

__stoa_continuation_end() {
	builtin printf '\e]633;G\a'
}

__stoa_right_prompt_start() {
	builtin printf '\e]633;H\a'
}

__stoa_right_prompt_end() {
	builtin printf '\e]633;I\a'
}

__stoa_command_complete() {
	if [[ "$__stoa_current_command" == "" ]]; then
		builtin printf '\e]633;D\a'
	else
		builtin printf '\e]633;D;%s\a' "$__stoa_status"
	fi
	__stoa_update_cwd
}

if [[ -o NOUNSET ]]; then
	if [ -z "${RPROMPT-}" ]; then
		RPROMPT=""
	fi
fi

__stoa_update_prompt() {
	__stoa_prior_prompt="$PS1"
	__stoa_prior_prompt2="$PS2"
	__stoa_in_command_execution=""
	PS1="%{$(__stoa_prompt_start)%}$PS1%{$(__stoa_prompt_end)%}"
	PS2="%{$(__stoa_continuation_start)%}$PS2%{$(__stoa_continuation_end)%}"
	if [ -n "$RPROMPT" ]; then
		__stoa_prior_rprompt="$RPROMPT"
		RPROMPT="%{$(__stoa_right_prompt_start)%}$RPROMPT%{$(__stoa_right_prompt_end)%}"
	fi
}

__stoa_precmd() {
	builtin local __stoa_status="$?"
	if [ -z "${__stoa_in_command_execution-}" ]; then
		__stoa_command_output_start
	fi

	__stoa_command_complete "$__stoa_status"
	__stoa_current_command=""

	# in command execution
	if [ -n "$__stoa_in_command_execution" ]; then
		__stoa_update_prompt
	fi
}

__stoa_preexec() {
	PS1="$__stoa_prior_prompt"
	PS2="$__stoa_prior_prompt2"
	if [ -n "$RPROMPT" ]; then
		RPROMPT="$__stoa_prior_rprompt"
	fi
	__stoa_in_command_execution="1"
	__stoa_current_command=$1
	__stoa_command_output_start
}
add-zsh-hook precmd __stoa_precmd
add-zsh-hook preexec __stoa_preexec

# Restore ZDOTDIR to the user's original at the end for non-login shells
if [[ $options[login] = off ]]; then
	ZDOTDIR="${USER_ZDOTDIR}"
fi
