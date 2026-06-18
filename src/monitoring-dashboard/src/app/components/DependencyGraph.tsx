"use client";

import { useEffect, useRef } from "react";

interface GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  type: "safe" | "warning" | "critical";
  pulseOffset: number;
}

export function DependencyGraph({ light = false }: { light?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const fit = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    fit();
    window.addEventListener("resize", fit);

    const nodes: GraphNode[] = Array.from({ length: 44 }, (_, i) => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.22,
      r: Math.random() * 2.5 + 1.5,
      type: i < 3 ? "critical" : i < 10 ? "warning" : "safe",
      pulseOffset: Math.random() * Math.PI * 2,
    }));

    const LINK_DIST = 195;
    let raf: number;
    let t = 0;

    const draw = () => {
      t += 0.015;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < -30 || n.x > canvas.width + 30) n.vx *= -1;
        if (n.y < -30 || n.y > canvas.height + 30) n.vy *= -1;
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          if (dist >= LINK_DIST) continue;
          const baseAlpha = (1 - dist / LINK_DIST) * (light ? 0.22 : 0.16);
          const risky = a.type !== "safe" || b.type !== "safe";
          ctx.strokeStyle = risky
            ? `rgba(249,115,22,${baseAlpha * 2.2})`
            : light
            ? `rgba(100,116,139,${baseAlpha})`
            : `rgba(148,163,184,${baseAlpha})`;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      for (const n of nodes) {
        const pulse = Math.sin(t * 1.8 + n.pulseOffset);
        const [r, g, b] =
          n.type === "critical" ? [239, 68, 68] :
          n.type === "warning"  ? [249, 115, 22] :
          light                 ? [100, 116, 139] :
                                  [148, 163, 184];

        if (n.type !== "safe") {
          const glowR = n.r + 10 + pulse * 5;
          const grd = ctx.createRadialGradient(n.x, n.y, n.r * 0.5, n.x, n.y, glowR);
          grd.addColorStop(0, `rgba(${r},${g},${b},0.2)`);
          grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.beginPath();
          ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = grd;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(
          n.x, n.y,
          n.r + (n.type !== "safe" ? pulse * 0.4 + 0.3 : 0),
          0, Math.PI * 2
        );
        const safeAlpha = light ? 0.45 : 0.3;
        ctx.fillStyle =
          n.type === "safe"
            ? `rgba(${r},${g},${b},${safeAlpha})`
            : `rgba(${r},${g},${b},${0.7 + pulse * 0.18})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
    };
  }, [light]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 1,
        opacity: light ? 0.65 : 0.5,
      }}
    />
  );
}
