// Logo definitions and animations
const LOGOS = {
    trace: {
        svg: `<svg class="option-logo trace-logo" viewBox="0 0 200 200" width="80" height="80">
            <defs>
                <style>
                    .cls-1 { stroke: #a971fb; }
                    .cls-2 { stroke: orange; }
                    .cls-3 { stroke: #fa9570; }
                    .cls-1, .cls-2, .cls-3 {
                        fill: none;
                        stroke-linecap: round;
                        stroke-linejoin: round;
                        stroke-width: 6px;
                    }
                </style>
            </defs>
            <polygon class="cls-1" points="100,10 180,170 20,170"/>
            <polygon class="cls-3" points="100,51.8 155,170 45,170"/>
            <polygon class="cls-2" points="100,79.1 138.2,170 61.8,170"/>
            <line class="cls-1" x1="100" y1="10" x2="20" y2="170"/>
            <line class="cls-3" x1="100" y1="51.8" x2="45" y2="170"/>
            <line class="cls-2" x1="100" y1="79.1" x2="61.8" y2="170"/>
        </svg>`,
        css: `
            @keyframes traceTriangleScale {
                0%, 100% { transform: scale(1); }
                40% { transform: scale(1.15); }
                60% { transform: scale(1.15); }
                80% { transform: scale(1); }
            }

            .trace-logo .cls-1,
            .trace-logo .cls-2,
            .trace-logo .cls-3 {
                transform-origin: center;
                transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }

            .menu-option:hover .trace-logo .cls-1 {
                animation: traceTriangleScale 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
            }
            .menu-option:hover .trace-logo .cls-3 {
                animation: traceTriangleScale 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite 0.6s;
            }
            .menu-option:hover .trace-logo .cls-2 {
                animation: traceTriangleScale 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite 1.2s;
            }

            .menu-option:not(:hover) .trace-logo .cls-1,
            .menu-option:not(:hover) .trace-logo .cls-2,
            .menu-option:not(:hover) .trace-logo .cls-3 {
                animation: none;
                transform: scale(1);
            }`
    },
    evolve: {
        svg: `<svg class="option-logo evolve-logo" viewBox="0 0 200 200" width="80" height="80">
            <defs>
                <style>
                    .cls-1 { stroke: #a971fb; }
                    .cls-2 { stroke: orange; }
                    .cls-3 { stroke: #fa9570; }
                    .cls-1, .cls-2, .cls-3 {
                        fill: none;
                        stroke-linecap: round;
                        stroke-linejoin: round;
                        stroke-width: 6px;
                    }
                </style>
            </defs>
            <g class="rotating-group">
                <polygon class="cls-2" points="100,40 160,140 40,140"/>
                <polygon class="cls-2" points="100,40 160,140 40,140" transform="rotate(120 100 90)"/>
                <polygon class="cls-2" points="100,40 160,140 40,140" transform="rotate(240 100 90)"/>
            </g>
            <path class="cls-1" d="M160,140 A80,80 0 0,1 40,140" fill="none"/>
            <line class="cls-3" x1="100" y1="40" x2="100" y2="140"/>
        </svg>`,
        css: `
            @keyframes evolveRotate {
                0% { transform: rotate(0deg); opacity: 0.6; }
                50% { transform: rotate(180deg); opacity: 1; }
                100% { transform: rotate(360deg); opacity: 0.6; }
            }

            .evolve-logo .rotating-group {
                transform-origin: center;
                transform: rotate(0deg);
                opacity: 0.6;
                transition: transform 0.3s ease, opacity 0.3s ease;
            }

            .menu-option:hover .evolve-logo .rotating-group {
                animation: evolveRotate 6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
            }

            .menu-option:not(:hover) .evolve-logo .rotating-group {
                animation: none;
                transform: rotate(0deg);
                opacity: 0.6;
            }`
    },
    forge: {
        svg: `<svg class="option-logo forge-logo" viewBox="0 0 200 200" width="80" height="80">
            <defs>
                <style>
                    .cls-1 { stroke: #a971fb; }
                    .cls-2 { stroke: #fa9570; }
                    .cls-3 { stroke: orange; }
                    .cls-1, .cls-2, .cls-3 {
                        fill: none;
                        stroke-linecap: round;
                        stroke-linejoin: round;
                        stroke-width: 6px;
                    }
                </style>
            </defs>
            <polygon class="cls-2" points="100,40 170,140 30,140"/>
            <line class="cls-1" x1="100" y1="40" x2="65" y2="140"/>
            <line class="cls-1" x1="100" y1="40" x2="135" y2="140"/>
            <line class="cls-3" x1="65" y1="140" x2="135" y2="140"/>
            <line class="cls-3" x1="100" y1="70" x2="100" y2="110"/>
        </svg>`,
        css: `
            @keyframes forgePress {
                0% { transform: scaleY(1) translateY(0); }
                15% { transform: scaleY(0.85) translateY(12px); }
                35% { transform: scaleY(1.08) translateY(-3px); }
                50% { transform: scaleY(0.95) translateY(3px); }
                65% { transform: scaleY(1) translateY(0); }
                100% { transform: scaleY(1) translateY(0); }
            }

            @keyframes forgeStructure {
                0% { transform: scaleY(1); opacity: 0.8; }
                15% { transform: scaleY(1.05); opacity: 1; }
                35% { transform: scaleY(0.95); opacity: 0.9; }
                50% { transform: scaleY(1.02); opacity: 0.95; }
                65% { transform: scaleY(1); opacity: 1; }
                100% { transform: scaleY(1); opacity: 1; }
            }

            .forge-logo .cls-1,
            .forge-logo .cls-2,
            .forge-logo .cls-3 {
                opacity: 1;
                transform-origin: bottom;
                transition: all 0.5s cubic-bezier(0.7, 0, 0.3, 1);
            }

            .menu-option:hover .forge-logo .cls-2 {
                animation: forgePress 2.5s cubic-bezier(0.7, 0, 0.3, 1) infinite;
                filter: drop-shadow(0 0 2px var(--secondary-color));
            }

            .menu-option:hover .forge-logo .cls-1,
            .menu-option:hover .forge-logo .cls-3 {
                animation: forgeStructure 2.5s cubic-bezier(0.7, 0, 0.3, 1) infinite;
            }

            .menu-option:not(:hover) .forge-logo .cls-1,
            .menu-option:not(:hover) .forge-logo .cls-2,
            .menu-option:not(:hover) .forge-logo .cls-3 {
                animation: none;
                transform: scale(1);
                opacity: 1;
                filter: none;
            }`
    }
};

// Helper function to insert logo and its animations
function insertLogo(type, container) {
    if (!LOGOS[type]) {
        console.error(`Logo type "${type}" not found`);
        return;
    }

    // Insert SVG
    container.innerHTML = LOGOS[type].svg;
    
    // Add CSS if not already added
    if (!document.querySelector(`#${type}-logo-styles`)) {
        const style = document.createElement('style');
        style.id = `${type}-logo-styles`;
        style.textContent = LOGOS[type].css;
        document.head.appendChild(style);
    }
}

export { LOGOS, insertLogo };
