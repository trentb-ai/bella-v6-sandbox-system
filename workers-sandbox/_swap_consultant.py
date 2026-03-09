import sys

filepath = "/Users/trentbelasco/Desktop/BELLA_V3_SANDBOX_COMPLETE_SYSTEM/workers-sandbox/sandbox_personalisedaidemofinal.js"

with open(filepath, 'r') as f:
    content = f.read()

old_start = 'traceLog.push("Gemini Consultative: Starting");'
old_end = 'traceLog.push(`Gemini Consultative: Error - ${e.message}`);\n            }'

start_idx = content.find(old_start)
end_idx = content.find(old_end) + len(old_end)

if start_idx == -1 or end_idx == -1:
    print("ERROR: boundaries not found")
    sys.exit(1)

