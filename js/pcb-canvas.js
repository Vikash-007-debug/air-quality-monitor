/**
 * ==========================================================================
 * AEROMONITOR - INTERACTIVE PCB CIRCUIT TRACE ENGINE
 * Clean, static silver wire paths that interactively illuminate and highlight
 * under the cursor. ZERO moving current / pulses.
 * Supports dynamic Emergency Blood Red mode.
 * ==========================================================================
 */

(function () {
    let canvas, ctx;
    let width, height;
    let traces = [];
    let mouse = { x: -1000, y: -1000, radius: 150 };
    let isMouseActive = false;
    let needsRedraw = true;

    function init() {
        canvas = document.getElementById('pcbCircuitCanvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'pcbCircuitCanvas';
            canvas.className = 'pcb-circuit-canvas';
            document.body.prepend(canvas);
        }

        ctx = canvas.getContext('2d');
        resize();
        window.addEventListener('resize', debounceResize);

        window.addEventListener('mousemove', (e) => {
            mouse.x = e.clientX;
            mouse.y = e.clientY;
            isMouseActive = true;
            needsRedraw = true;
        });

        window.addEventListener('mouseleave', () => {
            mouse.x = -1000;
            mouse.y = -1000;
            isMouseActive = false;
            needsRedraw = true;
        });

        window.addEventListener('touchmove', (e) => {
            if (e.touches && e.touches.length > 0) {
                mouse.x = e.touches[0].clientX;
                mouse.y = e.touches[0].clientY;
                isMouseActive = true;
                needsRedraw = true;
            }
        }, { passive: true });

        window.addEventListener('touchstart', (e) => {
            if (e.touches && e.touches.length > 0) {
                mouse.x = e.touches[0].clientX;
                mouse.y = e.touches[0].clientY;
                isMouseActive = true;
                needsRedraw = true;
            }
        }, { passive: true });

        window.addEventListener('touchend', () => {
            mouse.x = -1000;
            mouse.y = -1000;
            isMouseActive = false;
            needsRedraw = true;
        }, { passive: true });

        generateCircuitLayout();
        render();
    }

    let resizeTimer;
    function debounceResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            resize();
            generateCircuitLayout();
            needsRedraw = true;
        }, 150);
    }

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }

    function generateCircuitLayout() {
        traces = [];

        const gridSize = 70;
        const cols = Math.ceil(width / gridSize) + 1;
        const rows = Math.ceil(height / gridSize) + 1;
        const numTraces = Math.min(55, Math.floor((cols * rows) / 3.5));

        for (let i = 0; i < numTraces; i++) {
            const startCol = Math.floor(Math.random() * cols);
            const startRow = Math.floor(Math.random() * rows);

            let curX = startCol * gridSize + (Math.random() > 0.5 ? 15 : 35);
            let curY = startRow * gridSize + (Math.random() > 0.5 ? 15 : 35);

            const points = [{ x: curX, y: curY }];
            const segments = Math.floor(Math.random() * 4) + 2;

            for (let s = 0; s < segments; s++) {
                const dir = Math.floor(Math.random() * 4);
                const len = (Math.floor(Math.random() * 2) + 1) * gridSize;

                if (dir === 0) { // Horizontal
                    curX += Math.random() > 0.5 ? len : -len;
                } else if (dir === 1) { // Vertical
                    curY += Math.random() > 0.5 ? len : -len;
                } else if (dir === 2) { // 45-deg diagonal
                    const dLen = len * 0.707;
                    curX += Math.random() > 0.5 ? dLen : -dLen;
                    curY += Math.random() > 0.5 ? dLen : -dLen;
                } else { // 45-deg bend
                    const bend = 20;
                    curX += Math.random() > 0.5 ? bend : -bend;
                    curY += Math.random() > 0.5 ? bend : -bend;
                    points.push({ x: curX, y: curY });
                    curX += Math.random() > 0.5 ? len : -len;
                }

                curX = Math.max(-30, Math.min(width + 30, curX));
                curY = Math.max(-30, Math.min(height + 30, curY));
                points.push({ x: curX, y: curY });
            }

            traces.push({
                points: points,
                hasViaStart: Math.random() > 0.35,
                hasViaEnd: Math.random() > 0.35,
                hasPad: Math.random() > 0.55
            });
        }
    }

    function distanceToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));

        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const nearX = x1 + t * dx;
        const nearY = y1 + t * dy;
        return Math.sqrt((px - nearX) * (px - nearX) + (py - nearY) * (py - nearY));
    }

    let lastEmergencyState = false;

    function render() {
        const isEmergency = document.body.classList.contains('emergency-mode');
        if (isEmergency !== lastEmergencyState) {
            lastEmergencyState = isEmergency;
            needsRedraw = true;
        }

        if (needsRedraw) {
            drawScene(isEmergency);
            needsRedraw = false;
        }
        requestAnimationFrame(render);
    }

    window.refreshPcbCanvas = function() {
        needsRedraw = true;
    };

    function drawScene(isEmergency) {
        if (typeof isEmergency === 'undefined') {
            isEmergency = document.body.classList.contains('emergency-mode');
        }
        ctx.clearRect(0, 0, width, height);

        const baseTraceColor = isEmergency ? 'rgba(255, 23, 68, 0.12)' : 'rgba(226, 232, 240, 0.08)';
        const baseViaColor = isEmergency ? 'rgba(255, 23, 68, 0.30)' : 'rgba(226, 232, 240, 0.20)';

        traces.forEach(trace => {
            const pts = trace.points;
            if (pts.length < 2) return;

            // Find closest distance from cursor to any segment of this trace
            let minDistance = 9999;
            for (let i = 0; i < pts.length - 1; i++) {
                const dist = distanceToSegment(mouse.x, mouse.y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
                if (dist < minDistance) minDistance = dist;
            }

            let highlightFactor = 0;
            if (minDistance < mouse.radius) {
                highlightFactor = 1 - (minDistance / mouse.radius);
                highlightFactor = Math.pow(highlightFactor, 1.8); // Smooth falloff curve
            }

            // Draw Wire Path
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, pts[i].y);
            }

            if (highlightFactor > 0.02) {
                if (isEmergency) {
                    ctx.strokeStyle = `rgba(255, 23, 68, ${0.15 + highlightFactor * 0.7})`;
                    ctx.lineWidth = 1.1 + highlightFactor * 1.5;
                    ctx.shadowBlur = 12 * highlightFactor;
                    ctx.shadowColor = 'rgba(255, 23, 68, 0.85)';
                } else {
                    ctx.strokeStyle = `rgba(255, 255, 255, ${0.12 + highlightFactor * 0.55})`;
                    ctx.lineWidth = 1.1 + highlightFactor * 1.4;
                    ctx.shadowBlur = 10 * highlightFactor;
                    ctx.shadowColor = 'rgba(255, 255, 255, 0.65)';
                }
            } else {
                ctx.strokeStyle = baseTraceColor;
                ctx.lineWidth = 1.0;
                ctx.shadowBlur = 0;
            }

            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
            ctx.shadowBlur = 0; // Reset shadow

            // Draw Contact Via Pads
            if (trace.hasViaStart) drawVia(pts[0].x, pts[0].y, baseViaColor, highlightFactor, isEmergency);
            if (trace.hasViaEnd) drawVia(pts[pts.length - 1].x, pts[pts.length - 1].y, baseViaColor, highlightFactor, isEmergency);

            // Draw SMT Test Pads
            if (trace.hasPad && pts.length > 2) {
                const mid = pts[1];
                ctx.fillStyle = highlightFactor > 0.1 
                    ? (isEmergency ? 'rgba(255, 23, 68, 0.8)' : 'rgba(255, 255, 255, 0.7)') 
                    : baseViaColor;
                ctx.fillRect(mid.x - 3.5, mid.y - 2.5, 7, 5);
            }
        });
    }

    function drawVia(x, y, baseColor, highlightFactor, isEmergency) {
        const dx = x - mouse.x;
        const dy = y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        let viaHighlight = 0;
        if (dist < mouse.radius) {
            viaHighlight = Math.pow(1 - (dist / mouse.radius), 1.5);
        }

        const isHighlighted = viaHighlight > 0.05 || highlightFactor > 0.1;
        const outerR = isHighlighted ? 4.2 : 3.4;

        ctx.beginPath();
        ctx.arc(x, y, outerR, 0, Math.PI * 2);
        ctx.fillStyle = '#07070a';
        ctx.fill();

        ctx.lineWidth = isHighlighted ? 1.6 : 1.2;
        if (isHighlighted) {
            ctx.strokeStyle = isEmergency ? '#ff1744' : '#ffffff';
            ctx.shadowBlur = 8;
            ctx.shadowColor = isEmergency ? 'rgba(255, 23, 68, 0.9)' : 'rgba(255, 255, 255, 0.8)';
        } else {
            ctx.strokeStyle = baseColor;
            ctx.shadowBlur = 0;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Inner copper hole
        ctx.beginPath();
        ctx.arc(x, y, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = isHighlighted ? (isEmergency ? '#ff8095' : '#ffffff') : 'rgba(226, 232, 240, 0.4)';
        ctx.fill();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
