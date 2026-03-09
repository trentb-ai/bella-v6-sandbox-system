traceLog.push("Gemini Consultative V2: Starting");
              const consultativePayload = {
                businessName: businessName || "Unknown Business",
                industry: industry || "business",
                industryNiche: industryNiche || null,
                location: location || quickLocation || "Australia",
                yearsInBusiness: yearsInBusiness || null,
                description: description || null,
                targetAudience: targetAudience || "clients",
                salesTerm: salesTerm || "appointments",
                businessModel: businessModel || "B2B",
                google: {
                  rating: googlePlacesData?.rating || null,
                  reviewCount: googlePlacesData?.reviewCount || 0,
                  ownerResponseRate: googlePlacesData?.ownerResponseRate || null,
                  openingHours: googlePlacesData?.openingHours?.weekdayText || [],
                  businessStatus: googlePlacesData?.businessStatus || null,
                },
                competitors: competitorData?.competitors?.slice(0, 10).map(c => ({
                  name: c.name, rating: c.rating, reviewCount: c.reviewCount, vicinity: c.vicinity
                })) || [],
                competitorAvgRating: competitorData?.avgRating || null,
                reviews: googlePlacesData?.reviews?.map(r => ({
                  rating: r.rating, text: r.text || "", time: r.relative_time_description
                })) || [],
                facebookAds: {
                  isRunning: facebookAdData?.isRunningAds || false,
                  adCount: facebookAdData?.adCount || 0,
                  ctas: facebookAdData?.ctas || [],
                  creatives: facebookAdData?.creatives || [],
                },
                googleAds: {
                  isRunning: googleAdsTransparencyData?.isRunningGoogleAds || false,
                  adCount: googleAdsTransparencyData?.adCount || 0,
                  headlines: googleAdsTransparencyData?.headlines || [],
                  ad_urls: googleAdsTransparencyData?.ad_urls || [],
                },
                campaignAnalysis: campaignAnalysis || null,
                techStack: {
                  hasCRM: hasCRMDetected || false,
                  hasChatWidget: hasChatDetected || false,
                  hasBookingSystem: hasBookingSystem || false,
                  hasVoiceAI: hasVoiceAIDetected || false,
                  techCount: builtWithData?.techCount || 0,
                  missingTech: builtWithData?.missingTech || [],
                },
                landingPage: {
                  hasAboveFoldCTA: landingPageAudit?.hasAboveFoldCTA || false,
                  formFieldCount: landingPageAudit?.formFieldCount || 0,
                  mobileOptimized: landingPageAudit?.mobileOptimized || false,
                  testimonialCount: landingPageAudit?.testimonialCount || 0,
                  trustBadgeCount: landingPageAudit?.trustBadgeCount || 0,
                  hasVideo: landingPageAudit?.hasVideo || false,
                  hasLiveChat: landingPageAudit?.hasLiveChat || false,
                  hasClickToCall: landingPageAudit?.hasClickToCall || false,
                  score: landingPageAudit?.score || 0,
                },
                aiExtracted: geminiBusinessExtract || {},
                scraped: {
                  services: services || [],
                  benefits: benefits || [],
                  features: features || [],
                  painPoints: painPoints || [],
                  ctas: ctas || [],
                  testimonials: testimonials?.slice(0, 3) || [],
                  certifications: certifications || [],
                  socialMedia: socialMedia || {},
                  valuePropositions: finalValueProps || [],
                },
                branding: {
                  tagline: tagline || mainHeadline || null,
                  heroH1: mainHeadline || null,
                },
                websiteContent: cleanBlob?.substring(0, 25000) || "",
                grades: {
                  speedToLead: grades.speedToLead,
                  reputation: grades.reputation,
                  websiteConversion: grades.websiteConversion,
                  techStack: grades.techStack,
                  adEfficiency: grades.adEfficiency,
                  overall: grades.overall,
                },
                hiring: hiringSignals ? {
                  isHiring: hiringSignals.isHiring || false,
                  roles: hiringSignals.hiringRoles?.map(r => r.title) || [],
                } : null,
                contact: {
                  phone: phone || null,
                  email: email || null,
                  address: address || null,
                  businessHours: businessHours || null,
                },
              };
              const consultativePrompt = `You are Bella's intelligence analyst at Pillar & Post Digital. Your job is to analyze REAL DATA and give Bella specific, evidence-based talking points she can use naturally in voice conversation.

You are NOT selling agents. You are NOT a sales strategist. You are a DATA ANALYST who finds the most interesting, specific, impressive things about this business so Bella sounds like she has done 3 hours of genuine research in 30 seconds.

CRITICAL RULES:
- ONLY reference data you can see in the payload below. If a field is null, empty, or 0 — output null for that item. Do NOT invent data.
- Use the business's own language (their targetAudience word, their salesTerm, their industry terms)
- Name REAL competitors from the data. Do NOT fabricate competitor names.
- Every insight must be traceable to a specific data point
- Write bellaLines as natural spoken sentences — no templates, no bullet points, no corporate speak
- Bella is Australian, warm, confident — she sounds like a smart friend, not a salesperson

## PROSPECT DATA
${JSON.stringify(consultativePayload, null, 2)}

## OUTPUT — VALID JSON ONLY

{
  "websiteCompliments": [
    {
      "what": "Something genuinely specific and impressive about their website — not generic praise",
      "evidence": "The exact data point — quote the text, name the feature, cite the number",
      "bellaLine": "A natural sentence Bella can say on the call"
    },
    {
      "what": "A second different thing that stands out — could be design, content, messaging, structure",
      "evidence": "Specific evidence from the data",
      "bellaLine": "Natural spoken sentence"
    }
  ],

  "mostImpressive": [
    {
      "finding": "The single most notable thing about this business from ALL the data",
      "source": "Where you found it — reviews, website content, Google Places, LinkedIn, ads",
      "bellaLine": "How Bella naturally references it"
    },
    {
      "finding": "Second most impressive finding — different category from the first",
      "source": "Data source",
      "bellaLine": "Natural reference"
    }
  ],

  "googlePresence": [
    {
      "insight": "Their rating and review standing — compare to named competitors if available",
      "data": "Exact numbers: X stars, Y reviews vs CompetitorName at Z stars",
      "bellaLine": "How Bella references this naturally"
    },
    {
      "insight": "What their reviews reveal — the theme, sentiment, what customers love or complain about",
      "bestQuote": "Direct quote from their most powerful review, or null if no reviews",
      "bellaLine": "How Bella can reference review sentiment naturally"
    }
  ],

  "competitiveEdge": [
    {
      "angle": "Where this business beats named competitors — use real names and real data only",
      "evidence": "Specific comparison data points",
      "bellaLine": "Positive framing Bella can use"
    },
    {
      "angle": "Where named competitors have an advantage — a gap or vulnerability to explore",
      "evidence": "Specific data showing the gap",
      "bellaLine": "How Bella probes this diplomatically without being negative"
    }
  ],

  "conversationHooks": [
    {
      "topic": "A specific data-backed topic Bella can raise naturally in conversation",
      "data": "The supporting evidence from the payload",
      "how": "How to bring it up — a question or observation"
    },
    {
      "topic": "Second hook — different angle",
      "data": "Evidence",
      "how": "Approach"
    },
    {
      "topic": "Third hook — could be hiring, social media, case studies, network, anything notable",
      "data": "Evidence",
      "how": "Approach"
    }
  ],

  "redFlags": [
    {
      "issue": "Specific problem with evidence — e.g. 'No after-hours availability (closes 5pm Mon-Fri)'",
      "evidence": "The data point that proves it",
      "bellaProbe": "How Bella can raise this as a question, not an accusation"
    },
    {
      "issue": "Second red flag — different category",
      "evidence": "Supporting data",
      "bellaProbe": "Diplomatic probe question"
    }
  ],

  "socialMediaPresence": {
    "channels": ["List of platforms found with URLs if available from the data"],
    "insight": "What their social presence says — active? dormant? professional? Which channels?",
    "bellaLine": "How Bella references their social presence naturally"
  },

  "landingPageVerdict": {
    "heroEffectiveness": "Is their H1/hero actually compelling? Quote it exactly and assess honestly — would it make YOU stop scrolling?",
    "ctaClarity": "What are they asking visitors to do? Are the CTAs clear and compelling, or buried/confusing?",
    "conversionBarriers": ["Specific things stopping visitors from converting — cite data like form field count, missing trust signals, no chat"],
    "trustSignals": "What builds credibility on their site vs what is missing? Cite testimonial count, trust badges, certifications",
    "mobileExperience": "Mobile optimized? Based on the audit data, what is the mobile experience like?",
    "verdictLine": "One punchy sentence summarizing the landing page quality that Bella can quote naturally on a call",
    "verdictLine2": "A second angle on the landing page — different observation from the first verdict"
  }
}`;
              const geminiConsultativeUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`;
              const consultativeResponse = await fetch(geminiConsultativeUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: consultativePrompt }] }],
                  generationConfig: {
                    temperature: 0.4,
                    maxOutputTokens: 8000
                  }
                })
              });
              if (consultativeResponse.ok) {
                const consultativeResult = await consultativeResponse.json();
                const consultativeText = consultativeResult?.candidates?.[0]?.content?.parts?.[0]?.text || "";
                const jsonMatch = consultativeText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  geminiConsultative = JSON.parse(jsonMatch[0]);
                  traceLog.push("Gemini Consultative V2: Success");
                } else {
                  traceLog.push("Gemini Consultative V2: No valid JSON in response");
                }
              } else {
                traceLog.push(`Gemini Consultative V2: HTTP ${consultativeResponse.status}`);
              }
            } catch (e) {
              traceLog.push(`Gemini Consultative V2: Error - ${e.message}`);
            }
