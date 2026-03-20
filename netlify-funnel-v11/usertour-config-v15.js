/**
 * UserTour Config & Engine (V15 Hybrid)
 * MERGED:
 * 1. Introduction: Uses the "Voice Welcome Overlay" style from V13 (Dark overlay, pulsing avatar).
 * 2. Steps 2-6: "Informative" bubbles from V14 local config.
 * 3. Final Step: No "Finish" button. Spotlights the "Talk to Chris" button.
 */

window.usertour = (function () {
    let currentStep = 0;
    let tourActive = false;
    let overlay = null;
    let spotlight = null;
    let bubble = null;

    // ─── TOUR STEPS ───────────────────────────────────────────────────────────
    // Step 1 is the Welcome Modal (handled by createWelcomeModal).
    // Steps below are 2-6.
    const tourSteps = [
        // Step 2: Did You Know?
        {
            id: 'stat-box',
            title: 'Why This Agent Matters',
            content: 'This box highlights the market opportunity each agent presents. It gives you the key industry stats that prove exactly why your agent will drive more revenue for your business.',
            anchor: '#agent-chris .stat-box',
            spotlightTarget: '#agent-chris .stat-box',
            placement: 'right',
            yOffset: -140
        },
        // Step 3: Live Demo
        {
            id: 'demo-phone',
            title: 'Try It Yourself',
            content: 'Experience the power firsthand. Role play one of your own prospects to experience first hand how your human-sounding agent can qualify and schedule an appointment or other conversion event.',
            anchor: '#agent-chris .iphone-frame',
            spotlightTarget: '#agent-chris .iphone-frame',
            placement: 'left'
        },
        // Step 4: Calculator
        {
            id: 'calculator',
            title: 'See Your Profit Potential',
            content: 'The results speak for themselves. Plug in your own numbers here to see a conservative estimate of the new revenue each agent can generate for you every month.',
            anchor: '#agent-chris .agent-calculator',
            spotlightTarget: '#agent-chris .agent-calculator',
            placement: 'left'
        },
        // Step 5: CTAs — bubble ABOVE the buttons
        {
            id: 'ctas',
            title: 'Take Action',
            content: 'Demo hit the mark? Launch your 7-day agent team for free and let results speak for themselves (quick onboarding form, no card required). Or book your bespoke planning session to define the plan before your trial.',
            anchor: '#agent-chris .agent-ctas',
            spotlightTarget: '#agent-chris .agent-ctas',
            placement: 'top',
            scrollBlock: 'nearest'
        },
        // Step 6: Chris Concierge (Final) -> NO FINISH BUTTON
        // Targets the REAL GHL widget (not a custom button)
        {
            id: 'ghl-widget',
            title: "I'm Here To Help",
            content: "Questions while you explore? Click the button below to talk to Chris. He'll explain exactly how we'll grow your business with AI.",
            useGHLWidget: true,
            placement: 'top',
            isLast: true,
            noFinishButton: true,
            spotlightPadding: 16
        }
    ];

    // ─── OVERLAY & SPOTLIGHT ──────────────────────────────────────────────────

    function createOverlay() {
        if (overlay) return;

        overlay = document.createElement('div');
        overlay.id = 'usertour-overlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0);
            z-index: 9998; opacity: 1;
            pointer-events: none;
        `;
        document.body.appendChild(overlay);

        spotlight = document.createElement('div');
        spotlight.id = 'usertour-spotlight';
        spotlight.style.cssText = `
            position: absolute; border-radius: 16px;
            box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.65);
            z-index: 9999; pointer-events: none;
            transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
            opacity: 0;
        `;
        document.body.appendChild(spotlight);
    }

    // GHL widget selectors — 'chat-widget' is the actual custom element tag
    const GHL_SELECTORS = [
        'chat-widget',
        'iframe[src*="leadconnector"]',
        '[id*="leadconnector"]',
        '[class*="leadconnector"]',
        'lc-chat-widget',
        '[data-widget-id]'
    ];

    function findGHLWidget() {
        for (const sel of GHL_SELECTORS) {
            const el = document.querySelector(sel);
            if (el) return el;
        }
        return null;
    }

    function updateSpotlight(step) {
        if (!spotlight) return;

        let el;

        if (step.useGHLWidget) {
            // Dynamically find the GHL widget
            el = findGHLWidget();
        } else {
            const target = step.spotlightTarget || step.anchor;
            el = document.querySelector(target);
        }

        if (!el) {
            spotlight.style.opacity = '0';
            return;
        }

        const rect = el.getBoundingClientRect();
        const scrollTop = window.scrollY;
        const scrollLeft = window.scrollX;
        const padding = step.spotlightPadding || 12;

        spotlight.style.width = (rect.width + padding * 2) + 'px';
        spotlight.style.height = (rect.height + padding * 2) + 'px';
        spotlight.style.top = (rect.top + scrollTop - padding) + 'px';
        spotlight.style.left = (rect.left + scrollLeft - padding) + 'px';

        const computedStyle = window.getComputedStyle(el);
        const radius = parseInt(computedStyle.borderRadius) || 0;
        spotlight.style.borderRadius = (radius + 6) + 'px';
        spotlight.style.opacity = '1';

        // Make the GHL widget clickable through the overlay
        if (step.useGHLWidget) {
            spotlight.style.pointerEvents = 'none';
            el.style.setProperty('z-index', '10003', 'important');
            el.style.setProperty('pointer-events', 'auto', 'important');

            // On click: close tour and scroll back to top so Chris greets them from the hero
            if (!el._tourClickWired) {
                el._tourClickWired = true;
                el.addEventListener('click', function onChrisClick() {
                    el._tourClickWired = false;
                    el.removeEventListener('click', onChrisClick);
                    closeTour();
                    setTimeout(() => {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }, 300); // slight delay so tour fade-out plays first
                }, { once: true });
            }
        }
    }

    // ─── TEXT BUBBLE ──────────────────────────────────────────────────────────

    function createBubble(step, index) {
        if (bubble) { bubble.remove(); bubble = null; }

        bubble = document.createElement('div');
        bubble.className = 'ut-bubble';

        const isLast = !!step.isLast;
        const isFirst = index === 0;

        // For the final step, we do NOT show a finish button.
        // We instruct the user to click the spotlighted element.
        let actionsHtml = '';
        if (step.noFinishButton) {
            // No buttons at all on final step — just text + spotlight on GHL widget
            actionsHtml = '';
        } else {
            actionsHtml = `
                <div style="display:flex;gap:8px;">
                    ${!isFirst ? `<button class="ut-btn ut-btn-prev" onclick="window.usertour.prev()">← Back</button>` : ''}
                    ${isLast
                    ? `<button class="ut-btn ut-btn-finish" onclick="window.usertour.close()">Finish ✓</button>`
                    : `<button class="ut-btn ut-btn-next" onclick="window.usertour.next()">Next →</button>`
                }
                </div>
            `;
        }

        bubble.innerHTML = `
            <style>
                .ut-bubble {
                    position: absolute;
                    z-index: 10001;
                    background: #ffffff;
                    border-radius: 16px;
                    box-shadow: 0 12px 48px rgba(0,0,0,0.22), 0 0 0 3px #1a6bff22;
                    padding: 22px 24px 18px;
                    max-width: 320px;
                    min-width: 260px;
                    font-family: 'Plus Jakarta Sans', 'Inter', sans-serif;
                    opacity: 0;
                    transform: translateY(8px);
                    animation: utBubbleFadeUp 0.4s ease forwards;
                    border-top: 4px solid #1a6bff;
                }
                .ut-bubble-step {
                    font-size: 11px;
                    font-weight: 700;
                    letter-spacing: 0.08em;
                    text-transform: uppercase;
                    color: #1a6bff;
                    margin-bottom: 6px;
                }
                .ut-bubble-title {
                    font-size: 17px;
                    font-weight: 800;
                    color: #111;
                    margin-bottom: 10px;
                    line-height: 1.3;
                }
                .ut-bubble-content {
                    font-size: 14px;
                    color: #444;
                    line-height: 1.65;
                    margin-bottom: 18px;
                }
                .ut-bubble-footer {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                }
                .ut-dots {
                    display: flex;
                    gap: 5px;
                    align-items: center;
                }
                .ut-dot {
                    width: 7px; height: 7px;
                    border-radius: 50%;
                    background: #ddd;
                    transition: background 0.2s;
                }
                .ut-dot.active { background: #1a6bff; }
                .ut-btn {
                    border: none;
                    border-radius: 50px;
                    padding: 9px 20px;
                    font-size: 13px;
                    font-weight: 700;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    font-family: inherit;
                }
                .ut-btn-prev {
                    background: #f0f0f0;
                    color: #555;
                }
                .ut-btn-prev:hover { background: #e0e0e0; }
                .ut-btn-next {
                    background: linear-gradient(135deg, #1a6bff, #0050e6);
                    color: white;
                    box-shadow: 0 4px 14px rgba(26,107,255,0.35);
                }
                .ut-btn-next:hover { transform: scale(1.04); box-shadow: 0 6px 20px rgba(26,107,255,0.45); }
                .ut-btn-finish {
                    background: linear-gradient(135deg, #F55200, #FF6B1A);
                    color: white;
                    box-shadow: 0 4px 14px rgba(245,82,0,0.35);
                }
                .ut-btn-finish:hover { transform: scale(1.04); }
                @keyframes utBubbleFadeUp {
                    from { opacity: 0; transform: translateY(8px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            </style>

            <div class="ut-bubble-step">Step ${index + 1} of ${tourSteps.length}</div>
            <div class="ut-bubble-title">${step.title}</div>
            <div class="ut-bubble-content">${step.content}</div>
            <div class="ut-bubble-footer">
                <div class="ut-dots">
                    ${tourSteps.map((_, i) => `<div class="ut-dot ${i === index ? 'active' : ''}"></div>`).join('')}
                </div>
                ${actionsHtml}
            </div>
        `;

        document.body.appendChild(bubble);
    }

    function positionBubble(step) {
        let anchor;
        if (step.useGHLWidget) {
            anchor = findGHLWidget();
        } else {
            anchor = document.querySelector(step.anchor);
        }
        if (!anchor || !bubble) return;

        const rect = anchor.getBoundingClientRect();
        const scrollY = window.scrollY;
        const scrollX = window.scrollX;
        const bW = bubble.offsetWidth || 300;
        const bH = bubble.offsetHeight || 200;
        const gap = 20;
        const yOff = step.yOffset || 0;

        let top, left;

        switch (step.placement) {
            case 'right':
                top = rect.top + scrollY + (rect.height / 2) - (bH / 2) + yOff;
                left = rect.right + scrollX + gap;
                break;
            case 'left':
                top = rect.top + scrollY + (rect.height / 2) - (bH / 2) + yOff;
                left = rect.left + scrollX - bW - gap;
                break;
            case 'bottom':
                top = rect.bottom + scrollY + gap + yOff;
                left = rect.left + scrollX + (rect.width / 2) - (bW / 2);
                break;
            case 'top':
            default:
                top = rect.top + scrollY - bH - gap + yOff;
                left = rect.left + scrollX + (rect.width / 2) - (bW / 2);
                break;
        }

        // Clamp to viewport
        const vw = window.innerWidth;
        if (left < 12) left = 12;
        if (left + bW > vw - 12) left = vw - bW - 12;
        if (top < scrollY + 12) top = scrollY + 12;

        bubble.style.top = top + 'px';
        bubble.style.left = left + 'px';
    }

    // ─── STEP LOGIC ───────────────────────────────────────────────────────────

    function showStep(index) {
        if (index < 0 || index >= tourSteps.length) return closeTour();

        currentStep = index;
        const step = tourSteps[index];

        if (!overlay) createOverlay();

        // Scroll target into view first (skip for fixed-position GHL widget)
        if (!step.useGHLWidget) {
            const scrollEl = document.querySelector(step.spotlightTarget || step.anchor);
            if (scrollEl) {
                scrollEl.scrollIntoView({ behavior: 'smooth', block: step.scrollBlock || 'center' });
            }
        }

        // Wait for scroll to settle, then render
        setTimeout(() => {
            updateSpotlight(step);
            createBubble(step, index);

            // Wait for bubble to render before positioning
            requestAnimationFrame(() => {
                requestAnimationFrame(() => positionBubble(step));
            });
        }, 550);
    }

    function closeTour() {
        if (bubble) { bubble.style.opacity = '0'; }
        if (spotlight) { spotlight.style.opacity = '0'; }

        setTimeout(() => {
            if (bubble) { bubble.remove(); bubble = null; }
            if (overlay) { overlay.remove(); overlay = null; }
            if (spotlight) { spotlight.remove(); spotlight = null; }
        }, 350);

        tourActive = false;
        localStorage.setItem('usertour_completed', 'true');
    }

    // ─── WELCOME MODAL (Hybrid V15: Uses V13 Visuals) ─────────────────────────
    // This replaces "Step 1" with the elegant dark overlay from V13.

    function createWelcomeModal() {
        const modal = document.createElement('div');
        modal.id = 'ut-welcome-modal';
        // V13 Style: Dark Backdrop, Blur, Flex Center
        modal.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.65);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            animation: fadeInOverlay 0.4s ease;
            font-family: 'Plus Jakarta Sans', 'Inter', sans-serif;
        `;

        modal.innerHTML = `
            <style>
                @keyframes fadeInOverlay { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideUpCard { from { opacity: 0; transform: translateY(40px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
                @keyframes popPulse {
                    0%, 100% { box-shadow: 0 0 0 12px rgba(0, 71, 255, 0.1), 0 0 0 24px rgba(0, 71, 255, 0.05); }
                    50% { box-shadow: 0 0 0 16px rgba(0, 71, 255, 0.15), 0 0 0 32px rgba(0, 71, 255, 0.07); }
                }
            </style>
            <div style="
                background: #fff;
                border-radius: 24px;
                padding: 44px 36px 32px;
                max-width: 440px;
                width: 100%;
                text-align: center;
                box-shadow: 0 32px 80px rgba(0,0,0,0.25);
                animation: slideUpCard 0.45s cubic-bezier(0.34,1.56,0.64,1);
                position: relative;
            ">
                <!-- Pulse avatar (V13 Style) -->
                <div style="
                    width: 80px; height: 80px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, #0047FF 0%, #00B2FF 100%);
                    margin: 0 auto 20px;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 36px;
                    box-shadow: 0 0 0 12px rgba(0,71,255,0.1), 0 0 0 24px rgba(0,71,255,0.05);
                    animation: popPulse 2s ease-in-out infinite;
                ">🎙️</div>

                <h2 style="font-size: 22px; font-weight: 700; color: #111827; margin: 0 0 10px; line-height: 1.3;">
                    Ready for your pre-trained<br>Voice AI experience?
                </h2>
                <p style="font-size: 15px; color: #6B7280; margin: 0 0 28px; line-height: 1.6;">
                    Chris is standing by — your AI concierge, trained on your business, ready to chat right now.
                </p>

                <!-- Action Button -->
                <button id="ut-take-tour-btn" style="
                    width: 100%;
                    padding: 16px 24px;
                    background: linear-gradient(135deg, #0047FF 0%, #00B2FF 100%);
                    border: none;
                    border-radius: 14px;
                    color: white;
                    font-size: 17px;
                    font-weight: 700;
                    cursor: pointer;
                    letter-spacing: -0.2px;
                    transition: transform 0.15s, box-shadow 0.15s;
                    box-shadow: 0 8px 24px rgba(0,71,255,0.35);
                ">
                    Take the Tour →
                </button>

            </div>
        `;

        document.body.appendChild(modal);

        const takeBtn = modal.querySelector('#ut-take-tour-btn');
        takeBtn.onmouseenter = () => { takeBtn.style.transform = 'scale(1.02)'; takeBtn.style.boxShadow = '0 12px 30px rgba(0,71,255,0.45)'; };
        takeBtn.onmouseleave = () => { takeBtn.style.transform = 'scale(1)'; takeBtn.style.boxShadow = '0 8px 24px rgba(0,71,255,0.35)'; };

        // Start Tour
        takeBtn.addEventListener('click', () => {
            modal.style.transition = 'opacity 0.4s ease';
            modal.style.opacity = '0';
            setTimeout(() => {
                modal.remove();
                tourActive = true;
                showStep(0);
            }, 400);
        });

        // Skip button removed per user request
    }

    // ─── PUBLIC API ───────────────────────────────────────────────────────────

    return {
        start: function () {
            console.log('UserTour V15: Starting (Hybrid Mode)');
            createWelcomeModal();
        },
        showStep: showStep,
        next: function () { showStep(currentStep + 1); },
        prev: function () { showStep(currentStep - 1); },
        close: closeTour,
        isActive: function () { return tourActive; }
    };

})();
