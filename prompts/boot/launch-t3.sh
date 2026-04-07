#!/bin/zsh
printf '\e]0;T3 Codex Judge\a'
cd "/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM"
exec claude --model claude-sonnet-4-6 --dangerously-load-development-channels server:claude-peers --append-system-prompt "$(cat '/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/prompts/boot/t3-prompt.txt')" --name 'T3 Codex Judge'
