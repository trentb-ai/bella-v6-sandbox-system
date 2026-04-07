#!/bin/zsh
printf '\e]0;T8 PM\a'
cd "/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM"
exec claude --model claude-sonnet-4-6 --dangerously-skip-permissions --dangerously-load-development-channels server:claude-peers --append-system-prompt "$(cat '/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/prompts/boot/t8-prompt.txt')" --name 'T8 PM'
