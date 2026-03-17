// NEW CONSULTANT PROMPT — "Bella's Intel Analyst"
// Replaces the old agent-selling consultant with a data analyst that gives Bella
// real, specific, evidence-based talking points from ALL available data.

const consultativePayload = {
  // === BUSINESS PROFILE ===
  businessName: businessName || "Unknown Business",
  industry: industry || "business",
  industryNiche: industryNiche || null,
  location: location || quickLocation || "Australia",
  yearsInBusiness: yearsInBusiness || null,
  description: description || null,
  targetAudience: targetAudience || "clients",
  salesTerm: salesTerm || "appointments",
  businessModel: businessModel || "B2B",

  // === GOOGLE PLACES (VERIFIED) ===
  google: {
    rating: googlePlacesData?.rating || null,
    reviewCount: googlePlacesData?.reviewCount || 0,
    ownerResponseRate: googlePlacesData?.ownerResponseRate || null,
    openingHours: googlePlacesData?.openingHours?.weekdayText || [],
    businessStatus: googlePlacesData?.businessStatus || null,
  },

  // === NAMED COMPETITORS ===
  competitors: competitorData?.competitors?.slice(0, 10).map(c => ({
    name: c.name, rating: c.rating, reviewCount: c.reviewCount, vicinity: c.vicinity
  })) || [],
  competitorAvgRating: competitorData?.avgRating || null,

  // === REVIEWS (FULL TEXT) ===
  reviews: googlePlacesData?.reviews?.map(r => ({
    rating: r.rating, text: r.text || "", time: r.relative_time_description
  })) || [],

  // === ADS ===
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

  // === TECH STACK ===
  techStack: {
    hasCRM: hasCRMDetected || false,
    hasChatWidget: hasChatDetected || false,
    hasBookingSystem: hasBookingSystem || false,
    hasVoiceAI: hasVoiceAIDetected || false,
    techCount: builtWithData?.techCount || 0,
    missingTech: builtWithData?.missingTech || [],
  },

  // === LANDING PAGE AUDIT (TECHNICAL) ===
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

  // === GEMINI BUSINESS EXTRACT (AI-EXTRACTED) ===
  aiExtracted: geminiBusinessExtract || {},

  // === SCRAPED CONTENT ===
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

  // === BRANDING ===
  branding: {
    tagline: tagline || mainHeadline || null,
    heroH1: mainHeadline || null,
    primaryColor: primaryColor || null,
  },

  // === WEBSITE CONTENT (THE FULL BLOB) ===
  websiteContent: cleanBlob?.substring(0, 25000) || "",

  // === GRADES ===
  grades: {
    speedToLead: grades.speedToLead,
    reputation: grades.reputation,
    websiteConversion: grades.websiteConversion,
    techStack: grades.techStack,
    adEfficiency: grades.adEfficiency,
    overall: grades.overall,
  },

  // === HIRING SIGNALS ===
  hiring: hiringSignals ? {
    isHiring: hiringSignals.isHiring || false,
    roles: hiringSignals.hiringRoles?.map(r => r.title) || [],
  } : null,
};
