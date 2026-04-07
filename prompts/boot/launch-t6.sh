#!/bin/zsh
printf '\e]0;T6 Sentinel\a'
cd "/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM"
exec claude --model claude-haiku-4-5-20251001 --dangerously-skip-permissions --dangerously-load-development-channels server:claude-peers --append-system-prompt "$(cat '/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/prompts/boot/t6-prompt.txt')" --name 'T6 Sentinel'
