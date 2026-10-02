/**
 * ==========================================================================
 * AEROMONITOR - PCB CIRCUIT WIRE ANIMATION ENGINE
 * Renders an authentic matte circuit board with silver wire traces & live
 * electrical telemetry pulses. Supports dynamic Emergency Blood Red mode.
 * ==========================================================================
 */

(function () {
    let canvas, ctx;
    let width, height;
    let traces = [];
    let pulses = [];
    let animationFrameId = null;
    let mouse = { x: -1000, y: -1000, radius: 120 };

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
        });
        window.addEventListener('mouseleave', () => {
            mouse.x = -1000;
            mouse.y = -1000;
        });

        generateCircuitLayout();
        animate();
    }

    let resizeTimer;
    function debounceResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            resize();
            generateCircuitLayout();
        }, 150);
    }

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }

    function generateCircuitLayout() {
        traces = [];
        pulses = [];

        const gridSize = 80;
        const cols = Math.ceil(width / gridSize) + 1;
        const rows = Math.ceil(height / gridSize) + 1;

        // Generate PCB nodes and angled traces
        const numTraces = Math.min(48, Math.floor((cols * rows) / 4));

        for (let i = 0; i < numTraces; i++) {
            const startCol = Math.floor(Math.random() * cols);
            const startRow = Math.floor(Math.random() * rows);

            let curX = startCol * gridSize + (Math.random() > 0.5 ? 20 : 40);
            let curY = startRow * gridSize + (Math.random() > 0.5 ? 20 : 40);

            const points = [{ x: curX, y: curY }];
            const segments = Math.floor(Math.random() * 4) + 2;

            for (let s = 0; s < segments; s++) {
                const dir = Math.floor(Math.random() * 4);
                const len = (Math.floor(Math.random() * 3) + 1) * gridSize;

                if (dir === 0) { // Horizontal
                    curX += Math.random() > 0.5 ? len : -len;
                } else if (dir === 1) { // Vertical
                    curY += Math.random() > 0.5 ? len : -len;
                } else if (dir === 2) { // 45-deg diagonal
                    const dLen = len * 0.707;
                    curX += Math.random() > 0.5 ? dLen : -dLen;
                    curY += Math.random() > 0.5 ? dLen : -dLen;
                } else { // 45-deg bend then straight
                    const bendLen = 25;
                    const dX = Math.random() > 0.5 ? bendLen : -bendLen;
                    const dY = Math.random() > 0.5 ? bendLen : -bendLen;
                    curX += dX;
                    curY += dY;
                    points.push({ x: curX, y: curY });
                    curX += dX > 0 ? len : -len;
                }

                // Clamp to screen bounds + padding
                curX = Math.max(-40, Math.min(width + 40, curX));
                curY = Math.max(-40, Math.min(height + 40, curY));

                points.push({ x: curX, y: curY });
            }

            traces.push({
                points: points,
                hasViaStart: Math.random() > 0.3,
                hasViaEnd: Math.random() > 0.3,
                hasPad: Math.random() > 0.6
            });

            // Add electric signal pulse
            if (Math.random() > 0.25) {
                pulses.push({
                    traceIndex: i,
                    progress: Math.random(),
                    speed: 0.003 + Math.random() * 0.005,
                    length: 0.08 + Math.random() * 0.12
                });
            }
        }
    }

    function getInterpolatedPoint(points, t) {
        if (points.length < 2) return points[0] || { x: 0, y: 0 };

        // Calculate total length
        let totalLen = 0;
        const segmentLengths = [];
        for (let i = 0; i < points.length - 1; i++) {
            const dx = points[i + 1].x - points[i].x;
            const dy = points[i + 1].y - points[i].y;
            const len = Math.sqrt(dx * dx + dy * dy);
            segmentLengths.push(len);
            totalLen += len;
        }

        if (totalLen === 0) return points[0];

        let targetDist = t * totalLen;
        let accum = 0;

        for (let i = 0; i < segmentLengths.length; i++) {
            const len = segmentLengths[i];
            if (accum + len >= targetDist) {
                const segT = (targetDist - accum) / len;
                return {
                    x: points[i].x + (points[i + 1].x - points[i].x) * segT,
                    y: points[i].y + (points[i + 1].y - points[i].y) * segT
                };
            }
            accum += len;
        }

        return points[points.length - 1];
    }

    function animate() {
        const isEmergency = document.body.classList.contains('emergency-mode');

        ctx.clearRect(0, 0, width, height);

        // Trace styles
        const traceColor = isEmergency ? 'rgba(255, 23, 68, 0.12)' : 'rgba(226, 232, 240, 0.07)';
        const viaColor = isEmergency ? 'rgba(255, 23, 68, 0.45)' : 'rgba(226, 232, 240, 0.25)';
        const pulseColor = isEmergency ? '#ff1744' : '#38bdf8';
        const pulseGlow = isEmergency ? 'rgba(255, 23, 68, 0.85)' : 'rgba(56, 189, 248, 0.65)';

        // 1. Draw static traces & via pads
        traces.forEach(trace => {
            const pts = trace.points;
            if (pts.length < 2) return;

            // Check distance to mouse for interactive highlight
            let isHovered = false;
            for (let p of pts) {
                const dx = p.x - mouse.x;
                const dy = p.y - mouse.y;
                if (dx * dx + dy * dy < mouse.radius * mouse.radius) {
                    isHovered = true;
                    break;
                }
            }

            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, pts[i].y);
            }

            ctx.strokeStyle = isHovered 
                ? (isEmergency ? 'rgba(255, 23, 68, 0.45)' : 'rgba(255, 255, 255, 0.28)')
                : traceColor;
            ctx.lineWidth = isHovered ? 1.6 : 1.1;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();

            // Draw Via contact pads
            if (trace.hasViaStart) drawVia(pts[0].x, pts[0].y, viaColor, isHovered);
            if (trace.hasViaEnd) drawVia(pts[pts.length - 1].x, pts[pts.length - 1].y, viaColor, isHovered);

            // Draw SMT Test Pads
            if (trace.hasPad && pts.length > 2) {
                const mid = pts[1];
                ctx.fillStyle = viaColor;
                ctx.fillRect(mid.x - 3, mid.y - 2, 6, 4);
            }
        });

        // 2. Draw live electrical telemetry signal pulses
        pulses.forEach(pulse => {
            const trace = traces[pulse.traceIndex];
            if (!trace || trace.points.length < 2) return;

            pulse.progress += pulse.speed;
            if (pulse.progress > 1.0) {
                pulse.progress = 0;
            }

            const head = getInterpolatedPoint(trace.points, pulse.progress);
            const tailProgress = Math.max(0, pulse.progress - pulse.length);
            const tail = getInterpolatedPoint(trace.points, tailProgress);

            const grad = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
            grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
            grad.addColorStop(1, pulseColor);

            ctx.beginPath();
            ctx.moveTo(tail.x, tail.y);
            ctx.lineTo(head.x, head.y);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 2.2;
            ctx.stroke();

            // Glowing head particle
            ctx.shadowBlur = 10;
            ctx.shadowColor = pulseGlow;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(head.x, head.y, 2.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0; // Reset shadow
        });

        animationFrameId = requestAnimationFrame(animate);
    }

    function drawVia(x, y, strokeColor, isHovered) {
        ctx.beginPath();
        ctx.arc(x, y, isHovered ? 4.2 : 3.4, 0, Math.PI * 2);
        ctx.fillStyle = '#08080c';
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.3;
        ctx.stroke();

        // Inner copper via hole
        ctx.beginPath();
        ctx.arc(x, y, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = isHovered ? '#ffffff' : 'rgba(226, 232, 240, 0.45)';
        ctx.fill();
    }

    // Launch when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
