#!/bin/bash
# V1 RESCRIPT — Surgical changes to remove ROI, update stage machine

cd ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/deepgram-bridge-v11/src

echo "📝 Applying V1 rescript changes..."

# 1. Remove anchor_acv and anchor_timeframe gates
sed -i '' '/case "anchor_acv": return i.acv/d' index.ts
sed -i '' '/case "anchor_timeframe": return i.timeframe/d' index.ts

# 2. Remove roi_delivery gate
sed -i '' '/case "roi_delivery": return s.stall/d' index.ts

# 3. Update advance() function - remove anchor_acv transition
sed -i '' 's/if (s.stage === "wow") s.stage = "anchor_acv";/if (s.stage === "wow") s.stage = s.queue.shift() ?? "close";/' index.ts
sed -i '' 's/else if (s.stage === "deep_dive") s.stage = "anchor_acv";/else if (s.stage === "deep_dive") s.stage = s.queue.shift() ?? "close";/' index.ts

# 4. Remove anchor_acv and anchor_timeframe from advance chain
sed -i '' '/else if (s.stage === "anchor_acv")/d' index.ts

# 5. Update channel advance target from roi_delivery to close
sed -i '' 's/s.queue.shift() ?? "roi_delivery"/s.queue.shift() ?? "close"/g' index.ts

# 6. Remove roi_delivery → close transition
sed -i '' '/else if (s.stage === "roi_delivery") s.stage = "close";/d' index.ts

# 7. Update just_demo target from roi_delivery to close
sed -i '' 's/s.stage = "roi_delivery";/s.stage = "close";/g' index.ts

# 8. Update just_demo condition to work without anchor_timeframe
sed -i '' 's/s.stage === "anchor_timeframe" ||//' index.ts

echo "✅ Stage machine updated"

echo "🧮 Next: Remove calculator functions (manual edit required)"
echo "🎭 Next: Wire BELLA_SCRIPT into stage directives (manual edit required)"
